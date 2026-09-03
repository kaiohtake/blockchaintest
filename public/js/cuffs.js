// First-person embodiment: your hands cuffed to the bar, forearms running
// back toward you out of the bottom of the frame. Primitives only; the read
// comes from placement, not detail.
import * as THREE from "three";

export class Cuffs {
  constructor({ tableTop, barZ }) {
    this.group = new THREE.Group();
    this.tug = 0;
    const cloth = new THREE.MeshStandardMaterial({ color: 0x2b2926, roughness: 0.95 });
    const skin = new THREE.MeshStandardMaterial({ color: 0x5c4536, roughness: 0.9 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.9 });

    const y = tableTop + 0.03;
    const barY = tableTop + 0.09;
    const handZ = barZ + 0.1;
    for (const side of [-1, 1]) {
      const x = side * 0.13;
      // Hand: flattened capsule resting on the wood, fingers toward the bar.
      const hand = new THREE.Mesh(new THREE.CapsuleGeometry(0.028, 0.065, 4, 12), skin);
      hand.scale.set(1.15, 0.38, 1);
      hand.rotation.x = Math.PI / 2;
      hand.rotation.z = side * 0.15;
      hand.position.set(x, y - 0.004, handZ);
      hand.castShadow = true;
      // Fingers: three short capsules reaching toward the bar.
      for (let f = -1; f <= 1; f++) {
        const finger = new THREE.Mesh(new THREE.CapsuleGeometry(0.009, 0.05, 3, 8), skin);
        finger.rotation.x = Math.PI / 2 + 0.12;
        finger.position.set(x + f * 0.019 + side * 0.004, y - 0.006, handZ - 0.06);
        finger.castShadow = true;
        this.group.add(finger);
      }
      // Cuff around the wrist.
      const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 10, 24), steel);
      cuff.rotation.y = Math.PI / 2 + side * 0.15;
      cuff.position.set(x + side * 0.01, y + 0.012, handZ + 0.07);
      // Forearm in a dark sleeve, running toward the camera and down.
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.032, 0.3, 4, 12), cloth);
      arm.rotation.x = Math.PI / 2 - 0.35;
      arm.rotation.z = side * 0.22;
      arm.position.set(x + side * 0.06, y - 0.03, handZ + 0.25);
      arm.castShadow = true;
      // Chain: short sag from the cuff to the bar.
      const from = new THREE.Vector3(x + side * 0.01, y + 0.012, handZ + 0.04);
      const to = new THREE.Vector3(side * 0.1, barY, barZ);
      const mid = from.clone().lerp(to, 0.5); mid.y -= 0.035;
      const chain = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([from, mid, to]), 14, 0.0045, 6, false), steel);
      this.group.add(hand, cuff, arm, chain);
    }
    this.base = this.group.position.clone();
  }
  pull() { this.tug = 1; }
  update(dt) {
    if (this.tug > 0) {
      this.tug = Math.max(0, this.tug - dt * 4);
      const k = Math.sin(this.tug * Math.PI);
      this.group.position.z = this.base.z + k * 0.012;
      this.group.position.y = this.base.y + k * 0.004;
    }
  }
}
