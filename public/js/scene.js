// The room. One warm lamp, fog, a dark mirror, a cone of light. Every prop
// has a primitive fallback so the scene renders even if an asset is missing.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { HDRLoader } from "three/addons/loaders/HDRLoader.js";

export const LAYOUT = {
  tableTop: 0.76,
  tableW: 1.3,
  tableD: 0.8,
  barZ: 0.2,
  detectiveZ: -1.15,
  cameraZ: 1.1,
  cameraY: 1.04,
  lookY: 0.84,
  ceiling: 3.0,
  roomW: 4.4,
  roomD: 4.6,
};

const CONE_SHADER = {
  vertex: `varying vec2 vUv; varying vec3 vNormalV; void main(){ vUv = uv; vNormalV = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragment: `uniform float opacity; uniform vec3 color; varying vec2 vUv; varying vec3 vNormalV;
    void main(){
      float along = vUv.y;                                   // 1 at the lamp, 0 at the table
      vec3 n = vec3(vNormalV.x, vNormalV.y, abs(vNormalV.z));
      float facing = pow(max(0.0, dot(n, vec3(0.0, 0.0, 1.0))), 1.4);
      float fall = 0.15 + 0.85 * pow(along, 0.8);
      gl_FragColor = vec4(color, opacity * facing * fall);
    }`,
};

export class Scene {
  constructor({ canvas, tier, manager, reducedMotion }) {
    this.tier = tier;
    this.reducedMotion = reducedMotion;
    this.manager = manager;
    this.timer = new THREE.Timer();
    this.speaking = false;
    this.look = { x: 0, y: 0, tx: 0, ty: 0 };
    this.shakeT = 0;
    this.flickerT = 0;
    this.fovTarget = 50;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, tier === "lite" ? 1.25 : 1.5));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x030408);
    scene.fog = new THREE.FogExp2(0x070810, 0.11);
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 30);
    this.camera = camera;
    this.cameraBase = new THREE.Vector3(0, LAYOUT.cameraY, LAYOUT.cameraZ);
    this.lookTarget = new THREE.Vector3(0, LAYOUT.lookY, LAYOUT.detectiveZ);
    camera.position.copy(this.cameraBase);
    camera.lookAt(this.lookTarget);

    this.gltf = new GLTFLoader(manager);
    const draco = new DRACOLoader(manager);
    draco.setDecoderPath("/vendor/three/addons/libs/draco/gltf/");
    this.gltf.setDRACOLoader(draco);
    this.tex = new THREE.TextureLoader(manager);

    this.buildLights();
    this.buildRoom();
    this.resize();
  }

  buildLights() {
    const { scene } = this;
    scene.add(new THREE.HemisphereLight(0x3a4a68, 0x0c0c10, 2.2));
    const spot = new THREE.SpotLight(0xffcf9a, 88, 7, 0.62, 0.45, 1.6);
    spot.position.set(0, LAYOUT.ceiling - 0.62, -0.05);
    spot.target.position.set(0, LAYOUT.tableTop, -0.3);
    spot.castShadow = true;
    spot.shadow.mapSize.set(this.tier === "lite" ? 512 : 1024, this.tier === "lite" ? 512 : 1024);
    spot.shadow.bias = -0.0015;
    spot.shadow.normalBias = 0.02;
    spot.shadow.camera.near = 0.3;
    spot.shadow.camera.far = 6;
    scene.add(spot, spot.target);
    this.spot = spot;
    this.spotBase = spot.intensity;

    // Cool rim from the mirror side so the far cheek isn't lost.
    const rim = new THREE.PointLight(0x6f94d6, 5, 6, 2);
    rim.position.set(1.15, 1.9, -1.75);
    scene.add(rim);
    this.rim = rim;

    if (this.tier !== "lite" && !this.reducedMotion) {
      const geo = new THREE.ConeGeometry(0.95, LAYOUT.ceiling - 0.62 - LAYOUT.tableTop, 48, 1, true);
      const mat = new THREE.ShaderMaterial({
        uniforms: { opacity: { value: 0.22 }, color: { value: new THREE.Color(0xffd0a0) } },
        vertexShader: CONE_SHADER.vertex,
        fragmentShader: CONE_SHADER.fragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
      });
      const cone = new THREE.Mesh(geo, mat);
      cone.position.set(0, (LAYOUT.ceiling - 0.62 + LAYOUT.tableTop) / 2, -0.05);
      cone.renderOrder = 10;
      scene.add(cone);
      this.cone = cone;
    }
  }

  texture(url, repeat, srgb) {
    const t = this.tex.load(url, undefined, undefined, () => {});
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }

  buildRoom() {
    const { scene } = this;
    const W = LAYOUT.roomW, D = LAYOUT.roomD, H = LAYOUT.ceiling;
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x9aa0a8, roughness: 0.95, metalness: 0,
      map: this.texture("/assets/tex/concrete_wall_diff.jpg", 2.2, true),
      normalMap: this.texture("/assets/tex/concrete_wall_nor.jpg", 2.2, false),
      roughnessMap: this.texture("/assets/tex/concrete_wall_rough.jpg", 2.2, false),
    });
    wallMat.normalScale.set(0.6, 0.6);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x5c5f63, roughness: 0.85, metalness: 0.05,
      map: this.texture("/assets/tex/concrete_floor_diff.jpg", 3, true),
      normalMap: this.texture("/assets/tex/concrete_floor_nor.jpg", 3, false),
      roughnessMap: this.texture("/assets/tex/concrete_floor_rough.jpg", 3, false),
    });
    const ceilMat = new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 1 });

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), floorMat);
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), ceilMat);
    ceil.rotation.x = Math.PI / 2; ceil.position.y = H; scene.add(ceil);
    const walls = [
      [0, H / 2, -D / 2, 0], [0, H / 2, D / 2, Math.PI],
      [-W / 2, H / 2, 0, Math.PI / 2], [W / 2, H / 2, 0, -Math.PI / 2],
    ];
    for (const [x, y, z, ry] of walls) {
      const size = Math.abs(ry) === Math.PI / 2 ? D : W;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(size, H), wallMat);
      m.position.set(x, y, z); m.rotation.y = ry; m.receiveShadow = true; scene.add(m);
    }
    // A dark dado band and a baseboard: cheap architecture.
    const band = new THREE.Mesh(new THREE.BoxGeometry(W - 0.02, 0.06, 0.02), new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.8 }));
    band.position.set(0, 1.1, -D / 2 + 0.012); scene.add(band);

    // One-way mirror behind him: dark glass + a frame. No real reflection.
    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 0.85),
      new THREE.MeshPhysicalMaterial({ color: 0x1a2028, roughness: 0.1, metalness: 0.95, envMapIntensity: 0.9 })
    );
    glass.position.set(0.55, 1.6, -D / 2 + 0.03); scene.add(glass);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.95, 0.04), new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.7, metalness: 0.3 }));
    frame.position.set(0.55, 1.6, -D / 2 + 0.005); scene.add(frame);

    // Cuff bar on the suspect's side of the table.
    const steel = new THREE.MeshStandardMaterial({ color: 0xb4b9be, roughness: 0.3, metalness: 0.95 });
    const barY = LAYOUT.tableTop + 0.09;
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.36, 16), steel);
    bar.rotation.z = Math.PI / 2; bar.position.set(0, barY, LAYOUT.barZ); bar.castShadow = true;
    scene.add(bar);
    for (const x of [-0.15, 0.15]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.09, 12), steel);
      leg.position.set(x, LAYOUT.tableTop + 0.045, LAYOUT.barZ); leg.castShadow = true; scene.add(leg);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.006, 16), steel);
      foot.position.set(x, LAYOUT.tableTop + 0.003, LAYOUT.barZ); scene.add(foot);
    }

    // Props: real GLBs, with primitive fallbacks.
    this.prop("/assets/room/wooden_table_02.glb", { fit: [LAYOUT.tableW, LAYOUT.tableTop, LAYOUT.tableD], position: [0, 0, 0], darken: 0.5 }, () => {
      const g = new THREE.Group();
      const wood = new THREE.MeshStandardMaterial({ color: 0x6b3f28, roughness: 0.55 });
      const top = new THREE.Mesh(new THREE.BoxGeometry(LAYOUT.tableW, 0.04, LAYOUT.tableD), wood);
      top.position.y = LAYOUT.tableTop - 0.02; top.castShadow = top.receiveShadow = true; g.add(top);
      for (const [x, z] of [[-0.6, -0.35], [0.6, -0.35], [-0.6, 0.35], [0.6, 0.35]]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, LAYOUT.tableTop - 0.04, 0.06), wood);
        leg.position.set(x, (LAYOUT.tableTop - 0.04) / 2, z); leg.castShadow = true; g.add(leg);
      }
      return g;
    });
    this.prop("/assets/room/school_chair_01.glb", { height: 0.82, position: [0, 0, LAYOUT.detectiveZ - 0.08], rotationY: 0 }, () => {
      const g = new THREE.Group();
      const m = new THREE.MeshStandardMaterial({ color: 0x7c8187, roughness: 0.4, metalness: 0.8 });
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.03, 0.42), m); seat.position.y = 0.45; g.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.4, 0.03), m); back.position.set(0, 0.68, -0.2); g.add(back);
      return g;
    });
    this.prop("/assets/room/hanging_industrial_lamp.glb", { height: 0.62, position: [0, LAYOUT.ceiling, -0.05], hangFromTop: true }, () => {
      const g = new THREE.Group();
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.2, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0x3f4a3a, roughness: 0.6, metalness: 0.5, side: THREE.DoubleSide }));
      shade.position.y = 0.12; g.add(shade);
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.42, 8), new THREE.MeshStandardMaterial({ color: 0x111111 }));
      cord.position.y = 0.42; g.add(cord);
      return g;
    });
    // The bulb itself: a small emissive sphere in the shade.
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.03, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff1d6 }));
    bulb.position.set(0, LAYOUT.ceiling - 0.62 - 0.05, -0.05);
    scene.add(bulb);
    this.bulb = bulb;

    if (this.tier !== "lite") {
      new HDRLoader(this.manager).load("/assets/hdr/warehouse_1k.hdr", (hdr) => {
        hdr.mapping = THREE.EquirectangularReflectionMapping;
        scene.environment = hdr;
        scene.environmentIntensity = 0.28;
      }, undefined, () => {});
    }
  }

  // Load a GLB, normalize its size, rest it on the floor (or hang it).
  prop(url, opts, fallback) {
    const place = (obj) => {
      const box = new THREE.Box3().setFromObject(obj);
      const size = box.getSize(new THREE.Vector3());
      if (opts.fit) obj.scale.set(opts.fit[0] / size.x, opts.fit[1] / size.y, opts.fit[2] / size.z);
      else if (opts.width) obj.scale.setScalar(opts.width / size.x);
      else if (opts.height) obj.scale.setScalar(opts.height / size.y);
      obj.rotation.y = opts.rotationY || 0;
      const box2 = new THREE.Box3().setFromObject(obj);
      const [x, y, z] = opts.position;
      // hangFromTop: y is where the top of the object (the ceiling hook) goes.
      const dy = opts.hangFromTop ? y - box2.max.y : y - box2.min.y;
      obj.position.set(x - (box2.min.x + box2.max.x) / 2, dy, z - (box2.min.z + box2.max.z) / 2);
      obj.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true; o.receiveShadow = true;
        if (opts.darken && o.material && o.material.color) { o.material.color.multiplyScalar(opts.darken); o.material.roughness = Math.max(o.material.roughness ?? 0.5, 0.85); }
      });
      this.scene.add(obj);
      return obj;
    };
    this.gltf.load(url, (g) => {
      const obj = place(g.scene);
      if (url.includes("table")) this.tableMesh = obj;
    }, undefined, () => { place(fallback()); });
  }

  setSpeaking(on) {
    this.speaking = on;
    this.fovTarget = on ? 46 : 50;
  }
  setFovOffset(delta) { this.fovTarget = (this.speaking ? 46 : 50) + delta; }
  shake(ms) { if (!this.reducedMotion) this.shakeT = ms / 1000; }
  flicker(ms = 700) { if (!this.reducedMotion) this.flickerT = ms / 1000; }
  setLook(nx, ny) { this.look.tx = nx; this.look.ty = ny; }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.portrait = w / h < 1;
    this.camera.updateProjectionMatrix();
  }

  update() {
    this.timer.update();
    const dt = Math.min(0.05, this.timer.getDelta());
    const t = this.timer.getElapsed();
    const cam = this.camera;
    const rm = this.reducedMotion;

    // Camera: base + breathing + mouse look + shake, portrait dolly.
    const baseZ = this.portrait ? LAYOUT.cameraZ + 0.45 : LAYOUT.cameraZ;
    const fovBase = this.portrait ? this.fovTarget + 18 : this.fovTarget;
    cam.fov += (fovBase - cam.fov) * (1 - Math.exp(-dt * 3));
    cam.updateProjectionMatrix();
    this.look.x += (this.look.tx - this.look.x) * (1 - Math.exp(-dt * 4));
    this.look.y += (this.look.ty - this.look.y) * (1 - Math.exp(-dt * 4));
    const sway = rm ? 0 : Math.sin(t * Math.PI * 2 * 0.22) * 0.004;
    let sx = 0, sy = 0;
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const k = this.shakeT * 8;
      sx = (Math.random() - 0.5) * 0.02 * k; sy = (Math.random() - 0.5) * 0.015 * k;
    }
    cam.position.set(this.cameraBase.x + this.look.x * 0.06 + sx, this.cameraBase.y + sway + sy, baseZ);
    const target = this.lookTarget.clone();
    target.x += this.look.x * 0.35; target.y += this.look.y * 0.25 + sway * 0.5;
    cam.lookAt(target);

    // Lamp: slow breathing plus flicker bursts.
    let k = 1;
    if (!rm) {
      k = 0.97 + Math.sin(t * 7.3) * 0.012 + Math.sin(t * 13.1) * 0.008;
      if (this.flickerT > 0) {
        this.flickerT -= dt;
        k *= Math.random() < 0.35 ? 0.55 + Math.random() * 0.3 : 1;
      }
    }
    this.spot.intensity = this.spotBase * k;
    if (this.cone) this.cone.material.uniforms.opacity.value = 0.22 * k;
    if (this.bulb) this.bulb.material.color.setScalar(0.85 + 0.15 * k);
    return { dt, t };
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
