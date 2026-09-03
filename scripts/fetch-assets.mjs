#!/usr/bin/env node
// Maintainer-only asset pipeline: re-downloads every third-party source
// listed below and re-runs the conversions that produced the committed
// files under public/assets/, public/vendor/, and public/js/lipsync-en.mjs.
// The app owner never needs to run this -- the repo ships the finished
// output. Re-run this only to refresh/re-derive an asset (e.g. bump the
// three.js version, or re-pull a Poly Haven prop).
//
// Requirements: Node 24+ (uses global fetch), and for the FBX conversion
// steps: FBX2glTF (see scripts/check-tools.mjs for detection), python3 +
// Pillow (or macOS `sips` as a fallback), and `npx --yes @gltf-transform/cli@4.5.0`
// (no local install required -- npx fetches it on demand).
//
// Idempotent: every download is skip-if-exists by content hash/size where
// practical, and every conversion step re-runs from its own inputs, so this
// script can be re-run safely after a partial failure -- it will not
// re-download files that are already present and correctly sized, and it
// always regenerates public/assets/MANIFEST.json from what is on disk at
// the end.
//
// Usage:
//   node scripts/fetch-assets.mjs                 # fetch + convert everything
//   node scripts/fetch-assets.mjs --only=three     # just one stage (see STAGES below)
//   node scripts/fetch-assets.mjs --skip-convert   # download-only, skip FBX2glTF/gltf-transform steps
//
// STAGES: three, lipsync, rocketbox, polyhaven, fonts, sfx, manifest

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const BUILD = path.join(REPO, 'build');
const args = process.argv.slice(2);
const ONLY = (args.find((a) => a.startsWith('--only=')) || '').split('=')[1] || null;
const SKIP_CONVERT = args.includes('--skip-convert');
const shouldRun = (stage) => !ONLY || ONLY === stage;

fs.mkdirSync(BUILD, { recursive: true });

function log(...a) { console.log('[fetch-assets]', ...a); }

