# THE INTERROGATION — design brief v1 (2026-09-02)

## 0. Ground truth (verified today, not remembered)
- Repo: ~/Desktop/blockchaintest, public GitHub. Zero-dep Node `http` server + vanilla JS. Another terminal already swapped the LLM backend to **OpenAI** (`openai` SDK ^7.9, `chat.completions.create({stream:true})`, model default `gpt-5.6-sol`) and the owner has ALREADY pasted an `OPENAI_API_KEY` into `.env`. Live `GET /v1/models` with that key returns 126 models incl. `gpt-5.6-sol`, `gpt-4o-mini-tts`, `tts-1`, `gpt-audio`, `gpt-realtime-2.1`. So the ONE key the owner has is OpenAI, and the "only thing left is my key" constraint is already satisfied; the design must not introduce any other key or account.
- Server streams SSE frames `event: delta|done|error`. Client `public/app.js` consumes them. Local echo fallback when no key.
- three 0.185.1 (MIT) loads bundler-free from jsdelivr via import map; every addon shares the bare `three` specifier (verified by fetching each file). DRACO decoder wasm served with CORS.
- Character: **Microsoft Rocketbox** (MIT, repo not archived) `Assets/Avatars/Professions/Business_Male_01/Export/Business_Male_01_facial.fbx` (1.94 MB, FBX 7.7) downloads with no account. FBX2glTF 0.9.7 converted it in-session: 175 morph targets on 3 skinned meshes (body/head/opacity=hair); indices 0-14 = Oculus visemes `AA_VI_00_Sil..AA_VI_14_U`; 52 ARKit `AK_*` follow (blink = AK_09/AK_10). Facial bone `Bip01 MJaw` exists; GLTFLoader sanitizes names to `Bip01_MJaw`, `Bip01_Head`, `Bip01_LEye`, `Bip01_REye`. `morphTargetDictionary` has only index keys because FBX2glTF writes no `extras.targetNames` (inject them post-conversion). Textures: 7 TGA (~90 MB) → convert to 1024px JPEG (~300 KB each). Hair material must be `transparent + alphaTest 0.5` or it renders as a black cap.
- Animation: Rocketbox `m_sit_table_idle_neutral_01` (45.7 s loop) converts to GLB and applies by bone name. It DOES animate facial bones (MJaw, lips, eyes, brows) → strip tracks matching `/(MJaw|Lip|Mouth|Eye|Brow|Cheek|Nose|Tongue|Masseter|Caninus)/` before playing. Gesture clips `m_sit_table_gestic_thoughtful`, `m_sit_table_gestic_shrug_01` exist.
- Text→viseme: TalkingHead's `modules/lipsync-en.mjs` (MIT, 533 lines, zero imports, no dictionary) exports `LipsyncEn.wordsToVisemes(word)` → `{visemes, times, durations}` in the same 15 Oculus ids. Two upstream typos emit `EE`/`OO` → patch in the vendored copy (`[HOUR]=aa EE` → `aa U`; `[OUP]=U OO` → `U`).
- Ready Player Me is DEAD (Netflix, offline 2026-01-31). Mixamo needs Adobe login and forbids redistribution. TalkingHead runtime is ruled out (hard-codes `Armature` root + Mixamo bone names, owns its own renderer, pins three 0.180). three-good-godrays peer-range excludes three 0.185 → no godrays.
- Room props (CC0, Poly Haven, CORS): `wooden_table_02`, `SchoolChair_01`, `hanging_industrial_lamp`, textures `concrete_wall_008`, `concrete_floor_02`, HDRI `empty_warehouse_01_1k.hdr`. Fetched via `https://api.polyhaven.com/files/<slug>` file groups.
- Fonts (Google Fonts repo): Courier Prime (OFL), Special Elite (Apache-2.0).
- Audio one-shots (CC0, no login): OpenGameArt "Ticking Clock" (AntumDeluge), rubberduck "100 CC0 metal and wood SFX" (chair creak), Kenney "Impact Sounds" (table slam). Continuous layers synthesized in WebAudio (room-tone noise, 60 Hz hum stack, lamp buzz), one shared LFO also drives lamp flicker.

