// The typewriter. This loop is the master clock: the mouth, the blip, the
// subtitle and the transcript all hang off what it reveals, never off the
// network. Tokens arrive in bursts; the reveal paces them.
const CHAR_MS = 1000 / 45;
const FAST_MS = 1000 / 70;
const CATCHUP_AT = 150;
const PAUSE = { ",": 160, ";": 160, ":": 200, ".": 340, "!": 340, "?": 360, "\n": 220 };

export class Reveal {
  constructor({ onChar, onWord, onSentence, onUpdate, onIdle }) {
    this.onChar = onChar || (() => {});
    this.onWord = onWord || (() => {});
    this.onSentence = onSentence || (() => {});
    this.onUpdate = onUpdate || (() => {});
    this.onIdle = onIdle || (() => {});
    this.reset();
    this.instant = false;
  }
  reset() {
    this.buffer = "";
    this.pos = 0;
    this.revealed = "";
    this.sentence = "";
    this.wordStart = -1;
    this.streamDone = false;
    this.speaking = false;
    this.next = 0;
    this.pendingIdle = false;
  }
  push(text) {
    if (!this.speaking) this.next = 0;
    this.buffer += text;
    this.speaking = true;
  }
  finish() {
    this.streamDone = true;
  }
  // Player pressed a key mid-reveal: show everything.
  skip() {
    while (this.pos < this.buffer.length) this.step(true);
    this.settle();
  }
  get pending() {
    return this.buffer.length - this.pos;
  }
  step(silent = false) {
    const ch = this.buffer[this.pos++];
    this.revealed += ch;
    this.sentence += ch;
    const isWordChar = /[A-Za-z0-9'’]/.test(ch);
    if (isWordChar && this.wordStart < 0) this.wordStart = this.pos - 1;
    if (!isWordChar && this.wordStart >= 0) {
      const word = this.buffer.slice(this.wordStart, this.pos - 1);
      this.wordStart = -1;
      if (word) this.onWord(word);
    }
    if (!silent) this.onChar(ch);
    if (/[.!?]/.test(ch)) {
      const nxt = this.buffer[this.pos];
      // "Mr." / "Dr." / "4.5" are not sentence ends; require a real sentence behind the mark.
      const abbrev = ch === "." && /(^|\s)[A-Z][a-z]{0,2}\.$/.test(this.sentence);
      if (!abbrev && this.sentence.trim().length > 6 && (nxt === undefined ? this.streamDone : /\s/.test(nxt))) {
        this.onSentence(this.sentence.trim());
        this.sentence = "";
      }
    } else if (ch === "\n" && this.sentence.trim()) {
      this.onSentence(this.sentence.trim());
      this.sentence = "";
    }
    return ch;
  }
  settle() {
    if (this.wordStart >= 0 && this.streamDone) {
      const word = this.buffer.slice(this.wordStart, this.pos);
      this.wordStart = -1;
      if (word) this.onWord(word);
    }
    if (this.streamDone && this.sentence.trim()) {
      this.onSentence(this.sentence.trim());
      this.sentence = "";
    }
    this.onUpdate(this.revealed, this.sentence);
    if (this.streamDone && this.speaking) {
      this.speaking = false;
      this.onIdle(this.revealed);
    }
  }
  // Frame-rate independent: reveals as many characters as the clock owes,
  // so a slow frame does not slow the typewriter.
  update(now) {
    if (this.pos >= this.buffer.length) {
      if (this.streamDone && this.speaking) this.settle();
      return;
    }
    if (now < this.next) return;
    let changed = false;
    let guard = 0;
    if (this.next === 0) this.next = now;
    while (this.pos < this.buffer.length && now >= this.next && guard++ < 40) {
      const ch = this.step();
      const ms = this.instant ? 0 : this.pending > CATCHUP_AT ? FAST_MS : CHAR_MS;
      this.next = Math.max(this.next, now - 120) + ms + (this.instant ? 0 : (PAUSE[ch] || 0));
      changed = true;
    }
    if (changed) this.onUpdate(this.revealed, this.sentence);
    if (this.pos >= this.buffer.length && this.streamDone) this.settle();
  }
}
