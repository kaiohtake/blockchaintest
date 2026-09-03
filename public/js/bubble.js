// Subtitle card anchored to his head: projected by hand each frame and
// rounded to whole pixels so the text stays crisp while it streams.
import * as THREE from "three";

export class Bubble {
  constructor(el, thinkingEl, camera) {
    this.el = el;
    this.thinkingEl = thinkingEl;
    this.camera = camera;
    this.anchor = new THREE.Vector3();
    this.tmp = new THREE.Vector3();
    this.text = "";
    this.caret = document.createElement("span");
    this.caret.className = "caret";
    this.moreEl = document.createElement("span");
    this.moreEl.className = "more";
    this.moreEl.textContent = "▼";
    this.tail = document.getElementById("tail");
    this.visible = false;
  }
  // Does the text overrun the window? Measured on the text itself: the
  // card's tail is an absolutely positioned pseudo-element that would make
  // scrollHeight lie by its own height.
  overflows() {
    if (this.el.hidden) return false;
    const range = document.createRange();
    range.selectNodeContents(this.el);
    const text = range.getBoundingClientRect().height;
    const cs = getComputedStyle(this.el);
    return text > parseFloat(cs.lineHeight) * 4 + 1;
  }
  setAnchor(v) {
    this.anchor.copy(v);
  }
  setText(text, showCaret) {
    if (text === this.text && showCaret === this.showCaret) return;
    this.text = text;
    this.showCaret = showCaret;
    this.el.textContent = text;
    if (showCaret) this.el.append(this.caret);
    if (this.showMore) this.el.append(this.moreEl);
    this.el.hidden = !text;
    this.tail.hidden = !text;
    this.visible = Boolean(text);
    if (this.visible) this.thinkingEl.hidden = true;
  }
  more(on) {
    this.showMore = on;
    if (on) this.el.append(this.moreEl); else this.moreEl.remove();
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
  // Fade the card out, run fn (usually a text swap), fade back in.
  fadeTo(fn, ms = 260) {
    this.el.classList.add("fading");
    setTimeout(() => { fn(); this.el.classList.remove("fading"); }, ms);
  }
  fadeOut(ms = 500) {
    this.el.classList.add("fading");
    setTimeout(() => { if (this.el.classList.contains("fading")) this.hide(); }, ms);
  }
  update() {
    if (this.el.hidden && this.thinkingEl.hidden) return;
    this.tmp.copy(this.anchor).project(this.camera);
    const w = window.innerWidth, h = window.innerHeight;
    let x = Math.round((this.tmp.x * 0.5 + 0.5) * w);
    let y = Math.round((-this.tmp.y * 0.5 + 0.5) * h);
    const cardW = this.el.offsetWidth || 460;
    const cardH = this.el.offsetHeight || 60;
    const bar = document.body.classList.contains("letterbox") ? h * 0.11 : 0;
    // Beside his head, not on it: to the right when there is room, else left.
    let left = x + 26;
    let tailX = x + 18;
    if (left + cardW > w - 12) { left = x - 26 - cardW; tailX = x - 26; }
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
