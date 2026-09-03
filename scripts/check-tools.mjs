#!/usr/bin/env node
// Preflight tool check for the asset pipeline (scripts/fetch-assets.mjs).
// No dependencies. Always exits 0 -- this is informational, not a gate; the
// repo ships pre-converted GLBs so a missing FBX2glTF/Pillow/etc. does not
// block anyone from running the app, only from re-running the conversion.
//
// Usage: node scripts/check-tools.mjs

import { execFileSync } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';

function tryRun(cmd, args) {
  try {
    return execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  } catch {
    return null;
  }
}

function has(cmd, args = ['--version']) {
  return tryRun(cmd, args) !== null;
}

console.log('=== asset pipeline tool check ===');
console.log('arch:', process.arch, `(${os.arch()})`);
console.log('platform:', process.platform);
console.log('node:', process.version);

const isRosetta = process.platform === 'darwin' && process.arch === 'x64' && os.cpus()[0]?.model?.includes('Apple');
if (process.platform === 'darwin') {
  const sysctl = tryRun('sysctl', ['-n', 'sysctl.proc_translated']);
  console.log('macOS Rosetta translated process:', sysctl === '1' ? 'yes' : sysctl === '0' ? 'no' : 'unknown');
}

const python3 = has('python3', ['--version']);
console.log('python3:', python3 ? tryRun('python3', ['--version']) : 'MISSING');
if (python3) {
  const pillow = tryRun('python3', ['-c', 'import PIL; print(PIL.__version__)']);
  console.log('  Pillow:', pillow || 'MISSING (pip3 install --user pillow)');
}

const ffmpeg = has('ffmpeg', ['-version']);
console.log('ffmpeg:', ffmpeg ? (tryRun('ffmpeg', ['-version']) || '').split('\n')[0] : 'MISSING');

// FBX2glTF: check known locations (npm fbx2gltf package binaries, or a global install)
const fbx2gltfCandidates = [
  './node_modules/fbx2gltf/bin/Darwin/FBX2glTF',
  './node_modules/fbx2gltf/bin/Linux/FBX2glTF',
  '/usr/local/bin/FBX2glTF',
  '/opt/homebrew/bin/FBX2glTF',
];
let fbx2gltfPath = null;
for (const c of fbx2gltfCandidates) {
  if (fs.existsSync(c)) { fbx2gltfPath = c; break; }
}
if (!fbx2gltfPath) {
  const which = tryRun('which', ['FBX2glTF']);
  if (which) fbx2gltfPath = which;
}
console.log('FBX2glTF:', fbx2gltfPath || 'MISSING');

// gltf-transform CLI (via npx, without forcing a global install)
const gltfTransform = tryRun('npx', ['--no-install', 'gltf-transform', '--version']);
console.log('gltf-transform:', gltfTransform || 'MISSING (npx --no-install gltf-transform failed; run npm i -D @gltf-transform/cli in scripts/ or a local install dir)');

console.log('===');
if (!fbx2gltfPath) {
  console.log('FALLBACK: FBX2glTF not found -- using the committed pre-converted GLBs (public/assets/detective.glb, public/assets/clips/sit_idle.glb). Only scripts/fetch-assets.mjs needs FBX2glTF; the app itself does not.');
}
if (!python3 || tryRun('python3', ['-c', 'import PIL']) === null) {
  console.log('NOTE: Pillow not available -- fetch-assets.mjs texture downscale step would need it (or fall back to `sips`, macOS only).');
}

process.exit(0);
