#!/usr/bin/env node
// Offline verification of the shipped asset pipeline. No npm installs (only
// Node built-ins: node:worker_threads, node:module, node:http, node:fs). Loads
// the REAL vendored three.js (public/vendor/three) via a dynamic import with a
// file:// URL plus a tiny loader hook that resolves the bare 'three' specifier
// (see scripts/_three-node-loader.mjs) -- the same module code that ships to
// the browser, not a separately npm-installed copy.
//
// Draco-compressed geometry needs a Worker; Node has no Web Worker /
// URL.createObjectURL(Blob) support, so a small dependency-free polyfill
// below (node:worker_threads eval mode) stands in for it. A tiny local
// HTTP server (127.0.0.1 only) serves the vendored draco decoder files,
// since Node's fetch() (used internally by three's FileLoader) does not
// support file:// URLs. No external network access is used anywhere.
//
// Usage: node scripts/verify.mjs
// Exit code: 0 = all checks passed, 1 = at least one check failed.

import { Worker as NodeWorker } from 'node:worker_threads';
import { register } from 'node:module';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const failures = [];
const ok = (label) => console.log(`  OK   ${label}`);
const fail = (label, detail) => { failures.push(`${label}${detail ? ' -- ' + detail : ''}`); console.log(`  FAIL ${label}${detail ? ' -- ' + detail : ''}`); };

// ---------------------------------------------------------------------------
// 1. Canonical asset table -- every file must exist with bytes > 0.
// ---------------------------------------------------------------------------
const CANONICAL_ASSETS = [
  'public/vendor/three/three.module.js',
  'public/vendor/three/three.core.js',
  'public/vendor/three/LICENSE',
  'public/vendor/three/addons/loaders/GLTFLoader.js',
  'public/vendor/three/addons/loaders/DRACOLoader.js',
  'public/vendor/three/addons/loaders/RGBELoader.js',
  'public/vendor/three/addons/loaders/HDRLoader.js',
  'public/vendor/three/addons/capabilities/WebGL.js',
  'public/vendor/three/addons/utils/BufferGeometryUtils.js',
  'public/vendor/three/addons/utils/SkeletonUtils.js',
  'public/vendor/three/addons/libs/draco/gltf/draco_decoder.wasm',
  'public/vendor/three/addons/libs/draco/gltf/draco_wasm_wrapper.js',
  'public/vendor/three/addons/libs/draco/gltf/draco_decoder.js',
  'public/js/lipsync-en.mjs',
  'public/assets/detective.glb',
  'public/assets/clips/sit_idle.glb',
  'public/assets/room/wooden_table_02.glb',
  'public/assets/room/school_chair_01.glb',
  'public/assets/room/hanging_industrial_lamp.glb',
  'public/assets/tex/concrete_wall_diff.jpg',
  'public/assets/tex/concrete_wall_nor.jpg',
  'public/assets/tex/concrete_wall_rough.jpg',
  'public/assets/tex/concrete_floor_diff.jpg',
  'public/assets/tex/concrete_floor_nor.jpg',
  'public/assets/tex/concrete_floor_rough.jpg',
  'public/assets/hdr/warehouse_1k.hdr',
  'public/assets/fonts/CourierPrime-Regular.ttf',
  'public/assets/fonts/CourierPrime-Bold.ttf',
  'public/assets/fonts/SpecialElite-Regular.ttf',
  'public/assets/sfx/tick.ogg',
  'public/assets/sfx/creak.ogg',
  'public/assets/sfx/slam.ogg',
  'public/assets/sfx/click.ogg',
  'public/assets/MANIFEST.json',
  'THIRD_PARTY_NOTICES.md',
];

console.log('=== 1. canonical asset table (exists, bytes > 0) ===');
for (const rel of CANONICAL_ASSETS) {
  const p = path.join(REPO, rel);
  if (!fs.existsSync(p)) { fail(rel, 'missing'); continue; }
  const bytes = fs.statSync(p).size;
  if (bytes <= 0) { fail(rel, 'zero bytes'); continue; }
  ok(`${rel} (${bytes} bytes)`);
}

