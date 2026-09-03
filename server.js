// The Interrogation — zero-dependency Node server.
// Serves the static scene, streams the detective's replies as SSE, and
// (optionally) proxies OpenAI text-to-speech. Run: node --env-file=.env server.js
const http = require("http");
const fs = require("fs");
const path = require("path");
const { PERSONA } = require("./persona");

const PORT = Number(process.env.PORT) || 3000;
const MODEL = process.env.OPENAI_MODEL || "gpt-5.6-sol";
const TTS_ENABLED = process.env.OPENAI_TTS_ENABLED === "true";
const TTS_MODEL = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
const TTS_VOICE = process.env.OPENAI_TTS_VOICE || "onyx";
const TTS_INSTRUCTIONS =
  "A tired homicide detective, late at night. Low register, unhurried, dry, slightly gravelly. No enthusiasm.";
const PUBLIC = path.join(__dirname, "public");
const HOST = process.env.HOST || "127.0.0.1";
const TTS_DAILY_CHARS = Number(process.env.OPENAI_TTS_DAILY_CHARS) || 60000;
const ttsCache = new Map();
let ttsChars = 0;
setInterval(() => { ttsChars = 0; }, 24 * 3600 * 1000).unref();

// Per-IP token bucket: this key is the owner's money.
const buckets = new Map();
function allow(ip, perMinute = 20) {
  const now = Date.now();
  const b = buckets.get(ip) || { tokens: perMinute, at: now };
  b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60000) * perMinute);
  b.at = now;
  if (b.tokens < 1) { buckets.set(ip, b); return false; }
  b.tokens -= 1;
  buckets.set(ip, b);
  return true;
}

let client = null;
try {
  if (process.env.OPENAI_API_KEY) {
    const OpenAI = require("openai");
    client = new OpenAI();
  }
} catch (err) {
  console.warn("OpenAI SDK unavailable, using local mode:", err.message);
}

// Strict MIME types matter: <script type=module> and AudioWorklet refuse
// octet-stream, and the browser sniffs nothing for .glb/.hdr/.wasm.
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".bin": "application/octet-stream",
  ".hdr": "application/octet-stream",
  ".wasm": "application/wasm",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

// When the provider fails, the detective says why, in character, so a demo
// audience hears the real reason instead of guessing. Only a status code and a
// short kind ever leave the server; the provider's message can quote the key.
function diagnose(err) {
  const status = err?.status || 0;
  const code = String(err?.code || err?.error?.code || err?.type || "");
  if (status === 401) return { kind: "bad key", line: "[sighs] Line's dead, friend. The key on this room is no good. OPENAI_API_KEY in the .env file is wrong, or somebody revoked it. Whoever runs this place needs to paste a fresh one and restart. Until then I'm talking to a wall. Who do I call?" };
  if (status === 429 && /insufficient_quota|billing/i.test(code)) return { kind: "out of credit", line: "[leans back] Well. The department's out of money, friend. The OpenAI account behind this room has no credit left, so nobody's paying for my questions tonight. Somebody has to top up the balance at platform.openai.com and we go again. You want to tell them, or should I?" };
  if (status === 429) return { kind: "rate limited", line: "[taps pen] Too many people in this building talking at once, friend. The provider's throttling us. Give it a minute, then say that again." };
  if (status === 402) return { kind: "payment required", line: "[leans back] The account behind this room needs a payment method before it'll say another word, friend. Tell whoever owns it." };
  if (status >= 500 || status === 0) return { kind: "provider down", line: "[stares] The line to the provider just went down, friend. Not you, not me. Wait a beat and try again." };
  return { kind: `error ${status}`, line: "[checks file] Something upstream just refused me, friend. Say that again in a minute." };
}

