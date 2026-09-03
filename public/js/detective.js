// The detective: Rocketbox GLB + seated idle clip (facial tracks stripped),
// blink, head offsets, lean, and the mouth driver (text-derived visemes).
import * as THREE from "three";
import { LipsyncEn } from "./lipsync-en.mjs";

// Oculus viseme order as stored in the GLB (AA_VI_00_Sil .. AA_VI_14_U).
const VISEMES = ["sil", "PP", "FF", "TH", "DD", "kk", "CH", "SS", "nn", "RR", "aa", "E", "I", "O", "U"];
const FACIAL_TRACK = /(MJaw|Lip|Mouth|Eye|Brow|Cheek|Nose|Tongue|Masseter|Caninus|Jaw)/i;
const ATTACK = 0.045, RELEASE = 0.08, AMP = 0.85;

class Mouth {
  constructor(meshes, dict) {
    this.meshes = meshes;
    this.lip = new LipsyncEn();
    this.events = [];
    this.weights = new Float32Array(VISEMES.length);
    this.gain = 1;
    this.levelGain = 1;
    // Map viseme slot -> morph index; names first, index order as fallback.
    this.index = VISEMES.map((id, i) => {
      const key = Object.keys(dict).find((k) => new RegExp(`^AA_VI_${String(i).padStart(2, "0")}_`).test(k));
      return key !== undefined ? dict[key] : i;
    });
  }
  // Queue a word's visemes. The typewriter runs faster than speech, so each
  // viseme keeps a readable minimum length and the mouth is allowed to lag
  // the text by up to a second; past that, the word is compressed to catch up.
  speakWord(word, seconds, at) {
    let r;
    try { r = this.lip.wordsToVisemes(this.lip.preProcessText(word).toLowerCase()); } catch { return; }
    if (!r || !r.visemes || !r.visemes.length) return;
    const total = r.times[r.times.length - 1] + r.durations[r.durations.length - 1];
    const start = Math.max(at, this.lastEnd || 0);
    const lag = start - at;
    const minPer = lag > 1.0 ? 0.035 : 0.07;
    const span = Math.max(seconds, minPer * r.visemes.length);
    const scale = span / Math.max(0.001, total);
    for (let i = 0; i < r.visemes.length; i++) {
      const slot = VISEMES.indexOf(r.visemes[i]);
      if (slot <= 0) continue;
      this.events.push({ slot, start: start + r.times[i] * scale, end: start + (r.times[i] + r.durations[i]) * scale + 0.02 });
    }
    this.lastEnd = start + span + 0.04;
  }
  clear() { this.events.length = 0; this.lastEnd = 0; }
  update(now, dt) {
    const desired = new Float32Array(VISEMES.length);
    let keep = 0;
    for (const e of this.events) {
      if (e.end < now - 0.5) continue;
      this.events[keep++] = e;
      if (now >= e.start && now <= e.end) {
        const phase = Math.min(1, (now - e.start) / 0.05, (e.end - now) / 0.05 + 0.4);
        desired[e.slot] = Math.max(desired[e.slot], AMP * Math.max(0.2, phase));
      }
    }
    this.events.length = keep;
    const g = this.gain * this.levelGain;
    for (let i = 1; i < VISEMES.length; i++) {
      const target = desired[i] * g;
      const tau = target > this.weights[i] ? ATTACK : RELEASE;
      this.weights[i] += (target - this.weights[i]) * (1 - Math.exp(-dt / tau));
      const idx = this.index[i];
      for (const m of this.meshes) if (m.morphTargetInfluences) m.morphTargetInfluences[idx] = this.weights[i];
    }
  }
  get open() {
    return Math.max(this.weights[10], this.weights[11], this.weights[13], this.weights[14] * 0.8, this.weights[12] * 0.6);
  }
}

