// Boot: capability check -> load -> gate -> opening beat -> conversation loop.
import * as THREE from "three";
import WebGL from "three/addons/capabilities/WebGL.js";
import { Scene, LAYOUT } from "./scene.js";
import { loadDetective } from "./detective.js";
import { Reveal } from "./reveal.js";
import { Bubble } from "./bubble.js";
import { Transcript } from "./transcript.js";
import { Audio } from "./audio.js";
import { Cuffs } from "./cuffs.js";
import { Voice } from "./voice.js";
import { Chat, SEED } from "./chat.js";
import { TAGS } from "./tags.js";

const $ = (id) => document.getElementById(id);
const gate = $("gate"), sit = $("sit"), gateNote = $("gateNote"), progressBar = $("progressBar");
const form = $("you"), input = $("input"), sendBtn = $("send"), card = $("card");
const voiceRow = $("voiceRow"), voiceBox = $("voice");
const ending = $("ending"), endLine = $("endLine"), endStamp = $("endStamp");

if (!WebGL.isWebGL2Available()) {
  location.replace("/plain.html");
  throw new Error("no webgl2");
}

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const touch = matchMedia("(pointer: coarse)").matches;
const tier = touch || innerWidth / innerHeight < 1 || (navigator.hardwareConcurrency || 8) <= 4 ? "lite" : "full";

// ---- status -----------------------------------------------------------
let status = { chatEnabled: false, ttsEnabled: false };
try { status = await (await fetch("/api/status")).json(); } catch {}

// ---- loading ----------------------------------------------------------
const manager = new THREE.LoadingManager();
let loaded = 0, total = 0;
manager.onProgress = (_url, n, t) => { loaded = n; total = t; progressBar.style.width = `${Math.round((n / Math.max(t, 1)) * 100)}%`; };
manager.onError = (url) => console.warn("asset failed:", url);
manager.onLoad = () => { progressBar.style.width = "100%"; };

const scene = new Scene({ canvas: $("view"), tier, manager, reducedMotion });
const audio = new Audio();
const bubble = new Bubble($("subtitle"), $("thinking"), scene.camera);
const transcript = new Transcript($("transcript"), $("record"));
const cuffs = new Cuffs({ tableTop: LAYOUT.tableTop, barZ: LAYOUT.barZ });
scene.scene.add(cuffs.group);
const chat = new Chat();

let detective = null;
try {
  detective = await loadDetective({
    loader: scene.gltf,
    url: "/assets/detective.glb",
    clipUrl: "/assets/clips/sit_idle.glb",
    position: [0, 0, LAYOUT.detectiveZ],
    rotationY: 0,
  });
  scene.scene.add(detective.root);
} catch (err) {
  console.error("detective failed to load", err);
  gateNote.textContent = "The detective is late. The room still works.";
}
window.__interrogation = { scene, get detective() { return detective; }, get reveal() { return reveal; }, get busy() { return busy; } };

const voice = new Voice(audio, (level) => { if (detective) detective.mouth.levelGain = 0.45 + 0.55 * level; });

// ---- reveal (the master clock) ----------------------------------------
let currentSentence = "";
let letterCount = 0;
const CHAR_S = 1 / 30;
const reveal = new Reveal({
  onChar: (ch) => {
    if (/[A-Za-z]/.test(ch) && !voice.enabled) { if ((letterCount++ & 1) === 0) audio.blip(); }
  },
  onWord: (word) => {
    if (detective && !voice.enabled) detective.mouth.speakWord(word, word.length * CHAR_S * 1.05, performance.now() / 1000);
  },
  onSentence: (sentence) => {
    if (voice.enabled) voice.speak(sentence);
  },
  onUpdate: (revealed, sentence) => {
    if ((!voice.enabled || !voice.playing) && sentence.trim()) currentSentence = sentence.trimStart();
    bubble.setText(currentSentence, reveal.speaking);
    transcript.updateLive(revealed);
  },
  onIdle: (revealed) => {
    transcript.updateLive(revealed);
    transcript.endLive();
    scene.setSpeaking(false);
    document.body.classList.remove("letterbox");
    if (pendingEnd) { pendingEnd = false; setTimeout(() => endInterview(revealed), 1400); }
    idleTimers.push(setTimeout(() => { if (!reveal.speaking) bubble.setText(currentSentence, false); }, 200));
    idleTimers.push(setTimeout(() => { if (!reveal.speaking) { bubble.hide(); } }, 6000));
    setBusy(false);
  },
});
voice.onSentenceStart = (text) => {
  if (detective) {
    detective.mouth.clear();
    // Voice mode: spread the sentence's visemes over the clip's real length is
    // unknown until decoded, so approximate 60 ms per character.
    const words = text.split(/\s+/);
    let at = performance.now() / 1000;
    for (const w of words) { const s = w.length * 0.06 + 0.05; detective.mouth.speakWord(w, s, at); at += s + 0.04; }
  }
  currentSentence = text;
  bubble.setText(text, false);
};

