// Subtitle card anchored to his head: projected by hand each frame and
// rounded to whole pixels so the text stays crisp while it streams.
//
// The card is a fixed window of at most four lines. Text keeps streaming in
// underneath and the window slides up to keep the newest line in view, like
// a teleprompter; nothing to click. The case file keeps every line.
import * as THREE from "three";

export class Bubble {
  constructor(el, thinkingEl, camera) {
    this.el = el;
    this.thinkingEl = thinkingEl;
    this.camera = camera;
    this.anchor = new THREE.Vector3();
    this.tmp = new THREE.Vector3();
    this.text = "";
    // Card > window (clips, fades the top edge while sliding) > scroll (moves).
    this.win = document.createElement("div");
    this.win.className = "window";
    this.inner = document.createElement("div");
    this.inner.className = "scroll";
    this.win.append(this.inner);
    this.el.append(this.win);
    this.caret = document.createElement("span");
    this.caret.className = "caret";
    this.tail = document.getElementById("tail");
    this.visible = false;
    this.offset = 0;      // how far the text has slid up, in px
    this.last = 0;
    this.reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  }
  setAnchor(v) {
    this.anchor.copy(v);
  }
  setText(text, showCaret) {
    text = text.replace(/\n{2,}/g, "\n"); // a paragraph gap would burn a row of the window
    if (text === this.text && showCaret === this.showCaret) return;
    this.text = text;
    this.showCaret = showCaret;
    this.inner.textContent = text;
    if (showCaret) this.inner.append(this.caret);
    this.el.hidden = !text;
    this.tail.hidden = !text;
    this.visible = Boolean(text);
    if (!text) this.scrollTo(0);
    else { const t = this.scrollTarget(); if (t < this.offset) this.scrollTo(t); } // shorter text: never leave it slid past its end
    if (this.visible) this.thinkingEl.hidden = true;
  }
  // The distance the text must slide so its last line sits at the bottom.
  // Snapped to whole lines so the top of the window never shows a sliver of
  // the line that just left.
  scrollTarget() {
    const line = parseFloat(getComputedStyle(this.el).lineHeight);
    const over = this.inner.getBoundingClientRect().height - this.win.getBoundingClientRect().height;
    return Math.max(0, Math.round(over / line) * line);
  }
  scrollTo(px) {
    this.offset = px;
    this.inner.style.transform = px ? `translateY(${-Math.round(px)}px)` : "";
  }
  thinking(on) {
    this.thinkingEl.hidden = !on;
    if (on) this.setText("", false);
  }
  tremor(on) {
    this.el.classList.toggle("tremor", on);
  }
  hide() {
    this.setText("", false);
    this.thinkingEl.hidden = true;
    this.tail.hidden = true;
    this.el.classList.remove("fading");
  }
  fadeOut(ms = 500) {
    this.el.classList.add("fading");
    setTimeout(() => { if (this.el.classList.contains("fading")) this.hide(); }, ms);
  }
  update(now = performance.now()) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.el.hidden && this.thinkingEl.hidden) return;
    if (!this.el.hidden) {
      // Ease toward the newest line: a line's worth of travel takes ~250 ms.
      const target = this.scrollTarget();
      const snap = target < this.offset || this.reduceMotion.matches;
      const next = snap ? target : this.offset + (target - this.offset) * Math.min(1, dt * 12);
      if (Math.abs(next - this.offset) > 0.2) this.scrollTo(next);
      else if (next !== this.offset) this.scrollTo(target);
      this.win.classList.toggle("sliding", Math.abs(target - this.offset) > 0.5);
    }
    this.tmp.copy(this.anchor).project(this.camera);
    const w = window.innerWidth, h = window.innerHeight;
    const x = Math.round((this.tmp.x * 0.5 + 0.5) * w);
    let y = Math.round((-this.tmp.y * 0.5 + 0.5) * h);
    const cardW = this.el.offsetWidth || 460;
    const cardH = this.el.offsetHeight || 60;
    const bar = document.body.classList.contains("letterbox") ? h * 0.11 : 0;
    // Beside his head, not on it: to the right when there is room, else left.
    let left = x + 26;
    if (left + cardW > w - 12) left = x - 26 - cardW;
    left = Math.max(12, Math.min(w - cardW - 12, left));
    y = Math.max(bar + cardH / 2 + 12, Math.min(h * 0.8, y));
    for (const el of [this.el, this.thinkingEl]) {
      el.style.left = `${left}px`;
      el.style.top = `${y}px`;
    }
    const flipped = left < x;
    this.tail.style.left = `${flipped ? left + cardW : left - 8}px`;
    this.tail.style.top = `${y - 8}px`;
    this.tail.style.transform = flipped ? "scaleX(-1)" : "";
  }
}
