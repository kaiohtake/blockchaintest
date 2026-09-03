# Third-Party Notices

This project vendors and redistributes the following third-party assets and libraries.
Full file-level provenance (source URL, license, byte size, sha256) is in
`public/assets/MANIFEST.json`.

## three.js — MIT
`public/vendor/three/` (three.module.js, three.core.js, addons/loaders/GLTFLoader.js,
addons/loaders/DRACOLoader.js, addons/loaders/RGBELoader.js, addons/loaders/HDRLoader.js,
addons/capabilities/WebGL.js, addons/utils/BufferGeometryUtils.js, addons/utils/SkeletonUtils.js)

Copyright © 2010-2026 three.js authors. MIT License. Full text: `public/vendor/three/LICENSE`.
Source: https://github.com/mrdoob/three.js / https://cdn.jsdelivr.net/npm/three@0.185.1/

## Google Draco — Apache-2.0
`public/vendor/three/addons/libs/draco/gltf/` (draco_decoder.js, draco_decoder.wasm,
draco_wasm_wrapper.js), redistributed by the three.js project.

Copyright Google Inc. Apache License 2.0. Source: https://github.com/google/draco

## Microsoft Rocketbox — MIT
`public/assets/detective.glb`, `public/assets/clips/sit_idle.glb`

Copyright (c) 2020 Microsoft.

```
MIT License

Copyright (c) 2020 Microsoft

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Source: https://github.com/microsoft/Microsoft-Rocketbox
(`Assets/Avatars/Professions/Business_Male_01/Export/Business_Male_01_facial.fbx`,
`Assets/Animations/.../m_sit_table_idle_neutral_01.fbx`). Converted with FBX2glTF 0.9.7
and re-packed with @gltf-transform/cli — both build-time tools, not redistributed.
`detective.glb` additionally embeds the model's own diffuse/normal textures (converted
TGA -> JPEG/PNG), which are part of the same Rocketbox MIT-licensed asset.

## lipsync-en.mjs (TalkingHead) — MIT
`public/js/lipsync-en.mjs`

Copyright (c) 2023-2024 Mika Suominen. MIT License.
Source: https://github.com/met4citizen/TalkingHead (`modules/lipsync-en.mjs`, tag 1.7).
Patched in this repo: fixed two upstream rule typos (`[HOUR]=aa EE` -> `aa U`,
`[OUP]=U OO` -> `U`) so only the documented 15 Oculus viseme ids are ever emitted.

## Poly Haven — CC0 1.0
`public/assets/room/wooden_table_02.glb`, `public/assets/room/school_chair_01.glb`,
`public/assets/room/hanging_industrial_lamp.glb`, `public/assets/tex/concrete_wall_*.jpg`,
`public/assets/tex/concrete_floor_*.jpg`, `public/assets/hdr/warehouse_1k.hdr`

CC0 1.0 Universal (public domain dedication). No attribution required; credited here
as a courtesy. Source: https://polyhaven.com (`wooden_table_02`, `SchoolChair_01`,
`hanging_industrial_lamp`, `concrete_wall_008`, `concrete_floor_02`, `empty_warehouse_01`),
fetched via the Poly Haven public API (`api.polyhaven.com/files/<slug>`).

## Courier Prime — OFL-1.1
`public/assets/fonts/CourierPrime-Regular.ttf`, `CourierPrime-Bold.ttf`

SIL Open Font License 1.1. Full text: `public/assets/fonts/CourierPrime-OFL.txt`.
Source: https://github.com/google/fonts (`ofl/courierprime/`).

## Special Elite — Apache-2.0
`public/assets/fonts/SpecialElite-Regular.ttf`

Apache License 2.0. Full text: `public/assets/fonts/SpecialElite-LICENSE.txt`.
Source: https://github.com/google/fonts (`apache/specialelite/`).

## Sound effects — CC0
- `public/assets/sfx/tick.ogg` — "Ticking Clock" by AntumDeluge, OpenGameArt, CC0.
  https://opengameart.org/content/ticking-clock — trimmed to a single ~0.35s tick.
- `public/assets/sfx/creak.ogg` — "100 CC0 SFX" pack by rubberduck, OpenGameArt, CC0
  (`wooden_02.ogg`). https://opengameart.org/content/100-cc0-sfx
- `public/assets/sfx/slam.ogg` — "100 CC0 SFX" pack by rubberduck, OpenGameArt, CC0
  (`hit_03.ogg`). **Substituted for Kenney Impact Sounds**: kenney.nl serves that pack's
  download zip via client-side JS with no stable static URL found during the build; the
  rubberduck one-shot is an equivalent CC0 single-impact sound and was used instead.
- `public/assets/sfx/click.ogg` — **synthesized**, not sourced from a third party. A 25ms
  highpass-filtered (1200Hz) white-noise burst with a fast attack/decay, generated with
  `ffmpeg`'s `anoisesrc` (procedural, no license attribution needed).

## Build-time tools (not redistributed)
- **FBX2glTF** 0.9.7 (facebookincubator/FBX2glTF, BSD) — used to convert the Rocketbox
  FBX files to glTF during the build; the binary itself ships in neither the repo nor
  the served assets.
- **@gltf-transform/cli / core / functions** 4.5.0 (MIT, Don McCurdy) — used to inject
  morph target names, re-embed textures, and Draco-compress `detective.glb`; and to
  pack/optimize the Poly Haven props and prune/resample `sit_idle.glb`. A build-time
  dependency only.
