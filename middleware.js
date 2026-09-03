// Edge rate limit in front of the paid endpoints. Runs on Vercel before
// server.js sees the request, so server.js stays a plain local dev server.
// Counters live in Upstash Redis (REST); with no store configured the
// limiter fails OPEN and says so in a header, so a misconfigured deploy is
// visible rather than silently dead.

const PER_IP = { max: 20, windowSec: 12 * 60 * 60 }; // 20 messages per 12 h per visitor
const GLOBAL = { max: 1000, windowSec: 24 * 60 * 60 }; // hard ceiling on the key per day

export const config = { matcher: ["/api/chat", "/api/tts"] };

function clientIp(req) {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0] : req.headers.get("x-real-ip") || "unknown").trim();
}

// One round trip: INCR both counters, set their expiry only if new (NX).
async function bump(ip, fetchFn = fetch) {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const ipKey = `rl:ip:${ip}`;
  const res = await fetchFn(`${url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify([
      ["INCR", ipKey],
      ["EXPIRE", ipKey, PER_IP.windowSec, "NX"],
      ["INCR", "rl:global"],
      ["EXPIRE", "rl:global", GLOBAL.windowSec, "NX"],
      ["TTL", ipKey],
    ]),
  });
  if (!res.ok) throw new Error(`store ${res.status}`);
  const out = await res.json();
  return { ip: out[0].result, global: out[2].result, ttl: out[4].result };
}

function reject(message, retryAfterSec) {
  return new Response(JSON.stringify({ error: message }), {
    status: 429,
    headers: { "Content-Type": "application/json", "Retry-After": String(Math.max(1, retryAfterSec)) },
  });
}

export async function decide(req, fetchFn) {
  if (req.method !== "POST") return { allow: true, headers: {} };
  let counts;
  try {
    counts = await bump(clientIp(req), fetchFn);
  } catch (err) {
    console.error("ratelimit store error, allowing:", err.message);
    return { allow: true, headers: { "X-RateLimit": "store-error" } };
  }
  if (!counts) return { allow: true, headers: { "X-RateLimit": "unconfigured" } };
  if (counts.global > GLOBAL.max) {
    return { allow: false, response: reject("[closes file] The precinct is closed for the night. Come back tomorrow.", 3600) };
  }
  if (counts.ip > PER_IP.max) {
    const hours = Math.ceil(counts.ttl / 3600);
    return { allow: false, response: reject(`[closes file] That's enough for one night, friend. Come back in ${hours} hour${hours === 1 ? "" : "s"}.`, counts.ttl) };
  }
  return { allow: true, headers: { "X-RateLimit-Remaining": String(PER_IP.max - counts.ip) } };
}

export default async function middleware(req) {
  const d = await decide(req);
  if (!d.allow) return d.response;
  // Returning a Response whose "x-middleware-next" header is set tells Vercel
  // to continue to the origin; extra headers are merged onto the final response.
  return new Response(null, { headers: { "x-middleware-next": "1", ...d.headers } });
}