## 1. The fiction (what the software IS)
You are the suspect. You have been sitting in Interrogation Room 2 for a while. The only thing in the world is the table, the cuff bar, the light, the mirror, and Detective Ray Kowalski across from you. There is no chat UI. When you type, you are *answering* him; when he replies, he speaks and it appears as a paper speech card next to his head. Everything he says is genuinely useful (he answers any question fully, "for the record") — the interrogation is the frame, not a gimmick that blocks the assistant.

## 2. Architecture (one scene, one page, one server)
```
public/index.html         gate screen + <canvas> + overlay DOM (bubble, YOU box, letterbox, cards)
public/js/main.js         boot: WebGL2 check → loader → scene → loop
public/js/scene.js        room, lights, camera, mirror, cone, props
public/js/detective.js    GLB load, clip strip, mixer, viseme/blink/saccade/head-look driver
public/js/lipsync-en.mjs  vendored MIT (patched EE/OO)
public/js/reveal.js       typewriter reveal loop = MASTER CLOCK (onChar, onWord, speaking)
public/js/bubble.js       HTML bubble projected from Bip01_Head each frame (Math.round px)
public/js/voice.js        optional: OpenAI TTS via /api/tts, WebAudio Analyser → mouth amplitude
public/js/audio.js        synthesized ambience + CC0 one-shots + per-letter blip
public/js/chat.js         SSE client, tag stripper, seed turn, error → diegetic card
public/js/tags.js         7-tag grammar → {clip, crossfadeMs, sfx, cameraShake, pressureDelta}
public/vendor/            three.module.js, addons used, (postprocessing optional)
public/assets/            detective.glb (draco), clips/*.glb, room/*.glb, tex/*.jpg, hdr, fonts, sfx
server.js                 static + /api/chat (SSE, existing) + /api/tts (proxy, optional) + MIME map
scripts/fetch-assets.mjs  one-time: download Rocketbox/PolyHaven/fonts/sfx, FBX2glTF, TGA→JPG, inject targetNames, gltf-transform draco
scripts/verify.mjs        HEAD every pinned URL, parse GLBs (175 morphs, targetNames, Bip01_MJaw), curl /api/status
THIRD_PARTY_NOTICES.md
```
Deployment: `node --env-file=.env server.js`, Node ≥ 20.6. Not static hosting (key is server-side).