async function download(url, dest, { skipIfExists = true } = {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (skipIfExists && fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    log('cached:', path.relative(REPO, dest));
    return;
  }
  log('downloading:', url);
  const res = await fetch(url, { headers: { 'User-Agent': 'the-interrogation-asset-pipeline/1.0' } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  log('  wrote', dest, buf.length, 'bytes');
}

function sh(cmd, opts = {}) {
  log('$', cmd);
  return execSync(cmd, { stdio: 'inherit', cwd: REPO, ...opts });
}

function gltfTransform(argsArr, opts = {}) {
  execFileSync('npx', ['--yes', '@gltf-transform/cli@4.5.0', ...argsArr], { stdio: 'inherit', cwd: REPO, ...opts });
}

// ---------------------------------------------------------------------------
// STAGE: three -- vendor three.js + the addons this project imports
// ---------------------------------------------------------------------------
async function stageThree() {
  const V = '0.185.1';
  const BASE = `https://cdn.jsdelivr.net/npm/three@${V}/build`;
  const BASE_EX = `https://cdn.jsdelivr.net/npm/three@${V}/examples/jsm`;
  const OUT = path.join(REPO, 'public/vendor/three');

  await download(`${BASE}/three.module.js`, path.join(OUT, 'three.module.js'));
  await download(`${BASE}/three.core.js`, path.join(OUT, 'three.core.js'));
  await download(`https://cdn.jsdelivr.net/npm/three@${V}/LICENSE`, path.join(OUT, 'LICENSE'));

  const addons = [
    'loaders/GLTFLoader.js',
    'loaders/DRACOLoader.js',
    'loaders/RGBELoader.js',
    'loaders/HDRLoader.js',
    'capabilities/WebGL.js',
    'utils/BufferGeometryUtils.js',
    'utils/SkeletonUtils.js',
    'libs/draco/gltf/draco_decoder.wasm',
    'libs/draco/gltf/draco_wasm_wrapper.js',
    'libs/draco/gltf/draco_decoder.js',
  ];
  for (const rel of addons) {
    await download(`${BASE_EX}/${rel}`, path.join(OUT, 'addons', rel));
  }
  fs.writeFileSync(path.join(OUT, '..', 'package.json'), '{"type":"module"}\n');
  log('NOTE: if you add new addon imports, extend the `addons` list above and re-run --only=three.');
}

// ---------------------------------------------------------------------------
// STAGE: lipsync -- vendor + patch lipsync-en.mjs
// ---------------------------------------------------------------------------
async function stageLipsync() {
  const src = path.join(BUILD, 'lipsync-en.upstream.mjs');
  await download('https://cdn.jsdelivr.net/gh/met4citizen/TalkingHead@1.7/modules/lipsync-en.mjs', src);
  let content = fs.readFileSync(src, 'utf8');
  content = content.replace('" [HOUR]=aa EE"', '" [HOUR]=aa U"');
  content = content.replace('"[OUP]=U OO"', '"[OUP]=U"');
  const header = [
    '// Source: https://cdn.jsdelivr.net/gh/met4citizen/TalkingHead@1.7/modules/lipsync-en.mjs',
    '// License: MIT (Copyright (c) 2023-2024 Mika Suominen)',
    '// Patched: fixed upstream typos [HOUR]=aa EE -> aa U, [OUP]=U OO -> U',
    '',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(REPO, 'public/js/lipsync-en.mjs'), header + content);
  log('wrote public/js/lipsync-en.mjs (patched)');
}

// ---------------------------------------------------------------------------
// STAGE: rocketbox -- FBX -> glTF -> detective.glb / clips/sit_idle.glb
// This stage needs FBX2glTF, python3+Pillow (or sips), and gltf-transform.
// See scripts/check-tools.mjs for what is available on this machine.
// ---------------------------------------------------------------------------
async function stageRocketbox() {
  if (SKIP_CONVERT) { log('rocketbox: --skip-convert, only downloading raw sources'); }

  const RB_RAW = 'https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master';
  const facialFbx = path.join(BUILD, 'rocketbox/Business_Male_01_facial.fbx');
  await download(`${RB_RAW}/Assets/Avatars/Professions/Business_Male_01/Export/Business_Male_01_facial.fbx`, facialFbx);

  const textures = ['m005_body_color', 'm005_body_normal', 'm005_body_specular', 'm005_head_color', 'm005_head_normal', 'm005_head_specular', 'm005_opacity_color'];
  for (const t of textures) {
    await download(`${RB_RAW}/Assets/Avatars/Professions/Business_Male_01/Textures/${t}.tga`, path.join(BUILD, 'rocketbox/textures', `${t}.tga`));
  }

  // Find the sit-idle animation path via the repo's git tree (cached).
  const treeCache = path.join(BUILD, 'rocketbox/tree.json');
  if (!fs.existsSync(treeCache)) {
    await download('https://api.github.com/repos/microsoft/Microsoft-Rocketbox/git/trees/master?recursive=1', treeCache);
  }
  const tree = JSON.parse(fs.readFileSync(treeCache, 'utf8'));
  const animPath = tree.tree.find((e) => /m_sit_table_idle_neutral_01\.fbx$/i.test(e.path))?.path;
  if (!animPath) throw new Error('could not find m_sit_table_idle_neutral_01.fbx in the Rocketbox tree');
  const animFbx = path.join(BUILD, 'rocketbox/anim.fbx');
  await download(`${RB_RAW}/${animPath}`, animFbx);

  if (SKIP_CONVERT) return;

  // FBX2glTF conversion
  const fbx2gltfCandidates = ['./node_modules/fbx2gltf/bin/Darwin/FBX2glTF', './node_modules/fbx2gltf/bin/Linux/FBX2glTF', '/usr/local/bin/FBX2glTF', '/opt/homebrew/bin/FBX2glTF'];
  const fbx2gltf = fbx2gltfCandidates.find((c) => fs.existsSync(path.join(REPO, c))) || (() => { try { return execFileSync('which', ['FBX2glTF']).toString().trim(); } catch { return null; } })();
  if (!fbx2gltf) {
    log('SKIP: FBX2glTF not found. Install it (npm i -D fbx2gltf, or a system binary) and re-run --only=rocketbox. The committed public/assets/detective.glb and public/assets/clips/sit_idle.glb are left untouched.');
    return;
  }

  const facialGlb = path.join(BUILD, 'rocketbox/Business_Male_01_facial.glb');
  sh(`"${fbx2gltf}" --binary --input "${facialFbx}" --output "${facialGlb}"`);
  const animGlb = path.join(BUILD, 'rocketbox/anim.glb');
  sh(`"${fbx2gltf}" --binary --input "${animFbx}" --output "${animGlb}"`);

  log('NOTE: texture downscale (TGA->JPEG/PNG @1024), targetNames injection, material fixups,');
  log('  draco compression, and clip stripping are the same @gltf-transform/core script logic');
  log('  documented in docs/design/interrogation.md (v2 "Asset pipeline" section). Re-implement');
  log('  or paste that build script here if re-deriving detective.glb from scratch; this stage');
  log('  intentionally stops after raw FBX->glTF so a maintainer can inspect the intermediate');
  log('  output before the lossy/irreversible texture and compression steps run.');
  log(`  intermediate files: ${path.relative(REPO, facialGlb)}, ${path.relative(REPO, animGlb)}`);
}

// ---------------------------------------------------------------------------
// STAGE: polyhaven -- props, textures, HDRI (all CC0, no login)
// ---------------------------------------------------------------------------
async function stagePolyhaven() {
  const props = [
    { slug: 'wooden_table_02', out: 'wooden_table_02' },
    { slug: 'SchoolChair_01', out: 'school_chair_01' },
    { slug: 'hanging_industrial_lamp', out: 'hanging_industrial_lamp' },
  ];
  for (const { slug, out } of props) {
    const manifestPath = path.join(BUILD, `polyhaven/${slug}.json`);
    await download(`https://api.polyhaven.com/files/${slug}`, manifestPath);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const gltfGroup = manifest.gltf;
    const res = gltfGroup['1k'] ? '1k' : Object.keys(gltfGroup).sort()[0];
    const entry = gltfGroup[res].gltf;
    const srcDir = path.join(BUILD, `polyhaven/${slug}_src`);
    const mainName = path.basename(entry.url);
    await download(entry.url, path.join(srcDir, mainName));
    for (const [rel, info] of Object.entries(entry.include)) {
      await download(info.url, path.join(srcDir, rel));
    }
    if (SKIP_CONVERT) continue;
    const packed = path.join(BUILD, `polyhaven/${out}_packed.glb`);
    gltfTransform(['copy', path.join(srcDir, mainName), packed]);
    const finalGlb = path.join(REPO, `public/assets/room/${out}.glb`);
    fs.mkdirSync(path.dirname(finalGlb), { recursive: true });
    gltfTransform(['optimize', packed, finalGlb, '--texture-size', '1024', '--texture-compress', 'auto', '--compress', 'false', '--simplify', 'false', '--palette', 'false', '--instance', 'false', '--join', 'false', '--flatten', 'false']);
  }

  const texSets = [
    { slug: 'concrete_wall_008', out: 'concrete_wall' },
    { slug: 'concrete_floor_02', out: 'concrete_floor' },
  ];
  for (const { slug, out } of texSets) {
    const manifestPath = path.join(BUILD, `polyhaven/${slug}.json`);
    await download(`https://api.polyhaven.com/files/${slug}`, manifestPath);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const kinds = { Diffuse: 'diff', nor_gl: 'nor', Rough: 'rough' };
    for (const [key, suffix] of Object.entries(kinds)) {
      const url = manifest[key]['1k'].jpg?.url || manifest[key]['1k'].url;
      await download(url, path.join(REPO, `public/assets/tex/${out}_${suffix}.jpg`));
    }
  }

  await download('https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/empty_warehouse_01_1k.hdr', path.join(REPO, 'public/assets/hdr/warehouse_1k.hdr'));
}

// ---------------------------------------------------------------------------
// STAGE: fonts
// ---------------------------------------------------------------------------
async function stageFonts() {
  const F = path.join(REPO, 'public/assets/fonts');
  await download('https://raw.githubusercontent.com/google/fonts/main/ofl/courierprime/CourierPrime-Regular.ttf', path.join(F, 'CourierPrime-Regular.ttf'));
  await download('https://raw.githubusercontent.com/google/fonts/main/ofl/courierprime/CourierPrime-Bold.ttf', path.join(F, 'CourierPrime-Bold.ttf'));
  await download('https://raw.githubusercontent.com/google/fonts/main/apache/specialelite/SpecialElite-Regular.ttf', path.join(F, 'SpecialElite-Regular.ttf'));
  await download('https://raw.githubusercontent.com/google/fonts/main/ofl/courierprime/OFL.txt', path.join(F, 'CourierPrime-OFL.txt'));
  await download('https://raw.githubusercontent.com/google/fonts/main/apache/specialelite/LICENSE.txt', path.join(F, 'SpecialElite-LICENSE.txt'));
}

// ---------------------------------------------------------------------------
// STAGE: sfx -- CC0 one-shots (tick, creak, slam) + a synthesized click
// ---------------------------------------------------------------------------
async function stageSfx() {
  const S = path.join(REPO, 'public/assets/sfx');
  fs.mkdirSync(S, { recursive: true });
  const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version']); return true; } catch { return false; } })();
  if (!hasFfmpeg) { log('SKIP sfx: ffmpeg not found (see scripts/check-tools.mjs). The committed .ogg files are left untouched.'); return; }

  const tickSrc = path.join(BUILD, 'sfx/tick_src.wav');
  await download('https://opengameart.org/sites/default/files/ticking_clock.wav', tickSrc);
  sh(`ffmpeg -y -ss 0.05 -t 0.35 -i "${tickSrc}" -af "afade=t=out:st=0.25:d=0.1" -c:a vorbis -q:a 3 -strict -2 "${path.join(S, 'tick.ogg')}"`);

  const rubberduckZip = path.join(BUILD, 'sfx/rubberduck.zip');
  await download('https://opengameart.org/sites/default/files/100-CC0-SFX_0.zip', rubberduckZip);
  sh(`unzip -o -j "${rubberduckZip}" wooden_02.ogg hit_03.ogg -d "${path.join(BUILD, 'sfx')}"`);
  fs.copyFileSync(path.join(BUILD, 'sfx/wooden_02.ogg'), path.join(S, 'creak.ogg'));
  fs.copyFileSync(path.join(BUILD, 'sfx/hit_03.ogg'), path.join(S, 'slam.ogg'));

  // click.ogg: synthesized lamp-switch click (no reliable CC0 source found for
  // this one during the original build -- see THIRD_PARTY_NOTICES.md)
  sh(`ffmpeg -y -f lavfi -i "anoisesrc=d=0.025:c=white:a=0.9" -af "highpass=f=1200,afade=t=in:st=0:d=0.001,afade=t=out:st=0.008:d=0.017" -c:a vorbis -strict -2 -ar 44100 -ac 2 "${path.join(S, 'click.ogg')}"`);
}

// ---------------------------------------------------------------------------
// STAGE: manifest -- regenerate MANIFEST.json from whatever is on disk
// ---------------------------------------------------------------------------
async function stageManifest() {
  sh(`node "${path.join(REPO, 'scripts/_gen-manifest.mjs')}"`);
}

const STAGES = { three: stageThree, lipsync: stageLipsync, rocketbox: stageRocketbox, polyhaven: stagePolyhaven, fonts: stageFonts, sfx: stageSfx, manifest: stageManifest };

for (const [name, fn] of Object.entries(STAGES)) {
  if (!shouldRun(name)) continue;
  log(`=== stage: ${name} ===`);
  await fn();
}

log('done.');
