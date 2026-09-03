// SSE client + stateful stage-direction parser. Tags can be split across
// stream chunks ("[lea" + "ns in]"), so the parser buffers from "[" until
// it sees "]" or gives up after MAX_TAG_LEN characters.
import { TAG_SET, MAX_TAG_LEN } from "./tags.js";

export class TagParser {
  constructor({ onText, onCue }) {
    this.onText = onText;
    this.onCue = onCue;
    this.hold = "";
    this.eatSpace = false;
  }
  push(chunk) {
    let text = "";
    for (const ch of chunk) {
      if (this.hold) {
        this.hold += ch;
        if (ch === "]") {
          const raw = this.hold;
          const tag = raw.toLowerCase();
          this.hold = "";
          if (TAG_SET.has(tag)) { this.onCue(tag); this.eatSpace = true; }
          else text += raw;
        } else if (this.hold.length > MAX_TAG_LEN) {
          text += this.hold;
          this.hold = "";
        }
      } else if (ch === "[") {
        if (text) { this.onText(text); text = ""; }
        this.hold = "[";
      } else if (this.eatSpace && /\s/.test(ch)) {
        // A stripped tag leaves its line break behind; swallow it.
      } else {
        this.eatSpace = false;
        text += ch;
      }
    }
    if (text) this.onText(text);
  }
  flush() {
    if (this.hold) { this.onText(this.hold); this.hold = ""; }
  }
}

export const SEED = "[The suspect sits down across the table.]";

export class Chat {
  constructor() {
    this.messages = [];
    this.controller = null;
  }
  // A deliberate abort (clear/restart) must not paint an error card.
  abort() {
    if (this.controller) this.controller.deliberate = true;
    this.controller?.abort(new DOMException("aborted", "AbortError"));
    this.controller = null;
  }
  // Streams one assistant turn. Raw text (tags included) is kept in history
  // so the model stays consistent; display/voice get the parsed events.
  async send(userText, { onText, onCue, onFirstToken, cue = null } = {}) {
    this.messages.push({ role: "user", content: userText });
    const parser = new TagParser({ onText: onText || (() => {}), onCue: onCue || (() => {}) });
    this.abort();
    const controller = new AbortController();
    this.controller = controller;
    const timer = setTimeout(() => controller.abort(new DOMException("timeout", "TimeoutError")), 90000);
    let raw = "";
    let first = true;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: this.messages, cue }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
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
            if (first) { first = false; onFirstToken?.(); }
            raw += data.text;
            parser.push(data.text);
          } else if (event === "error") {
            throw Object.assign(new Error(data.kind || "line dead"), { status: data.status, kind: data.kind, spoken: Boolean(data.spoken) });
          }
        }
      }
      parser.flush();
      this.messages.push({ role: "assistant", content: raw });
      return raw;
    } catch (err) {
      parser.flush();
      // Drop the failed user turn (only if it is still the last one) so history stays valid.
      const last = this.messages[this.messages.length - 1];
      if (last && last.role === "user" && last.content === userText) this.messages.pop();
      if (controller.deliberate) err.deliberate = true;
      throw err;
    } finally {
      clearTimeout(timer);
      if (this.controller === controller) this.controller = null;
    }
  }
  clear() {
    this.abort();
    this.messages = [];
  }
}