// ---------------------------------------------------------------------------
// 2. MANIFEST.json cross-check: every entry's declared bytes/sha256 matches
//    the file on disk.
// ---------------------------------------------------------------------------
console.log('\n=== 2. MANIFEST.json bytes/sha256 cross-check ===');
try {
  const crypto = await import('node:crypto');
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO, 'public/assets/MANIFEST.json'), 'utf8'));
  for (const e of manifest) {
    const p = path.join(REPO, e.file);
    if (!fs.existsSync(p)) { fail(e.file, 'listed in manifest but missing on disk'); continue; }
    const buf = fs.readFileSync(p);
    if (buf.length !== e.bytes) { fail(e.file, `manifest bytes ${e.bytes} != actual ${buf.length}`); continue; }
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    if (sha !== e.sha256) { fail(e.file, `manifest sha256 mismatch`); continue; }
    ok(e.file);
  }
} catch (e) {
  fail('MANIFEST.json cross-check', e.message);
}

// ---------------------------------------------------------------------------
// 3. Node-side dependency-free Worker/Blob polyfill + module loader hook, so
//    we can dynamic-import the real vendored GLTFLoader/DRACOLoader and
//    actually decode draco-compressed geometry.
// ---------------------------------------------------------------------------
const NODE_WORKER_PREAMBLE = `
const { parentPort } = require('node:worker_threads');
globalThis.self = globalThis;
globalThis.postMessage = (data, transfer) => parentPort.postMessage(data, transfer);
let __onmessage = null;
Object.defineProperty(globalThis, 'onmessage', {
  get() { return __onmessage; },
  set(fn) { __onmessage = fn; },
});
parentPort.on('message', (data) => { if (__onmessage) __onmessage({ data }); });
`;

const blobRegistry = new Map();
let blobCounter = 0;
class FakeBlob {
  constructor(parts) { this._text = NODE_WORKER_PREAMBLE + parts.join(''); }
}
URL.createObjectURL = (blob) => {
  const id = `nodeworkerblob:${blobCounter++}`;
  blobRegistry.set(id, blob._text);
  return id;
};
URL.revokeObjectURL = (url) => { blobRegistry.delete(url); };
globalThis.Blob = FakeBlob;

class BrowserlikeWorker {
  constructor(url) {
    const src = blobRegistry.has(url) ? blobRegistry.get(url) : url;
    this._w = new NodeWorker(src, { eval: true });
    this.onmessage = null;
    this.onerror = null;
    this._w.on('message', (data) => { if (this.onmessage) this.onmessage({ data }); });
    this._w.on('error', (err) => { if (this.onerror) this.onerror(err); else console.error('worker error', err); });
  }
  postMessage(data, transferList) { this._w.postMessage(data, transferList); }
  terminate() { this._w.terminate(); }
}
globalThis.Worker = BrowserlikeWorker;

if (typeof globalThis.ProgressEvent === 'undefined') {
  globalThis.ProgressEvent = class ProgressEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.lengthComputable = !!init.lengthComputable;
      this.loaded = init.loaded || 0;
      this.total = init.total || 0;
    }
  };
}

register('./_three-node-loader.mjs', import.meta.url);

// Local-only static server for the draco decoder assets (three's FileLoader
// uses fetch(), which has no file:// support in Node). 127.0.0.1, ephemeral
// port, torn down at the end -- no external network access.
const DRACO_DIR = path.join(REPO, 'public/vendor/three/addons/libs/draco/gltf/');
const server = http.createServer((req, res) => {
  const f = path.join(DRACO_DIR, decodeURIComponent(req.url.slice(1)));
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200); res.end(data);
  });
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const dracoPort = server.address().port;

const { GLTFLoader } = await import(`file://${path.join(REPO, 'public/vendor/three/addons/loaders/GLTFLoader.js')}`);
const { DRACOLoader } = await import(`file://${path.join(REPO, 'public/vendor/three/addons/loaders/DRACOLoader.js')}`);

function stripImagesForParse(glbPath) {
  const b = fs.readFileSync(glbPath);
  const jl = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + jl).toString('utf8'));
  delete j.images; delete j.textures; delete j.samplers;
  for (const m of j.materials || []) {
    delete m.normalTexture; delete m.occlusionTexture; delete m.emissiveTexture;
    if (m.pbrMetallicRoughness) { delete m.pbrMetallicRoughness.baseColorTexture; delete m.pbrMetallicRoughness.metallicRoughnessTexture; }
  }
  let js = Buffer.from(JSON.stringify(j));
  while (js.length % 4) js = Buffer.concat([js, Buffer.from(' ')]);
  const rest = b.subarray(20 + jl);
  const hdr = Buffer.alloc(20);
  hdr.write('glTF', 0); hdr.writeUInt32LE(2, 4); hdr.writeUInt32LE(20 + js.length + rest.length, 8);
  hdr.writeUInt32LE(js.length, 12); hdr.writeUInt32LE(0x4E4F534A, 16);
  const out = Buffer.concat([hdr, js, rest]);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}

