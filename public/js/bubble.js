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
    this.visible = false;
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
    this.el.hidden = !text;
    this.visible = Boolean(text);
    if (this.visible) this.thinkingEl.hidden = true;
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
  }
  update() {
    if (this.el.hidden && this.thinkingEl.hidden) return;
    this.tmp.copy(this.anchor).project(this.camera);
    const w = window.innerWidth, h = window.innerHeight;
    let x = Math.round((this.tmp.x * 0.5 + 0.5) * w);
    let y = Math.round((-this.tmp.y * 0.5 + 0.5) * h);
    const margin = 12;
    const half = Math.min(220, w * 0.39);
    x = Math.max(half + margin, Math.min(w - half - margin, x));
    y = Math.max(140, y);
    for (const el of [this.el, this.thinkingEl]) {
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
    }
  }
}
