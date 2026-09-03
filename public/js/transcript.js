// The typed record, bottom-left. Long answers, code and lists live here.
export class Transcript {
  constructor(sheetEl, recordEl) {
    this.sheet = sheetEl;
    this.record = recordEl;
    this.live = null;
    this.userScrolled = false;
    this.head = document.getElementById("sheetHead");
    this.toggle = document.getElementById("sheetToggle");
    this.head?.addEventListener("click", (e) => { if (e.target.id !== "clear") this.open(this.sheet.classList.contains("closed")); });
    this.record.addEventListener("scroll", () => {
      const nearBottom = this.record.scrollHeight - this.record.scrollTop - this.record.clientHeight < 24;
      this.userScrolled = !nearBottom;
    });
  }
  show() { this.sheet.hidden = false; }
  open(on) {
    this.sheet.classList.toggle("closed", !on);
    if (this.toggle) this.toggle.textContent = on ? "close" : "open";
    if (on) this.scroll();
  }
  add(role, text, pending = false) {
    const p = document.createElement("p");
    p.className = role + (pending ? " pending" : "");
    const who = document.createElement("span");
    who.className = "who";
    who.textContent = role === "you" ? "SUSPECT" : "KOWALSKI";
    p.append(who, this.render(text));
    this.record.append(p);
    this.scroll();
    return p;
  }
  // Streaming target: created empty, updated as the reveal advances.
  startLive() {
    this.live = this.add("him", "");
    return this.live;
  }
  updateLive(text) {
    if (!this.live) return;
    // Long-form answers (code, numbered steps) open the file so they can be read.
    if (this.sheet.classList.contains("closed") && /```|^\s*\d+[.)]\s/m.test(text)) this.open(true);
    const who = this.live.querySelector(".who");
    this.live.replaceChildren(who, this.render(text));
    this.scroll();
  }
  endLive() { this.live = null; }
  settlePending() { for (const p of this.record.querySelectorAll("p.pending")) p.classList.remove("pending"); }
  clear() { this.record.replaceChildren(); this.live = null; }
  scroll() {
    if (!this.userScrolled) this.record.scrollTop = this.record.scrollHeight;
  }
  // Minimal: fenced code becomes <pre>; everything else is plain text.
  render(text) {
    const frag = document.createDocumentFragment();
    const parts = text.split(/```[a-z]*\n?/i);
    parts.forEach((part, i) => {
      if (!part) return;
      if (i % 2 === 1) {
        const pre = document.createElement("pre");
        pre.textContent = part.replace(/\n$/, "");
        frag.append(pre);
      } else {
        frag.append(document.createTextNode(part));
      }
    });
    return frag;
  }
}