function loadGltf(glbPath, { withDraco } = {}) {
  const loader = new GLTFLoader();
  if (withDraco) {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(`http://127.0.0.1:${dracoPort}/`);
    loader.setDRACOLoader(dracoLoader);
  }
  const ab = stripImagesForParse(glbPath);
  return new Promise((resolve, reject) => loader.parse(ab, '', resolve, reject));
}

// Minimal, dependency-free image-dimension readers (JPEG SOF marker scan /
// PNG IHDR chunk) so we can assert real texture resolution without needing
// an Image/canvas implementation in Node.
function jpegDimensions(buf) {
  let i = 2; // skip SOI (0xFFD8)
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    if (marker === 0xd9) break; // EOI
    const segLen = buf.readUInt16BE(i + 2);
    const isSOF = (marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSOF) {
      const height = buf.readUInt16BE(i + 5);
      const width = buf.readUInt16BE(i + 7);
      return { width, height };
    }
    i += 2 + segLen;
  }
  return null;
}
function pngDimensions(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}
function readGlbImageDimensions(glbPath) {
  const b = fs.readFileSync(glbPath);
  const jl = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + jl).toString('utf8'));
  let binOffset = 20 + jl;
  // account for the JSON chunk's own 8-byte chunk header already consumed above (offset 20 = 12 header + 8 chunk0 header)
  // find BIN chunk (after JSON chunk header+data)
  const jsonChunkLen = jl;
  const binChunkStart = 12 + 8 + jsonChunkLen; // file header(12) + json chunk header(8) + json data
  const binChunkLen = b.readUInt32LE(binChunkStart);
  const binData = b.subarray(binChunkStart + 8, binChunkStart + 8 + binChunkLen);
  const results = [];
  for (const img of j.images || []) {
    if (img.bufferView === undefined) { results.push({ name: img.name, dims: null, note: 'no bufferView (uri-based)' }); continue; }
    const bv = j.bufferViews[img.bufferView];
    const start = bv.byteOffset || 0;
    const bytes = binData.subarray(start, start + bv.byteLength);
    let dims = null;
    if (img.mimeType === 'image/jpeg') dims = jpegDimensions(bytes);
    else if (img.mimeType === 'image/png') dims = pngDimensions(bytes);
    results.push({ name: img.name, mimeType: img.mimeType, dims });
  }
  return results;
}

