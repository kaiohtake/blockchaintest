const log = document.getElementById("log");
const empty = document.getElementById("empty");
const form = document.getElementById("composer");
const input = document.getElementById("input");
const send = document.getElementById("send");
const statusEl = document.getElementById("status");

let messages = [];
let busy = false;

fetch("/api/status")
  .then((r) => r.json())
  .then((s) => {
    statusEl.textContent = s.chatEnabled ? s.model : "local mode";
  })
  .catch(() => {
    statusEl.textContent = "offline";
  });

function addBubble(role, text = "") {
  empty?.remove();
  const row = document.createElement("div");
  row.className = `msg ${role}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  row.append(bubble);
  log.append(row);
  log.scrollTop = log.scrollHeight;
  return { row, bubble };
}

function setBusy(state) {
  busy = state;
  send.disabled = state;
}

// The server streams SSE; parse the frames off a plain fetch body reader.
async function stream(bubble) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const event = frame.match(/^event: (.*)$/m)?.[1];
      const dataLine = frame.match(/^data: (.*)$/m)?.[1];
      if (!event || !dataLine) continue;
      const data = JSON.parse(dataLine);
      if (event === "delta") {
        text += data.text;
        bubble.textContent = text;
        log.scrollTop = log.scrollHeight;
      } else if (event === "error") {
        throw new Error(data.message);
      }
    }
  }
  return text;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const content = input.value.trim();
  if (!content || busy) return;

  addBubble("user", content);
  messages.push({ role: "user", content });
  input.value = "";
  input.style.height = "auto";
  setBusy(true);

  const { row, bubble } = addBubble("assistant");
  bubble.classList.add("cursor");
  try {
    const reply = await stream(bubble);
    messages.push({ role: "assistant", content: reply });
  } catch (err) {
    row.classList.add("error");
    bubble.textContent = `Error: ${err.message}`;
    messages.pop(); // drop the user turn so the history stays valid
  } finally {
    bubble.classList.remove("cursor");
    setBusy(false);
    input.focus();
  }
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});

input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
});

document.getElementById("clear").addEventListener("click", () => {
  messages = [];
  log.innerHTML = '<div class="empty"><p>Start a conversation.</p></div>';
});
