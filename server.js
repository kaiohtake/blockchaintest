const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT) || 3000;
const MODEL = process.env.OPENAI_MODEL || "gpt-5.6-sol";
const SYSTEM = "You are a concise, friendly assistant in a small chat app. Keep answers tight unless asked to elaborate.";

// OpenAI is used when a key is present; otherwise the app falls back to
// a local responder so it still runs with zero setup.
let client = null;
try {
  if (process.env.OPENAI_API_KEY) {
    const OpenAI = require("openai");
    client = new OpenAI();
  }
} catch (err) {
  console.warn("OpenAI SDK unavailable, using local mode:", err.message);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

function localReply(messages) {
  const last = messages[messages.length - 1]?.content ?? "";
  const turns = messages.filter((m) => m.role === "user").length;
  return [
    `Local mode: no OpenAI key found, so I am echoing instead of thinking.`,
    ``,
    `You said (${last.length} chars, message ${turns}): "${last}"`,
    ``,
    `Set OPENAI_API_KEY in .env and restart to talk to ${MODEL}.`,
  ].join("\n");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) {
        reject(new Error("payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

function sanitize(messages) {
  if (!Array.isArray(messages)) throw new Error("messages must be an array");
  const clean = messages
    .filter((m) => m && (m.role === "user" || m.role === "assistant"))
    .map((m) => ({ role: m.role, content: String(m.content ?? "").slice(0, 20000) }))
    .filter((m) => m.content.length > 0);
  if (clean.length === 0) throw new Error("no usable messages");
  if (clean[0].role !== "user") throw new Error("conversation must start with a user message");
  return clean.slice(-40);
}

async function handleChat(req, res) {
  let messages;
  try {
    messages = sanitize(JSON.parse(await readBody(req)).messages);
  } catch (err) {
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: err.message }));
  }

  // Server-sent events so tokens render as they arrive.
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  if (!client) {
    for (const chunk of localReply(messages).match(/.{1,4}/gs) ?? []) {
      send("delta", { text: chunk });
      await new Promise((r) => setTimeout(r, 8));
    }
    send("done", {});
    return res.end();
  }

  try {
    const stream = await client.chat.completions.create({
      model: MODEL,
      stream: true,
      messages: [{ role: "system", content: SYSTEM }, ...messages],
    });
    let finish = null;
    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const text = choice.delta?.content;
      if (text) send("delta", { text });
      if (choice.finish_reason) finish = choice.finish_reason;
    }
    if (finish === "content_filter") {
      send("delta", { text: "\n\n_(OpenAI declined this request.)_" });
    }
    send("done", {});
  } catch (err) {
    console.error("chat error:", err);
    send("error", { message: err.message || "request failed" });
  }
  res.end();
}

function serveStatic(req, res) {
  const rel = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const file = path.join(__dirname, "public", path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(path.join(__dirname, "public"))) {
    res.writeHead(403).end("forbidden");
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}

http
  .createServer((req, res) => {
    if (req.method === "POST" && req.url === "/api/chat") return handleChat(req, res);
    if (req.method === "GET" && req.url === "/api/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ mode: client ? "openai" : "local", model: client ? MODEL : null }));
    }
    if (req.method === "GET") return serveStatic(req, res);
    res.writeHead(405).end();
  })
  .listen(PORT, () => {
    console.log(`chat app -> http://localhost:${PORT}  (${client ? `OpenAI: ${MODEL}` : "local mode, no API key"})`);
  });