// ---------------------------------------------------------------------------
// 4. detective.glb structural checks
// ---------------------------------------------------------------------------
console.log('\n=== 3. detective.glb (real vendored GLTFLoader + DRACOLoader) ===');
try {
  const detectivePath = path.join(REPO, 'public/assets/detective.glb');
  const gltf = await loadGltf(detectivePath, { withDraco: true });
  const meshes = [];
  gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });

  if (meshes.length === 3) ok(`3 primitives/meshes (got ${meshes.length})`);
  else fail('primitive count', `expected 3, got ${meshes.length}`);

  const expectedMaterials = ['m005_body', 'm005_head', 'm005_opacity'];
  for (const m of meshes) {
    const infl = m.morphTargetInfluences?.length;
    const dictKeys = Object.keys(m.morphTargetDictionary || {}).length;
    if (infl === 175 && dictKeys === 175) ok(`mesh "${m.name}" (material ${m.material?.name}): 175 morph influences, 175 dict keys`);
    else fail(`mesh "${m.name}" morph target count`, `influences=${infl} dictKeys=${dictKeys}, expected 175/175`);

    if (!expectedMaterials.includes(m.material?.name)) fail(`mesh "${m.name}" material name`, `unexpected "${m.material?.name}"`);

    const sil = m.morphTargetDictionary?.['AA_VI_00_Sil'];
    const aa = m.morphTargetDictionary?.['AA_VI_10_aa'];
    if (sil === 0 && aa === 10) ok(`  targetNames: AA_VI_00_Sil=0, AA_VI_10_aa=10`);
    else fail(`  targetNames on ${m.name}`, `AA_VI_00_Sil=${sil} (want 0), AA_VI_10_aa=${aa} (want 10)`);

    if (m.material?.name === 'm005_opacity') {
      const hm = m.material;
      const isMask = hm.alphaTest === 0.5 && hm.side === 2 /* THREE.DoubleSide */;
      if (isMask) ok(`  hair material: alphaTest=0.5, doubleSided (MASK 0.5)`);
      else fail('  hair material MASK/doubleSided', `alphaTest=${hm.alphaTest}, side=${hm.side}`);
    }
  }

  for (const boneName of ['Bip01_MJaw', 'Bip01_Head', 'Bip01_LEye', 'Bip01_REye']) {
    const obj = gltf.scene.getObjectByName(boneName);
    if (obj) ok(`bone "${boneName}" present`);
    else fail(`bone "${boneName}"`, 'missing');
  }

  const dims = readGlbImageDimensions(detectivePath);
  if (dims.length === 5) ok(`5 embedded textures`);
  else fail('embedded texture count', `expected 5, got ${dims.length}`);
  for (const d of dims) {
    if (d.dims && d.dims.width === 1024 && d.dims.height === 1024) ok(`  texture (${d.mimeType}) 1024x1024`);
    else fail(`  texture (${d.mimeType || '?'}) dims`, JSON.stringify(d.dims));
  }

  console.log(`  detective.glb size: ${fs.statSync(detectivePath).size} bytes (${(fs.statSync(detectivePath).size / 1024 / 1024).toFixed(2)} MB)`);
} catch (e) {
  fail('detective.glb parse', e.stack || e.message);
}

// ---------------------------------------------------------------------------
// 5. sit_idle.glb structural checks
// ---------------------------------------------------------------------------
console.log('\n=== 4. clips/sit_idle.glb (real vendored GLTFLoader) ===');
try {
  const clipPath = path.join(REPO, 'public/assets/clips/sit_idle.glb');
  const gltf = await loadGltf(clipPath, { withDraco: false });

  if (gltf.animations.length === 1) ok(`animations.length === 1`);
  else fail('animations.length', `expected 1, got ${gltf.animations.length}`);

  const clip = gltf.animations[0];
  const durationOk = Math.abs(clip.duration - 45.7) < 0.5;
  if (durationOk) ok(`duration ${clip.duration.toFixed(3)}s (~45.7s)`);
  else fail('duration', `${clip.duration}, expected ~45.7s`);

  const names = clip.tracks.map((t) => t.name);
  const bip01Tracks = names.filter((n) => n.startsWith('Bip01'));
  if (bip01Tracks.length === names.length) ok(`all ${names.length} tracks are Bip01* (root track "Bip01.position" has no trailing underscore, as expected)`);
  else fail('track naming', `${names.length - bip01Tracks.length} tracks do not start with "Bip01"`);

  let meshCount = 0;
  gltf.scene.traverse((o) => { if (o.isMesh) meshCount++; });
  if (meshCount === 0) ok('0 meshes in clip scene (animation-only, as required)');
  else fail('clip scene mesh count', `expected 0, got ${meshCount}`);

  console.log(`  sit_idle.glb size: ${fs.statSync(clipPath).size} bytes`);
  console.log(`  track count: ${names.length}, first 10: ${JSON.stringify(names.slice(0, 10))}`);
} catch (e) {
  fail('sit_idle.glb parse', e.stack || e.message);
}

server.close();

// ---------------------------------------------------------------------------
// 6. .env must never be tracked by git (the one read-only git command
//    explicitly allowed by the brief).
// ---------------------------------------------------------------------------
console.log('\n=== 5. git ls-files .env (must be empty) ===');
try {
  const out = execFileSync('git', ['ls-files', '.env'], { cwd: REPO }).toString().trim();
  if (out === '') ok('.env is not tracked by git');
  else fail('.env tracked by git', out);
} catch (e) {
  fail('git ls-files .env', e.message);
}

// ---------------------------------------------------------------------------
console.log('\n=== summary ===');
if (failures.length === 0) {
  console.log(`ALL CHECKS PASSED`);
  process.exit(0);
} else {
  console.log(`${failures.length} CHECK(S) FAILED:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