// Local mode keeps the fiction intact: the detective tells you the line is dead.
function localReply(messages) {
  const last = messages[messages.length - 1]?.content ?? "";
  if (/^\[the suspect sits down/i.test(last)) {
    return "[sighs] Sit down, friend. Line's dead tonight. Somebody forgot to put OPENAI_API_KEY in the .env file and restart. Until they do, I can't hear a word you say. So. You want to tell me who forgot?";
  }
  return `[taps pen] I heard you. ${last.length} characters of it. Doesn't matter, the line's dead until OPENAI_API_KEY lands in .env. Who's going to fix that, you or me?`;
}

function readBody(req, limit = 4e5) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    req.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > limit) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// Only the page we serve may call the API: a foreign Origin or Host is refused
// before any money is spent.
function sameOrigin(req) {
  const host = String(req.headers.host || "").toLowerCase();
  const allowed = (process.env.ALLOW_HOSTS || "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  // On a hosting platform the platform's own hostname is the site; locally only localhost is.
  const deployed = Boolean(process.env.VERCEL || process.env.RENDER || process.env.FLY_APP_NAME || process.env.RAILWAY_ENVIRONMENT || process.env.ALLOW_ANY_HOST);
  const hostOk = deployed || /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) || allowed.includes(host);
  if (!hostOk) return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host.toLowerCase() === host; } catch { return false; }
}

function sanitize(messages) {
  if (!Array.isArray(messages)) throw new Error("messages must be an array");
  const clean = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant"))
    .map((m) => ({ role: m.role, content: String(m.content ?? "").slice(0, 4000) }))
    .filter((m) => m.content.length > 0);
  if (clean.length === 0) throw new Error("no usable messages");
  const recent = clean.slice(-24);
  while (recent.length && recent[0].role !== "user") recent.shift();
  if (recent.length === 0) throw new Error("conversation must start with a user message");
  return recent;
}

function sseHeaders(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  return (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function streamCompletion(messages, send, req, cue) {
  // A stage cue from the client (the desk sergeant knocking) is injected as a
  // system note right before the suspect's last line, never stored as testimony.
  const thread = [...messages];
  if (cue) thread.splice(thread.length - 1, 0, { role: "system", content: `Stage note: ${cue}` });
  const base = {
    model: MODEL,
    stream: true,
    max_completion_tokens: 1400,
    messages: [{ role: "system", content: PERSONA }, ...thread],
  };
  // Low reasoning effort keeps first-token latency short; not every model
  // accepts the parameter, so fall back once without it.
  let stream;
  try {
    stream = await client.chat.completions.create({ ...base, reasoning_effort: "low" });
  } catch (err) {
    if (err?.status === 400 && /reasoning/i.test(err.message || "")) {
      stream = await client.chat.completions.create(base);
    } else {
      throw err;
    }
  }
  // Tab closed mid-reply: stop paying for tokens nobody will read.
  req.on("close", () => { try { stream.controller?.abort(); } catch {} });
  let finish = null;
  for await (const chunk of stream) {
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    const text = choice.delta?.content;
    if (text) send("delta", { text });
    if (choice.finish_reason) finish = choice.finish_reason;
  }
  if (finish === "content_filter") {
    send("delta", { text: " [leans back] I'm not putting that on the record, friend. Ask me something else." });
  }
}

const CUES = new Set(["decide"]);
async function handleChat(req, res) {
  if (!sameOrigin(req)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "forbidden" }));
  }
  if (!allow(req.socket.remoteAddress)) {
    res.writeHead(429, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "slow down" }));
  }
  let messages, cue = null;
  try {
    const body = JSON.parse(await readBody(req));
    messages = sanitize(body.messages);
    if (CUES.has(body.cue)) cue = "The desk sergeant knocks twice; the DA is on the line. Decide now, release or charge, say which plainly, and end this reply with [closes file].";
  } catch (err) {
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: err.message }));
  }
  const send = sseHeaders(res);
  const t0 = Date.now();
  let firstAt = 0;
  const sendTimed = (event, data) => { if (event === "delta" && !firstAt) { firstAt = Date.now(); console.log(`chat: first token ${firstAt - t0} ms`); } send(event, data); };

  if (!client) {
    for (const chunk of localReply(messages).match(/.{1,4}/gs) ?? []) {
      send("delta", { text: chunk });
      await new Promise((r) => setTimeout(r, 12));
    }
    send("done", {});
    return res.end();
  }

  try {
    await streamCompletion(messages, sendTimed, req, cue);
    send("done", {});
    console.log(`chat: done ${Date.now() - t0} ms (${messages.length} msgs)`);
  } catch (err) {
    console.error("chat error:", err?.status || "", err?.code || "", err?.message || err);
    const d = diagnose(err);
    if (!firstAt) {
      // He says it himself, then the client learns what kind of failure it was.
      for (const chunk of d.line.match(/.{1,4}/gs) ?? []) {
        send("delta", { text: chunk });
        await new Promise((r) => setTimeout(r, 10));
      }
    }
    send("error", { status: err?.status || 0, kind: d.kind, spoken: !firstAt });
  }
  res.end();
}