## 3. Rendering
- three 0.185.1, `WebGLRenderer({antialias:true})` (no composer by default), `ACESFilmicToneMapping`, exposure 0.9, `setPixelRatio(min(dpr,1.5))`, shadows PCF 1024.
- Camera: PerspectiveCamera fov 42 at (0, 1.15, 0.85 m from table edge), looking at his sternum; fov tweens to 36 while he speaks; mouse/touch look ±6°; breathing sway 0.4 Hz × 4 mm. Portrait (aspect<1): fov 62, dolly back 0.5 m.
- Light: one SpotLight 4200K (0xffd9b0 tinted), intensity ~90, angle π/5, penumbra 0.4, from the lamp above the table; cool rim 0.3 from the mirror side; `FogExp2(0x05060a, 0.12)`; HDRI env at `envMapIntensity 0.25`. Light shaft = additive `ConeGeometry` with a radial-falloff ShaderMaterial (~40 lines, threex technique, MIT).
- Mirror: dark `MeshPhysicalMaterial` (color 0x1a1d20, roughness 0.05, metalness 0.9) + env map. No Reflector (would show an empty suspect chair, doubles render).
- Grade: CSS radial vignette + tiled noise overlay at 4% opacity. Optional `?fx=1` → pmndrs postprocessing 6.39.4 EffectPass(bloom 0.3, vignette, noise). No scanlines, no CA, no godrays. Grain ≤ 0.08.
- Face at 1.6 m: head roughness 0.6, metalness 0, normalScale 0.6, envMapIntensity 0.25; blink every 2-6 s (150 ms close / 250 ms open) via AK_09/AK_10; saccades ±3° on eye bones every 0.5-2 s; head-look at camera via slerp after `mixer.update`; viseme amplitude cap 0.7, 60 ms attack / 90 ms release; jaw bone follows open visemes ×0.3.
- Quality tiers: `lite` auto on touch / aspect<1 / hardwareConcurrency≤4: no shadows > 512, no cone, no fx.
- WebGL2 missing or context lost → redirect to `/plain.html` (today's chat UI, kept as fallback).
- `prefers-reduced-motion`: static camera, no flicker, no jitter, no grain, no shake.

## 4. The mouth — ONE master clock
- Default (no voice): the reveal loop (30 cps, 70 cps catch-up when buffer > 150 chars, instant on Enter, punctuation pauses 180/350 ms) is the master clock. On each revealed WORD, `LipsyncEn.wordsToVisemes` schedules visemes across that word's reveal duration; per revealed LETTER a WebAudio square blip (118 Hz ±8%, 45 ms, every 2nd letter). Mouth is guaranteed to move even with no audio anywhere.
- Voice ON (owner's existing OpenAI key; toggle in a small settings row, default ON if `/api/status` reports `tts:true`): chat.js chunks stripped text by sentence → `POST /api/tts` (server proxies `audio.speech.create({model:'gpt-4o-mini-tts', voice:'onyx', instructions:'tired, gravelly homicide detective, low, unhurried', response_format:'pcm'})`, streamed) → decode → play through an `AnalyserNode`; RMS drives jaw + `aa` viseme (amplitude lipsync), and the reveal loop is re-paced to the audio (reveal the sentence over the audio's duration). Blip is muted when voice is on. Audio is the master clock only for the sentence currently playing; if TTS errors, fall back to the text clock silently.
- Browser `speechSynthesis` is ruled out as the default (Chrome fires no boundary events on Google voices, no audio node, voice quality random per OS); it is not shipped.

## 5. Speech bubble + input
- Bubble: one `<div>` in a `pointer-events:none` overlay, positioned each frame from `Bip01_Head` world position + offset (+0.14, +0.10, +0.05 m) projected with `Vector3.project` and `Math.round`. Paper card: `#f1ead8` bg, square corners, 1 px ink border, CSS triangle tail, `Courier Prime` 17 px, max 520 px / 5 lines, blinking caret; long replies page at ~220 chars (input during reveal = skip; input after = advance; auto-advance after 1.8 s + 40 ms/char). Three-dot "…" card before the first token. `aria-live=polite`.
- Letterbox 2.39:1 bars slide in while he speaks (300 ms), out when done.
- Input: bottom dialogue box, `YOU` name tag in `Special Elite`, textarea styled as the same paper; Enter sends, Shift+Enter newline; the box shows what you said until his reply starts. No self-bubble, no HUD, no meters, no notepad.
- Pressure (hidden 0-100, client-derived from tags): drives bubble tremor amplitude and his brow (AK brow-down) only.

## 6. Persona + tag grammar
System prompt (Detective Ray Kowalski, ~215 words): Homicide, 26 years, night shift, Room 2; tired, dry, patient; calls the suspect "friend", refers to "the file", notices the time. **Answers every question fully and accurately "for the record"** (bug fixes, recipes, math — real answers), never withholds help, never claims to be human when sincerely asked. Plain text only, no markdown/lists/emoji. ≤ 80 words unless asked for detail. Ends every reply with one pressing question. May use ≤ 2 stage directions per reply from the closed set:
`[leans in] [leans back] [slams table] [taps pen] [checks file] [sighs] [stares]`.
Client table: tag → clip crossfade (thoughtful/shrug/idle variants), SFX (impact for slam), camera shake 120 ms, pressure delta. Unknown brackets render as text (fail-open). Raw tags stay in `messages[]` history; stripped only for display/TTS.
Opening: the gate click sends a hidden seed user turn `[The suspect sits down across the table.]` (not shown) so the server's "first message must be user" rule holds and he speaks first. Request params: `max_tokens 400`, `temperature 0.8`.

## 7. Server changes
- MIME map: add .mjs, .glb, .gltf, .bin, .hdr, .png, .jpg, .ogg, .wav, .json, .ttf, .woff2, .wasm (strict module MIME or `<script type=module>`/AudioWorklet fail).
- `/api/tts` POST {text} → OpenAI speech stream (pcm 24 kHz) → `audio/pcm` chunked. Rate-limit per IP, 400-char cap.
- `/api/status` adds `tts: boolean`, `theme:'interrogation'`.
- Error path: `event: error` → client shows a diegetic card "LINE DEAD — press Enter to retry", pops the failed user turn, lamp flickers, REC light off. Client AbortController 90 s; abort on Clear. `content_filter` → canned in-character line (no markdown underscores).
- `.env.example` = `OPENAI_API_KEY=`; `engines.node >= 20.6`; README states run command.
- Missing key → title card "NO KEY — add OPENAI_API_KEY to .env" instead of speaking the echo.

## 8. Asset budget (target ≤ 12 MB cold)
detective.glb draco ~3 MB + 7 JPG @1024 ~2 MB + 3 clips ~1.5 MB + props @1k ~3 MB + hdr 1k 1.7 MB + fonts 0.24 MB + three 1.2 MB. Gate screen shows % from `LoadingManager`, button enabled at 100%, click = audio unlock + seed turn.

## 9. Build order (vertical slices; each runnable)
1. Gate → canvas → static room + camera + light + fallback redirect (renders).
2. Detective GLB in the chair with stripped idle clip, blink, saccades, head-look (alive).
3. SSE → reveal loop → projected bubble + YOU box + letterbox (talks in text).
4. Text-clock visemes + blip (mouth moves).
5. Tags → gestures/SFX/shake; seed turn; error cards; ambience.
6. Voice via /api/tts + analyser; re-paced reveal (optional layer).
7. Mobile/lite tier, reduced-motion, verify.mjs, notices, README.

## 10. Open questions for the owner
1. Voice: OpenAI TTS on by default (real gravelly voice, per-reply API cost on his key, pricing to be read from the meter/pricing page before enabling) vs text-only mouth (free)?
2. Character: suit + red tie (Business_Male_01) or uniformed cop (Police_Male_01)? Suit reads "detective"; uniform reads "beat cop".
3. Confirm: scrap the current chat UI (kept only as /plain.html fallback).

---
# v2 DELTAS (after 2 codex rounds, both BUILD-WITH-FIXES; cruxes converged)

## Mouth (supersedes §4)
- Text-derived visemes (vendored, patched lipsync-en.mjs) are the mouth clock in BOTH modes. Audio RMS only multiplies jaw openness when voice is on.
- Text reveals from the SSE stream immediately; voice trails per sentence; the near-head SUBTITLE follows `playingSentence` (voice on) or `revealingSentence` (voice off), never the raw stream.
- TTS: per-sentence WAV via `/api/tts` (`audio.speech.create({model:'gpt-4o-mini-tts', voice:'onyx', input, instructions, response_format:'wav'})`), `decodeAudioData` per sentence, strict sequential queue `{queued, fetching, decoded, playing, cancelled}` with seq numbers; any new user input cancels all. Segmenter skips code/lists/>300-char segments; tags stripped before subtitle, transcript, and TTS.
- Default OFF: `OPENAI_TTS_ENABLED=false`. `/api/status` → `{chatEnabled, ttsEnabled}`; UI shows the voice toggle only when `ttsEnabled`. Voice is the LAST slice.

## Text surfaces (supersedes §5)
- Near-head card = 2-line subtitle of the current sentence (Courier Prime 17 px, paper, square corners, tail). No paging.
- Full reply accumulates on a typed-transcript sheet (case-file drawer, bottom-LEFT, narrow, dim paper, monospace, auto-scroll, pauses when user scrolls). Code/lists render there. Kept clear of the hands/cuffs sightline (bottom-centre).
- Letterbox only on the opening beat and on `[leans in]` / `[slams table]`.

## Embodiment (NEW)
- First-person cuffs: fixed world-space foreground = table edge, two dark forearm/hand silhouettes (low-poly primitives or the Rocketbox hand mesh isolated), metal cuffs, taut short chains (TubeGeometry) to the bolted bar. Tiny procedural tug + chain clink on send. NO second avatar, NO head-parented camera.

## Opening beat (NEW)
Black → (gate click) lamp click SFX (silent-safe if audio blocked) + spot snaps on → detective raises head (head-look tween 600 ms) → first line via hidden seed user turn `[The suspect sits down across the table.]` (sent once per session, never shown, never spoken) → YOU box fades in.

## Lighting (amends §3)
- HDRI (empty_warehouse_01_1k) + PMREM and the additive light cone stay, but behind a capability gate: `lite` tier (touch / aspect<1 / cores≤4 / RGBELoader error) → HemisphereLight fill + tuned roughness, no cone. Cone: depthWrite off, additive, renderOrder last, clamped so it never covers the face/subtitle.
- Cut for v1: pmndrs postprocessing, pressure meter, gesture clips, camera shake, saccades. `[leans in]` = 8 cm spine/head translate over 400 ms; `[slams table]` = impact SFX + flicker.

## Streaming (NEW)
- Stateful SSE control-tag parser (buffers `[`…`]` across chunk boundaries; closed 7-tag set → cue events; unknown brackets → text). Emits `text` and `cue` events; raw tags stay in history.

## Asset pipeline (amends §8/§10)
- `scripts/check-tools.mjs` preflight (arch, Rosetta, FBX2glTF, gltf-transform, python3+Pillow). If FBX2glTF unavailable → use the committed pre-converted GLB (the conversion is done once by the build agent on this Mac, where `npm fbx2gltf` Darwin binary already ran).
- Measured today: `Business_Male_01_facial.glb` 10.65 MB → 5.73 MB after `gltf-transform optimize --compress draco` (textures were 1×1 placeholders; real 1024 JPEGs add ~1.5–2 MB). Idle clip 2.19 MB raw. Realistic cold budget ≈ 15 MB; loading screen mandatory.
- verify.mjs runs post-compression through real GLTFLoader: primitives=3, 175 targets each, `morphTargetDictionary.AA_VI_00_Sil===0`, `Bip01_MJaw` present, hair MASK/0.5, texture dims, byte sizes; plus `git ls-files .env` empty.
- Manifest `THIRD_PARTY_NOTICES.md` covers Rocketbox (MIT), three (MIT), lipsync-en (MIT), fonts (OFL/Apache), Poly Haven (CC0 incl. HDRI), Kenney/OGA/rubberduck (CC0).

## Mobile / iOS (NEW)
Audio unlock on the gate tap (touchend), `100dvh` + `visualViewport`, safe-area insets, DPR cap 1.5, `webglcontextlost/restored`, Draco wasm path check, low-power tier. Acceptance tests listed in verify checklist.

## Persona (amends §6)
Default ≤ 80 words, plain text. If the suspect asks for code/steps/math/detail: lists and code allowed (rendered on the transcript sheet), closing question dropped.

---
# APPROVED 2026-09-02 (Kai: "approved, suit, voice off")
Decisions locked: character = Rocketbox Business_Male_01 (suit, red tie); OpenAI TTS default OFF (`OPENAI_TTS_ENABLED=false`); LLM = OpenAI `gpt-5.6-sol` via existing key.

## Canonical asset paths (front end and asset script agree on these)
```
public/vendor/three/three.module.js                  three 0.185.1 build
public/vendor/three/addons/...                       only the addons imported (GLTFLoader, DRACOLoader, RGBELoader, HDRLoader, capabilities/WebGL.js, utils/BufferGeometryUtils.js, libs/draco/*)
public/js/lipsync-en.mjs                             vendored MIT, patched (EE/OO)
public/assets/detective.glb                          Rocketbox Business_Male_01 facial, textures embedded (1024 JPEG), targetNames injected, hair MASK 0.5, Draco
public/assets/clips/sit_idle.glb                     m_sit_table_idle_neutral_01 (animation only, no meshes)
public/assets/room/wooden_table_02.glb               Poly Haven, 1k textures embedded
public/assets/room/school_chair_01.glb               Poly Haven
public/assets/room/hanging_industrial_lamp.glb       Poly Haven
public/assets/tex/concrete_wall_diff.jpg / _nor.jpg / _rough.jpg      Poly Haven concrete_wall_008 1k
public/assets/tex/concrete_floor_diff.jpg / _nor.jpg / _rough.jpg     Poly Haven concrete_floor_02 1k
public/assets/hdr/warehouse_1k.hdr                   Poly Haven empty_warehouse_01 1k
public/assets/fonts/CourierPrime-Regular.ttf, CourierPrime-Bold.ttf, SpecialElite-Regular.ttf
public/assets/sfx/tick.ogg, creak.ogg, slam.ogg      CC0 one-shots (converted to ogg or wav, < 200 KB each)
public/assets/MANIFEST.json                          {file, source_url, license, bytes, sha256}
THIRD_PARTY_NOTICES.md
scripts/check-tools.mjs, scripts/fetch-assets.mjs, scripts/verify.mjs
```
