// Optional voice. One WAV per sentence, strictly sequential. Loudness only
// scales how wide the mouth opens; the viseme shapes still come from text.
export class Voice {
  constructor(audio, onLevel) {
    this.audio = audio;
    this.onLevel = onLevel || (() => {});
    this.queue = [];
    this.seq = 0;
    this.playing = null;
    this.enabled = false;
    this.analyser = null;
    this.data = null;
    this.onSentenceStart = () => {};
  }
  setEnabled(on) {
    this.enabled = on;
    if (!on) this.cancel();
  }
  cancel() {
    this.seq++;
    this.queue = [];
    if (this.playing) { try { this.playing.stop(); } catch {} this.playing = null; }
  }
  speak(text) {
    if (!this.enabled || !this.audio.ctx) return;
    const clean = text.replace(/```[\s\S]*?```/g, "").replace(/^\s*\d+[.)]\s+/gm, "").trim();
    if (!clean || clean.length > 300) return;
    const item = { seq: this.seq, text: clean, buffer: null, done: false };
    this.queue.push(item);
    fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: clean }) })
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`tts ${r.status}`))))
      .then((ab) => this.audio.ctx.decodeAudioData(ab))
      .then((buf) => { item.buffer = buf; })
      .catch(() => { item.done = true; })
      .finally(() => this.pump());
  }
  pump() {
    if (this.playing) return;
    while (this.queue.length && (this.queue[0].done || this.queue[0].seq !== this.seq)) this.queue.shift();
    const item = this.queue[0];
    if (!item || !item.buffer) return;
    const c = this.audio.ctx;
    if (!this.analyser) {
      this.analyser = c.createAnalyser();
      this.analyser.fftSize = 256;
      this.data = new Float32Array(this.analyser.fftSize);
      this.analyser.connect(this.audio.master);
    }
    const src = c.createBufferSource();
    src.buffer = item.buffer;
    src.connect(this.analyser);
    src.onended = () => {
      if (this.playing === src) this.playing = null;
      item.done = true;
      this.onLevel(0);
      this.pump();
    };
    this.playing = src;
    this.onSentenceStart(item.text);
    src.start();
  }
  update() {
    if (!this.playing || !this.analyser) return;
    this.analyser.getFloatTimeDomainData(this.data);
    let sum = 0;
    for (let i = 0; i < this.data.length; i++) sum += this.data[i] * this.data[i];
    const rms = Math.sqrt(sum / this.data.length);
    this.onLevel(Math.min(1, rms * 6));
  }
}