// Optional voice: one sentence in, one WAV out. Off unless OPENAI_TTS_ENABLED=true.
async function handleTts(req, res) {
  if (!client || !TTS_ENABLED) {
    res.writeHead(404, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "tts disabled" }));
  }
  if (!sameOrigin(req)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "forbidden" }));
  }
  if (!allow(req.socket.remoteAddress, 40)) {
    res.writeHead(429, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "slow down" }));
  }
  let text;
  try {
    text = String(JSON.parse(await readBody(req, 8000)).text || "").trim().slice(0, 400);
    if (!text) throw new Error("empty text");
  } catch (err) {
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: err.message }));
  }
  const cached = ttsCache.get(text);
  if (cached) {
    res.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": cached.length, "Cache-Control": "no-store" });
    return res.end(cached);
  }
  if (ttsChars + text.length > TTS_DAILY_CHARS) {
    res.writeHead(429, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "daily voice budget spent" }));
  }
  try {
    const speech = await client.audio.speech.create({
      model: TTS_MODEL,
      voice: TTS_VOICE,
      input: text,
      instructions: TTS_INSTRUCTIONS,
      response_format: "wav",
    });
    const buf = Buffer.from(await speech.arrayBuffer());
    ttsChars += text.length;
    ttsCache.set(text, buf);
    if (ttsCache.size > 200) ttsCache.delete(ttsCache.keys().next().value);
    res.writeHead(200, { "Content-Type": "audio/wav", "Content-Length": buf.length, "Cache-Control": "no-store" });
    res.end(buf);
  } catch (err) {
    console.error("tts error:", err?.status || "", err?.message || err);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "tts failed", status: err?.status || 0 }));
  }
}

function serveStatic(req, res) {
  const rel = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  let decoded;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    return res.writeHead(400).end("bad path");
  }
  if (decoded.includes("\0")) return res.writeHead(400).end("bad path");
  const file = path.join(PUBLIC, path.normalize(decoded).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(PUBLIC)) return res.writeHead(403).end("forbidden");
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
    const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
    const cache = /\/(vendor|assets)\//.test(file) ? "public, max-age=86400" : "no-cache";
    res.writeHead(200, { "Content-Type": type, "Content-Length": st.size, "Cache-Control": cache });
    fs.createReadStream(file).pipe(res);
  });
}

http
  .createServer((req, res) => {
    try {
      route(req, res);
    } catch (err) {
      console.error("request error:", err?.message || err);
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("error");
    }
  })
  .listen(PORT, HOST, () => {
    console.log(
      `The Interrogation -> http://localhost:${PORT}  (${client ? `OpenAI ${MODEL}${TTS_ENABLED ? " + voice" : ""}` : "local mode, no API key"}; bound to ${HOST}, set HOST=0.0.0.0 and ALLOW_HOSTS=<host:port> for a LAN demo)`
    );
  });

function route(req, res) {
    if (req.method === "POST" && req.url === "/api/chat") return handleChat(req, res);
    if (req.method === "POST" && req.url === "/api/tts") return handleTts(req, res);
    if (req.method === "GET" && req.url === "/api/status") {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(
        JSON.stringify({
          chatEnabled: Boolean(client),
          ttsEnabled: Boolean(client && TTS_ENABLED),
          model: client ? MODEL : null,
          theme: "interrogation",
        })
      );
    }
    if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res);
    res.writeHead(405).end();
}