// ---- UI ---------------------------------------------------------------
let busy = false;
function setBusy(on) {
  busy = on;
  sendBtn.disabled = on;
  document.body.classList.toggle("busy", on);
}
function showCard(title, text, ms = 4200) {
  const b = document.createElement("b");
  b.textContent = title;
  card.replaceChildren(b, document.createTextNode(` — ${text}`));
  card.hidden = false;
  clearTimeout(showCard.t);
  showCard.t = setTimeout(() => { card.hidden = true; }, ms);
}
function applyCue(tag) {
  const spec = TAGS[tag];
  if (!spec) return;
  if (detective) detective.cue(spec);
  if (spec.sfx) audio.play(spec.sfx, spec.sfx === "slam" ? 0.9 : 0.35, 0.08);
  if (spec.shake) scene.shake(spec.shake);
  if (spec.flicker) scene.flicker(600);
  if (spec.letterbox && !reducedMotion) document.body.classList.add("letterbox");
  if (spec.fov) scene.setFovOffset(spec.fov);
  bubble.tremor(Boolean(spec.shake || spec.stare));
  if (spec.shake || spec.stare) setTimeout(() => bubble.tremor(false), 1200);
  if (spec.end) pendingEnd = true;
}
let pendingEnd = false;
let turns = 0;
let interviewOver = false;
function endInterview(lastText) {
  const tail = lastText.slice(-400);
  const negated = /\b(not|no|won'?t|aren'?t|isn'?t|never)\b[^.!?]{0,30}\b(charg|book|arrest|hold|detain)/i.test(tail);
  const verdict = !negated && /\b(charg|arrest|book|custody|detain|hold you)/i.test(tail) ? "CHARGED" : "RELEASED";
  endStamp.textContent = `INTERVIEW ENDED · ${verdict}`;
  endLine.textContent = verdict === "CHARGED"
    ? "Case 2-1187 goes to the DA in the morning. You can call someone from the desk."
    : "Case 2-1187 stays open. Do not leave town, friend.";
  ending.hidden = false;
  $("again").focus();
  interviewOver = true;
  audio.setAmbienceLevel(0.06);
}

let idleTimers = [];
// The opening beat: the seed request goes out at click time and its tokens are
// held until the lamp is on and he has looked up, so latency hides in the beat.
let holdUntil = 0;
let held = [];
function releaseHeld() { for (const t of held) reveal.push(t); held = []; }
async function ask(userText, { hidden = false, holdMs = 0 } = {}) {
  if (busy) return;
  setBusy(true);
  for (const t of idleTimers) clearTimeout(t);
  idleTimers = [];
  ending.hidden = true;
  if (!hidden) { transcript.add("you", userText); cuffs.pull(); audio.play("creak", 0.12, 0.2); turns++; }
  // From the fourth answer on, the desk sergeant knocks: the server injects the
  // cue as a system note, so it never becomes testimony in the record.
  const cue = !hidden && turns >= 4 && !interviewOver ? "decide" : null;
  reveal.reset();
  held = [];
  holdUntil = holdMs ? performance.now() + holdMs : 0;
  if (holdMs) setTimeout(releaseHeld, holdMs + 20);
  currentSentence = "";
  bubble.thinking(!holdMs);
  scene.setSpeaking(true);
  voice.cancel();
  if (detective) detective.mouth.clear();
  let started = false;
  try {
    await chat.send(userText, {
      cue,
      onFirstToken: () => { started = true; bubble.thinking(false); transcript.startLive(); },
      onText: (t) => { if (holdUntil > performance.now()) held.push(t); else reveal.push(t); },
      onCue: (tag) => applyCue(tag),
    });
    if (holdUntil > performance.now()) await new Promise((r) => setTimeout(r, holdUntil - performance.now() + 30));
    releaseHeld();
    reveal.finish();
    if (!reveal.speaking) {
      // Nothing to type (a tag-only or empty reply): run the idle path by hand.
      bubble.thinking(false);
      if (started) transcript.endLive();
      scene.setSpeaking(false);
      document.body.classList.remove("letterbox");
      if (pendingEnd) { pendingEnd = false; setTimeout(() => endInterview(""), 1400); }
      setBusy(false);
    }
  } catch (err) {
    bubble.thinking(false);
    if (err?.deliberate) {
      reveal.finish(); reveal.reset();
      if (detective) detective.mouth.clear();
      if (started) transcript.endLive();
      scene.setSpeaking(false);
      document.body.classList.remove("letterbox");
      setBusy(false);
      return;
    }
    console.error(err);
    scene.flicker(900);
    const why = err?.kind || (err?.status === 401 ? "bad key" : err?.status === 429 ? "rate limited" : err?.name === "TimeoutError" ? "timed out" : "line dead");
    if (err?.spoken) {
      // He already said it; let him finish typing it, then release the room.
      releaseHeld();
      reveal.finish();
      showCard("LINE DEAD", `${why}. Fix it and try again.`, 9000);
      if (!reveal.speaking) { if (started) transcript.endLive(); scene.setSpeaking(false); document.body.classList.remove("letterbox"); setBusy(false); }
    } else {
      reveal.finish(); reveal.reset();
      if (detective) detective.mouth.clear();
      if (started) transcript.endLive();
      scene.setSpeaking(false);
      document.body.classList.remove("letterbox");
      setBusy(false);
      audio.play("tick", 0.3);
      showCard("LINE DEAD", `${why}. Press Enter to try again.`);
    }
    if (!hidden) input.value = userText;
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  if (busy && reveal.speaking) { reveal.skip(); if (detective) detective.mouth.clear(); return; }
  if (busy) return;
  input.value = ""; input.style.height = "auto";
  ask(text);
});
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (reveal.speaking) { reveal.skip(); if (detective) detective.mouth.clear(); if (!input.value.trim()) return; }
    form.requestSubmit();
  }
});
input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = `${Math.min(input.scrollHeight, 120)}px`; });
function restart() {
  chat.clear();
  reveal.reset(); voice.cancel(); if (detective) detective.mouth.clear();
  setBusy(false); // release the lock the aborted turn held
  transcript.clear(); bubble.hide(); ending.hidden = true; turns = 0; interviewOver = false; pendingEnd = false;
  audio.setAmbienceLevel(0.16);
  if (detective) detective.cue({ lean: 0, headDown: 0 });
  input.focus();
  setTimeout(() => ask(SEED, { hidden: true }), 50);
}
$("clear").addEventListener("click", restart);
$("again").addEventListener("click", restart);
voiceBox.addEventListener("change", () => voice.setEnabled(voiceBox.checked));
if (status.ttsEnabled) voiceRow.hidden = false;

