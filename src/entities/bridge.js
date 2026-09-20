import * as THREE from 'three';
import { BRIDGE } from '../config.js';
import { dirFromYaw } from '../sim/math.js';

const glassMat = () => new THREE.MeshStandardMaterial({ color: 0x9fc7dd, roughness: 0.25, metalness: 0.4 });
const shellMat = (c = 0xdfe5ea) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.15 });
const darkMat = () => new THREE.MeshStandardMaterial({ color: 0x2b313a, roughness: 0.6, metalness: 0.3 });

const UP = new THREE.Vector3(0, 1, 0);

export class JetBridge {
  constructor() {
    this.group = new THREE.Group();
    this.buildStatic();
    this.buildMoving();
    this.update({ yaw: 0, pivotH: BRIDGE.pivotH.park, length: BRIDGE.tunnel.parked, pitch: 0, cabinYaw: 0, door: null });
  }

  buildStatic() {
    const B = BRIDGE;
    const fixed = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.6, B.fixed.length), shellMat(0xcfd8e0));
    fixed.position.set(B.root.x, B.fixed.ground, (B.root.z + B.pivot.z) / 2);
    this.group.add(fixed);
    for (let i = 0; i < 8; i++) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.9), glassMat());
      win.position.set(1.61, B.fixed.ground + 0.2, B.root.z + 0.6 + i * 0.95);
      win.rotation.y = Math.PI / 2;
      this.group.add(win);
    }
    for (const z of [B.root.z + 1.5, B.pivot.z - 1.2]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, B.fixed.ground - 1.3, 12), darkMat());
      col.position.set(0, (B.fixed.ground - 1.3) / 2, z);
      this.group.add(col);
    }
  }

  buildMoving() {
    const B = BRIDGE;
    const T = B.tunnel;

    // 固定立柱
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 7, 16), darkMat());
    pillar.position.set(B.pivot.x, 3.5, B.pivot.z);
    this.group.add(pillar);

    // 柔性波纹罩：连接固定廊道端与 rotunda（倾斜圆柱，update 时对齐）
    const flexGeo = new THREE.CylinderGeometry(1.45, 1.45, 1, 20, 6, true);
    this.flex = new THREE.Mesh(flexGeo, shellMat(0xc2ccd4));
    this.group.add(this.flex);

    // rotunda（圆柱对称：整体旋转视觉无差，摆动件挂其内部）
    this.rotunda = new THREE.Group();
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 2.4, 28), shellMat(0xe6ebf0));
    this.rotunda.add(drum);
    for (const yy of [1.2, -1.2]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.08, 8, 32), darkMat());
      ring.rotation.x = Math.PI / 2; ring.position.y = yy;
      this.rotunda.add(ring);
    }
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2;
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 1.0), glassMat());
      w.position.set(Math.sin(a) * 1.71, 0, Math.cos(a) * 1.71);
      w.rotation.y = a;
      this.rotunda.add(w);
    }
    this.group.add(this.rotunda);

    // 摆动系：挂在 rotunda 中心，本地 +Z 伸出
    this.swing = new THREE.Group();
    this.rotunda.add(this.swing);

    this.outerLen = 6.5;
    const outer = new THREE.Mesh(new THREE.BoxGeometry(T.width, T.height, this.outerLen), shellMat());
    outer.position.set(0, 0, T.rootOffset + this.outerLen / 2);
    this.swing.add(outer);
    for (let i = 0; i < 5; i++) for (const sx of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.9), glassMat());
      w.position.set(sx * (T.width / 2 + 0.01), 0.15, T.rootOffset + 1.0 + i * 1.1);
      w.rotation.y = sx < 0 ? -Math.PI / 2 : Math.PI / 2;
      this.swing.add(w);
    }

    // 伸缩内管（单位长度几何，scale.z 伸缩）
    const innerGeo = new THREE.BoxGeometry(T.width - 0.16, T.height - 0.16, 1);
    this.inner = new THREE.Mesh(innerGeo, shellMat(0xf2f5f8));
    this.swing.add(this.inner);

    // 内管窗户（预建，按需显示）
    this.innerWins = [];
    this.innerWinGroup = new THREE.Group();
    this.swing.add(this.innerWinGroup);
    for (let i = 0; i < 14; i++) for (const sx of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.85), glassMat());
      w.rotation.y = sx < 0 ? -Math.PI / 2 : Math.PI / 2;
      w.position.x = sx * (T.width / 2 - 0.07);
      w.visible = false;
      this.innerWinGroup.add(w);
      this.innerWins.push({ m: w, side: sx, index: i });
    }

    // 接机舱（独立偏航）
    this.cabin = new THREE.Group();
    this.swing.add(this.cabin);
    const cabBody = new THREE.Mesh(new THREE.BoxGeometry(B.approach.x, B.approach.y, 2.4), shellMat(0xeef1f4));
    cabBody.position.set(0, 0, 1.2);
    this.cabin.add(cabBody);
    this.apron = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.9, 0.4),
      new THREE.MeshStandardMaterial({ color: 0x33404d, roughness: 0.9 }));
    this.apron.position.set(0, -0.05, 2.55);
    this.cabin.add(this.apron);
    for (const sx of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.8), glassMat());
      w.position.set(sx * (B.approach.x / 2 + 0.01), 0.1, 1.2);
      w.rotation.y = sx < 0 ? -Math.PI / 2 : Math.PI / 2;
      this.cabin.add(w);
    }
    this.beacon = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xff5a3c, emissive: 0x551100 }));
    this.beacon.position.set(0, B.approach.y / 2 + 0.18, 1.2);
    this.cabin.add(this.beacon);
  }

  update(cfg) {
    this.cfg = cfg;
    const B = BRIDGE;
    this.rotunda.position.set(B.pivot.x, cfg.pivotH, B.pivot.z);
    this.rotunda.rotation.y = cfg.yaw * Math.PI / 180;

    // 柔性罩对齐固定廊道端(0, ground, pivot.z-0.8) → rotunda 南侧
    const a = new THREE.Vector3(B.pivot.x, B.fixed.ground, B.pivot.z - 0.8);
    const bPt = new THREE.Vector3(B.pivot.x, cfg.pivotH, B.pivot.z - 1.2);
    const mid = a.clone().add(bPt).multiplyScalar(0.5);
    const span = a.distanceTo(bPt);
    this.flex.position.copy(mid);
    this.flex.scale.set(1, span, 1);
    this.flex.quaternion.setFromUnitVectors(UP, bPt.clone().sub(a).normalize());

    this.swing.rotation.x = cfg.pitch * Math.PI / 180;

    // 内管：从外管内部伸出至目标长度
    const innerStartLocal = B.tunnel.rootOffset + this.outerLen - 0.8;
    const innerLen = Math.max(0.3, cfg.length - (this.outerLen - 0.8));
    this.inner.scale.set(1, 1, innerLen);
    this.inner.position.set(0, 0, innerStartLocal + innerLen / 2);

    for (const { m, side, index } of this.innerWins) {
      const z = innerStartLocal + 1 + index * 1.1;
      m.visible = z < innerStartLocal + innerLen - 0.6;
      m.position.z = z;
    }

    this.cabin.position.set(0, 0, B.tunnel.rootOffset + cfg.length + 0.05);
    this.cabin.rotation.y = -cfg.cabinYaw * Math.PI / 180;
  }

  apronWorld(cfg) {
    const d = dirFromYaw(cfg.yaw);
    const end = BRIDGE.tunnel.rootOffset + cfg.length + 2.75;
    return {
      x: BRIDGE.pivot.x + d.x * end,
      y: cfg.pivotH + Math.tan(cfg.pitch * Math.PI / 180) * cfg.length,
      z: BRIDGE.pivot.z + d.z * end,
    };
  }

  setAlert(on) {
    this.beacon.material.emissive.setHex(on ? 0xff2a00 : 0x551100);
    this.beacon.material.color.setHex(on ? 0xff3b1f : 0xff5a3c);
  }
}