export class Detective {
  constructor(gltf, clip, { position, rotationY }) {
    this.root = gltf.scene;
    this.root.position.set(...position);
    this.root.rotation.y = rotationY;
    this.basePos = this.root.position.clone();
    this.meshes = [];
    let dict = {};
    this.root.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.castShadow = true; o.receiveShadow = true;
        o.frustumCulled = false;
        if (o.morphTargetInfluences) { this.meshes.push(o); if (o.morphTargetDictionary && Object.keys(o.morphTargetDictionary).length > Object.keys(dict).length) dict = o.morphTargetDictionary; }
        const mat = o.material;
        if (mat) {
          if (/opacity|hair/i.test(mat.name || "") || /opacity|hair/i.test(o.name || "")) {
            mat.transparent = false; mat.alphaTest = 0.5; mat.depthWrite = true; mat.side = THREE.DoubleSide;
          }
          if (/head/i.test(mat.name || "")) { mat.roughness = 0.62; mat.metalness = 0; if (mat.normalScale) mat.normalScale.set(0.6, 0.6); mat.envMapIntensity = 0.3; }
          else if ("roughness" in mat) { mat.roughness = Math.max(mat.roughness, 0.8); mat.metalness = 0; mat.envMapIntensity = 0.25; if (mat.color) mat.color.multiplyScalar(0.82); }
        }
      }
    });
    this.dict = dict;
    this.head = this.root.getObjectByName("Bip01_Head") || this.root.getObjectByName("Bip01 Head");
    this.jaw = this.root.getObjectByName("Bip01_MJaw");
    this.spine = this.root.getObjectByName("Bip01_Spine1") || this.root.getObjectByName("Bip01_Spine");
    this.mouth = new Mouth(this.meshes, dict);
    this.blinkIdx = Object.keys(dict).filter((k) => /EyeBlink/i.test(k)).map((k) => dict[k]);
    this.nextBlink = 2;
    this.blinkT = -1;
    this.headPitch = 0; this.headPitchTarget = 0;
    this.headYaw = 0;
    this.lean = 0; this.leanTarget = 0;
    this.headAxes = null;
    this.tmpQ = new THREE.Quaternion();
    this.tmpV = new THREE.Vector3();

    this.headRest = this.head ? this.head.quaternion.clone() : null;
    this.jawRest = this.jaw ? this.jaw.quaternion.clone() : null;
    this.hasHeadTrack = false;
    this.mixer = new THREE.AnimationMixer(this.root);
    if (clip) {
      const body = clip.clone();
      body.tracks = body.tracks.filter((tr) => !FACIAL_TRACK.test(tr.name));
      body.resetDuration();
      this.hasHeadTrack = Boolean(this.head) && body.tracks.some((t) => t.name.startsWith(this.head.name + "."));
      const action = this.mixer.clipAction(body);
      action.play();
      this.mixer.update(Math.random() * body.duration);
      this.clipDuration = body.duration;
    }
  }

  // Which local axes of the head bone face world X (nod) and world Y (turn)?
  // Measured once from the bind pose so the offsets work on any rig.
  solveHeadAxes() {
    if (!this.head) return;
    this.head.updateWorldMatrix(true, false);
    const q = this.head.getWorldQuaternion(new THREE.Quaternion());
    const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
    const pick = (world) => {
      let best = null, bestDot = 0;
      for (const a of axes) {
        const d = a.clone().applyQuaternion(q).dot(world);
        if (Math.abs(d) > Math.abs(bestDot)) { bestDot = d; best = a; }
      }
      return { axis: best, sign: Math.sign(bestDot) || 1 };
    };
    this.headAxes = { pitch: pick(new THREE.Vector3(1, 0, 0)), yaw: pick(new THREE.Vector3(0, 1, 0)) };
  }

  headWorld(out) {
    if (this.head) return this.head.getWorldPosition(out);
    return out.copy(this.root.position).add(new THREE.Vector3(0, 1.35, 0));
  }
  cue(spec) {
    if (spec.lean !== undefined) this.leanTarget = spec.lean;
    if (spec.headDown !== undefined) { this.headPitchTarget = spec.headDown; setTimeout(() => { this.headPitchTarget = 0; }, 1400); }
    if (spec.stare) { this.stareUntil = performance.now() + 2500; }
  }
  raiseHead(from = 0.35, ms = 700) {
    this.headPitch = from; this.headPitchTarget = 0; this.raiseMs = ms;
  }
  update(dt, now, camera) {
    this.mixer.update(dt);
    if (!this.headAxes) this.solveHeadAxes();

    // Lean: the whole body drifts toward or away from the camera.
    this.lean += (this.leanTarget - this.lean) * (1 - Math.exp(-dt * 3));
    this.root.position.z = this.basePos.z + this.lean;

    // Head offset: pitch (nod) and a slight yaw toward the camera.
    this.headPitch += (this.headPitchTarget - this.headPitch) * (1 - Math.exp(-dt * 4));
    let yawTarget = 0;
    if (camera && this.head) {
      const hp = this.head.getWorldPosition(this.tmpV);
      const dx = camera.position.x - hp.x, dz = camera.position.z - hp.z;
      yawTarget = THREE.MathUtils.clamp(Math.atan2(dx, dz), -0.25, 0.25) * 0.6;
    }
    this.headYaw += (yawTarget - this.headYaw) * (1 - Math.exp(-dt * 2));
    // The offsets below are relative; without a clip rewriting the bone each frame they would accumulate.
    if (this.head && !this.hasHeadTrack && this.headRest) this.head.quaternion.copy(this.headRest);
    if (this.head && this.headAxes) {
      const { pitch, yaw } = this.headAxes;
      this.tmpQ.setFromAxisAngle(pitch.axis, -this.headPitch * pitch.sign);
      this.head.quaternion.multiply(this.tmpQ);
      this.tmpQ.setFromAxisAngle(yaw.axis, this.headYaw * yaw.sign);
      this.head.quaternion.multiply(this.tmpQ);
    }

    // Blink.
    if (this.blinkIdx.length) {
      this.nextBlink -= dt;
      if (this.nextBlink <= 0 && this.blinkT < 0 && !(this.stareUntil > performance.now())) { this.blinkT = 0; this.nextBlink = 2 + Math.random() * 4; }
      if (this.blinkT >= 0) {
        this.blinkT += dt;
        const w = this.blinkT < 0.15 ? this.blinkT / 0.15 : Math.max(0, 1 - (this.blinkT - 0.15) / 0.25);
        for (const m of this.meshes) for (const i of this.blinkIdx) m.morphTargetInfluences[i] = w;
        if (this.blinkT > 0.4) this.blinkT = -1;
      }
    }

    this.mouth.update(now, dt);
    // Jaw bone follows the open visemes a little; the morphs do most of the work.
    if (this.jaw && this.jawRest && this.headAxes) {
      this.jaw.quaternion.copy(this.jawRest);
      this.tmpQ.setFromAxisAngle(this.headAxes.pitch.axis, this.mouth.open * 0.18 * this.headAxes.pitch.sign);
      this.jaw.quaternion.multiply(this.tmpQ);
    }
  }
}

export async function loadDetective({ loader, url, clipUrl, position, rotationY }) {
  const gltf = await loader.loadAsync(url);
  let clip = null;
  try {
    const c = await loader.loadAsync(clipUrl);
    clip = c.animations?.[0] || null;
  } catch { clip = null; }
  return new Detective(gltf, clip, { position, rotationY });
}