// Look-around with the mouse; a little, not a lot.
addEventListener("pointermove", (e) => {
  if (touch) return;
  scene.setLook((e.clientX / innerWidth - 0.5) * 2, -(e.clientY / innerHeight - 0.5) * 2);
});
let touchLook = { x: 0, y: 0, sx: 0, sy: 0 };
$("view").addEventListener("touchstart", (e) => { const t = e.touches[0]; touchLook.sx = t.clientX; touchLook.sy = t.clientY; }, { passive: true });
$("view").addEventListener("touchmove", (e) => {
  const t = e.touches[0];
  touchLook.x = Math.max(-1, Math.min(1, touchLook.x + (t.clientX - touchLook.sx) / innerWidth * 2));
  touchLook.y = Math.max(-1, Math.min(1, touchLook.y - (t.clientY - touchLook.sy) / innerHeight * 2));
  touchLook.sx = t.clientX; touchLook.sy = t.clientY;
  scene.setLook(touchLook.x, touchLook.y);
}, { passive: true });
addEventListener("resize", () => scene.resize());
if (window.visualViewport) visualViewport.addEventListener("resize", () => {
  const covered = Math.max(0, innerHeight - visualViewport.height - visualViewport.offsetTop);
  document.documentElement.style.setProperty("--kb", `${covered}px`);
});
$("view").addEventListener("webglcontextlost", (e) => { e.preventDefault(); showCard("THE LIGHTS WENT OUT", "reload the page.", 60000); });

// ---- gate + opening beat ----------------------------------------------
const gateReady = () => {
  sit.disabled = false;
  gateNote.textContent = status.chatEnabled ? "He is waiting." : "No key on file: add OPENAI_API_KEY to .env and restart. He'll tell you the same.";
};
if (total === 0 || loaded >= total) gateReady(); else manager.onLoad = () => { progressBar.style.width = "100%"; gateReady(); };
setTimeout(gateReady, 15000);

sit.addEventListener("click", () => {
  audio.unlock();
  gate.classList.add("out");
  document.body.classList.remove("loading");
  if (!reducedMotion) document.body.classList.add("letterbox");
  // Lamp click, light snaps on, he raises his head, then speaks.
  const spot = scene.spot, cone = scene.cone;
  const base = scene.spotBase;
  scene.spotBase = 0; spot.intensity = 0; if (cone) cone.visible = false;
  setTimeout(() => {
    audio.lampClick();
    scene.spotBase = base; if (cone) cone.visible = true;
    scene.flicker(500);
    audio.startAmbience();
    if (detective) detective.raiseHead(0.32, 700);
  }, 700);
  setTimeout(() => { transcript.show(); form.hidden = false; input.focus(); }, 1500);
  ask(SEED, { hidden: true, holdMs: 1600 });
}, { once: true });
// Some browsers keep the AudioContext suspended after the first gesture; retry once.
addEventListener("pointerdown", () => { if (audio.ctx && audio.ctx.state !== "running") audio.unlock(); }, { passive: true });
// Click anywhere in the room to skip the typewriter.
$("view").addEventListener("pointerdown", () => { if (reveal.speaking) { reveal.skip(); if (detective) detective.mouth.clear(); } });

// ---- frame loop --------------------------------------------------------
const headPos = new THREE.Vector3();
function frame() {
  requestAnimationFrame(frame);
  const { dt } = scene.update();
  const now = performance.now();
  reveal.update(now);
  voice.update();
  cuffs.update(dt);
  if (detective) {
    detective.update(dt, now / 1000, scene.camera);
    detective.headWorld(headPos);
    headPos.y += 0.16; headPos.x += 0.12;
    bubble.setAnchor(headPos);
  }
  bubble.update();
  scene.render();
}
frame();
