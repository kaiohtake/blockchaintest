#!/usr/bin/env node
// Regenerates public/assets/MANIFEST.json from the files actually on disk
// (bytes + sha256 always reflect reality) plus a static source/license/notes
// table below. Run directly, or via `node scripts/fetch-assets.mjs --only=manifest`.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));

// file (relative to repo root) -> { source_url, license, notes }
const META = {
  'public/vendor/three/three.module.js': { source_url: 'https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js', license: 'MIT', notes: 'three.js core (public API surface)' },
  'public/vendor/three/three.core.js': { source_url: 'https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.core.js', license: 'MIT', notes: 'three.js core internals; three.module.js imports this' },
  'public/vendor/three/LICENSE': { source_url: 'https://cdn.jsdelivr.net/npm/three@0.185.1/LICENSE', license: 'MIT', notes: 'three.js license text' },
  'public/vendor/three/addons/loaders/GLTFLoader.js': { source_url: 'https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/loaders/GLTFLoader.js', license: 'MIT', notes: 'imports ../utils/BufferGeometryUtils.js, ../utils/SkeletonUtils.js' },
  'public/vendor/three/addons/loaders/DRACOLoader.js': { source_url: 'https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/loaders/DRACOLoader.js', license: 'MIT', notes: 'decoder assets at addons/libs/draco/gltf/' },
  'public/vendor/three/addons/loaders/RGBELoader.js': { source_url: 'https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/loaders/RGBELoader.js', license: 'MIT', notes: 'deprecated shim, re-exports HDRLoader' },
  'public/vendor/three/addons/loaders/HDRLoader.js': { source_url: 'https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/loaders/HDRLoader.js', license: 'MIT', notes: 'Radiance .hdr loader' },
  'public/vendor/three/addons/capabilities/WebGL.js': { source_url: 'https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/capabilities/WebGL.js', license: 'MIT', notes: 'WebGL2 support check, used for the /plain.html fallback redirect' },
  'public/vendor/three/addons/utils/BufferGeometryUtils.js': { source_url: 'https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/utils/BufferGeometryUtils.js', license: 'MIT', notes: 'GLTFLoader dependency' },
  'public/vendor/three/addons/utils/SkeletonUtils.js': { source_url: 'https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/utils/SkeletonUtils.js', license: 'MIT', notes: 'GLTFLoader dependency (clone helper for skinned meshes)' },
  'public/vendor/three/addons/libs/draco/gltf/draco_decoder.js': { source_url: 'https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/libs/draco/gltf/draco_decoder.js', license: 'Apache-2.0 (Google Draco)', notes: 'draco JS decoder' },
  'public/vendor/three/addons/libs/draco/gltf/draco_decoder.wasm': { source_url: 'https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/libs/draco/gltf/draco_decoder.wasm', license: 'Apache-2.0 (Google Draco)', notes: 'draco wasm decoder binary' },
  'public/vendor/three/addons/libs/draco/gltf/draco_wasm_wrapper.js': { source_url: 'https://cdn.jsdelivr.net/npm/three@0.185.1/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js', license: 'Apache-2.0 (Google Draco)', notes: 'draco wasm wrapper' },

  'public/js/lipsync-en.mjs': { source_url: 'https://cdn.jsdelivr.net/gh/met4citizen/TalkingHead@1.7/modules/lipsync-en.mjs', license: 'MIT', notes: 'Copyright (c) 2023-2024 Mika Suominen; patched [HOUR]=aa EE -> aa U and [OUP]=U OO -> U' },

  'public/assets/detective.glb': { source_url: 'https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master/Assets/Avatars/Professions/Business_Male_01/Export/Business_Male_01_facial.fbx', license: 'MIT (Microsoft Rocketbox)', notes: 'FBX2glTF 0.9.7 conversion; 175 morph targets x 3 primitives, targetNames injected via gltf-transform (Oculus visemes idx 0-14, ARKit AK_* idx 15-66); textures re-embedded at 1024px (body/head diffuse+normal JPEG q85, hair/opacity PNG w/ alpha, MASK 0.5); draco-compressed geometry via gltf-transform optimize' },
  'public/assets/clips/sit_idle.glb': { source_url: 'https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master/Assets/Animations/Interaction%20Poses/Sitting/m_sit_table_idle_neutral_01.fbx', license: 'MIT (Microsoft Rocketbox)', notes: 'FBX2glTF conversion; meshes/skins already absent from source export; gltf-transform prune+resample; animation-only GLB, 1 clip "Take 001", 45.67s, 141 tracks' },

  'public/assets/room/wooden_table_02.glb': { source_url: 'https://api.polyhaven.com/files/wooden_table_02 (gltf.1k)', license: 'CC0 (Poly Haven)', notes: 'packed to self-contained GLB, textures embedded <=1024px JPEG via gltf-transform' },
  'public/assets/room/school_chair_01.glb': { source_url: 'https://api.polyhaven.com/files/SchoolChair_01 (gltf.1k)', license: 'CC0 (Poly Haven)', notes: 'packed to self-contained GLB, textures embedded <=1024px JPEG via gltf-transform' },
  'public/assets/room/hanging_industrial_lamp.glb': { source_url: 'https://api.polyhaven.com/files/hanging_industrial_lamp (gltf.1k)', license: 'CC0 (Poly Haven)', notes: 'packed to self-contained GLB, textures embedded <=1024px JPEG via gltf-transform (incl. emissive + glass layers)' },

  'public/assets/tex/concrete_wall_diff.jpg': { source_url: 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/concrete_wall_008/concrete_wall_008_diff_1k.jpg', license: 'CC0 (Poly Haven)', notes: 'concrete_wall_008 diffuse, 1k' },
  'public/assets/tex/concrete_wall_nor.jpg': { source_url: 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/concrete_wall_008/concrete_wall_008_nor_gl_1k.jpg', license: 'CC0 (Poly Haven)', notes: 'concrete_wall_008 normal (GL/+Y), 1k' },
  'public/assets/tex/concrete_wall_rough.jpg': { source_url: 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/concrete_wall_008/concrete_wall_008_rough_1k.jpg', license: 'CC0 (Poly Haven)', notes: 'concrete_wall_008 roughness, 1k' },
  'public/assets/tex/concrete_floor_diff.jpg': { source_url: 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/concrete_floor_02/concrete_floor_02_diff_1k.jpg', license: 'CC0 (Poly Haven)', notes: 'concrete_floor_02 diffuse, 1k' },
  'public/assets/tex/concrete_floor_nor.jpg': { source_url: 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/concrete_floor_02/concrete_floor_02_nor_gl_1k.jpg', license: 'CC0 (Poly Haven)', notes: 'concrete_floor_02 normal (GL/+Y), 1k' },
  'public/assets/tex/concrete_floor_rough.jpg': { source_url: 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/concrete_floor_02/concrete_floor_02_rough_1k.jpg', license: 'CC0 (Poly Haven)', notes: 'concrete_floor_02 roughness, 1k' },

  'public/assets/hdr/warehouse_1k.hdr': { source_url: 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/empty_warehouse_01_1k.hdr', license: 'CC0 (Poly Haven)', notes: 'empty_warehouse_01, 1k, Radiance HDR' },

  'public/assets/fonts/CourierPrime-Regular.ttf': { source_url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/courierprime/CourierPrime-Regular.ttf', license: 'OFL-1.1', notes: '' },
  'public/assets/fonts/CourierPrime-Bold.ttf': { source_url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/courierprime/CourierPrime-Bold.ttf', license: 'OFL-1.1', notes: '' },
  'public/assets/fonts/CourierPrime-OFL.txt': { source_url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/courierprime/OFL.txt', license: 'OFL-1.1', notes: 'license text' },
  'public/assets/fonts/SpecialElite-Regular.ttf': { source_url: 'https://raw.githubusercontent.com/google/fonts/main/apache/specialelite/SpecialElite-Regular.ttf', license: 'Apache-2.0', notes: '' },
  'public/assets/fonts/SpecialElite-LICENSE.txt': { source_url: 'https://raw.githubusercontent.com/google/fonts/main/apache/specialelite/LICENSE.txt', license: 'Apache-2.0', notes: 'license text' },

  'public/assets/sfx/tick.ogg': { source_url: 'https://opengameart.org/sites/default/files/ticking_clock.wav', license: 'CC0 ("Ticking Clock" by AntumDeluge, OpenGameArt)', notes: 'trimmed to a single 0.35s tick with a 100ms fade-out, transcoded WAV->OGG Vorbis' },
  'public/assets/sfx/creak.ogg': { source_url: 'https://opengameart.org/sites/default/files/100-CC0-SFX_0.zip (wooden_02.ogg)', license: 'CC0 ("100 CC0 SFX" by rubberduck, OpenGameArt)', notes: 'wood creak/movement one-shot, 0.40s, used as-is' },
  'public/assets/sfx/slam.ogg': { source_url: 'https://opengameart.org/sites/default/files/100-CC0-SFX_0.zip (hit_03.ogg)', license: 'CC0 ("100 CC0 SFX" by rubberduck, OpenGameArt)', notes: 'SUBSTITUTED for Kenney Impact Sounds: kenney.nl/assets/impact-sounds serves its download zip via client-side JS with no static URL found; rubberduck hit_03.ogg is an equivalent CC0 single-impact one-shot, 0.43s, used as-is' },
  'public/assets/sfx/click.ogg': { source_url: 'synthesized', license: 'N/A (procedurally generated, no third-party source)', notes: 'SYNTHESIZED lamp-switch click: 25ms highpass-filtered (1200Hz) white noise burst with a 1ms attack / 17ms exponential-ish fade, via ffmpeg anoisesrc — no suitable CC0 source found quickly, task explicitly allows synthesis as a non-blocking fallback' },
};

function entry(file) {
  const meta = META[file];
  if (!meta) throw new Error(`no MANIFEST metadata for ${file} -- add it to META in scripts/_gen-manifest.mjs`);
  const buf = fs.readFileSync(path.join(REPO, file));
  return { file, source_url: meta.source_url, license: meta.license, bytes: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'), notes: meta.notes };
}

const manifest = Object.keys(META).map(entry);
fs.writeFileSync(path.join(REPO, 'public/assets/MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');
const totalBytes = manifest.reduce((s, e) => s + e.bytes, 0);
console.log(`wrote MANIFEST.json with ${manifest.length} entries, ${(totalBytes / 1024 / 1024).toFixed(2)} MB total`);
