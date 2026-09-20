import * as THREE from 'three';
import { AIRCRAFT_TYPES } from '../config.js';

// 飞机：局部坐标 X 机头方向，Y 上，Z 右舷（廊桥在左舷 Z 负侧）
export class Aircraft {
  constructor(typeId, pose) {
    this.typeId = typeId;
    this.pose = pose; // {x,z,headingDeg}
    this.type = AIRCRAFT_TYPES[typeId];
    this.door = this.type.doors[0];
    this.doorId = this.door.id;
    this.build();
    this.updateTransform();
  }

  setType(typeId, doorId) {
    this.typeId = typeId;
    this.type = AIRCRAFT_TYPES[typeId];
    this.door = this.type.doors.find(d => d.id === doorId) || this.type.doors[0];
    this.doorId = this.door.id;
    this.build();
    this.updateTransform();
  }

  setDoor(doorId) {
    this.door = this.type.doors.find(d => d.id === doorId) || this.type.doors[0];
    this.doorId = this.door.id;
  }

  setPose(pose) {
    this.pose = pose;
    this.updateTransform();
  }

  // 本地 -> 世界
  toWorld(lx, ly, lz) {
    const h = this.pose.headingDeg * Math.PI / 180;
    const c = Math.cos(h), s = Math.sin(h);
    return {
      x: this.pose.x + c * lx + s * lz,
      y: ly,
      z: this.pose.z - s * lx + c * lz,
    };
  }

  // 当前选中舱门的世界位置与外法线
  doorTarget() {
    const d = this.door;
    const lz = d.z === null ? -this.type.fuselageRadius : d.z;
    const p = this.toWorld(d.x, d.y, lz);
    const h = this.pose.headingDeg * Math.PI / 180;
    const n = { x: -Math.sin(h), z: -Math.cos(h) }; // 左舷水平外法线
    return { x: p.x, y: p.y, z: p.z, nx: n.x, nz: n.z };
  }

  updateTransform() {
    this.object.position.set(this.pose.x, 0, this.pose.z);
    this.object.rotation.y = -this.pose.headingDeg * Math.PI / 180;
  }

  // ---- 碰撞体（世界空间胶囊/三角形） ----
  colliders() {
    const t = this.type;
    const fus = (() => {
      const a = this.toWorld(t.cylStart, t.fuselageRadius, 0);
      const b = this.toWorld(t.cylEnd, t.fuselageRadius, 0);
      return { kind: 'capsuleSeg', a, b, r: t.fuselageRadius };
    })();
    const engines = [];
    const zs = t.engineCount === 4 ? t.engineZ : [t.engineZ];
    for (const side of [-1, 1]) {
      for (const zAbs of zs) {
        const a = this.toWorld(t.engineX - t.engineLen / 2, t.engineY, side * zAbs);
        const b = this.toWorld(t.engineX + t.engineLen / 2, t.engineY, side * zAbs);
        engines.push({ kind: 'capsuleSeg', a, b, r: t.engineR });
      }
    }
    const wingTris = this.wingTriangles();
    return { fuselage: fus, engines, wingTris };
  }

  wingTriangles() {
    const t = this.type;
    const xr = t.wingRootX;
    const yl = t.wingLeadingY, yt = t.wingTrailingY, xt = t.wingTipX, zt = t.wingSpan / 2;
    const wy = t.fuselageRadius - 0.25;
    // 只保留外翼段（翼根与机身相交段由机身胶囊覆盖）
    const rootZ = 3.2, tipZ = zt;
    const lxAt = (zAbs) => {
      const k = (zAbs - rootZ) / (tipZ - rootZ);
      return { lead: (xr + 0.6) + ((xt - 1.0) - (xr + 0.6)) * k,
               trail: (xr + yt) + ((xt - 4.2) - (xr + yt)) * k };
    };
    const rI = lxAt(rootZ), rO = lxAt(tipZ);
    const quads = [
      [[rI.lead, wy, -rootZ], [rO.lead, wy, -tipZ], [rO.trail, wy, -tipZ], [rI.trail, wy, -rootZ]],
      [[rI.lead, wy, rootZ], [rO.lead, wy, tipZ], [rO.trail, wy, tipZ], [rI.trail, wy, rootZ]],
    ];
    const tris = [];
    for (const q of quads) {
      const w = q.map(([x, y, z]) => this.toWorld(x, y, z));
      tris.push([w[0], w[1], w[2]], [w[0], w[2], w[3]]);
    }
    return tris;
  }

  // ============ 几何 ============
  build() {
    if (this.object) this.object.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    const group = new THREE.Group();
    const t = this.type;
    const bodyMat = new THREE.MeshStandardMaterial({ color: t.livery, roughness: 0.55, metalness: 0.18 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: t.stripe, roughness: 0.5 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 0.4, metalness: 0.3 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x0b1622, roughness: 0.15, metalness: 0.6 });

    // 机身（沿 X 轴胶囊）
    const barrel = (t.cylEnd - t.cylStart) / 2;
    const cylGeo = new THREE.CylinderGeometry(t.fuselageRadius, t.fuselageRadius, barrel * 2, 28, 1);
    cylGeo.rotateZ(Math.PI / 2);
    const cyl = new THREE.Mesh(cylGeo, bodyMat);
    cyl.position.set((t.cylStart + t.cylEnd) / 2, t.fuselageRadius, 0);
    group.add(cyl);
    for (const sx of [t.cylStart, t.cylEnd]) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(t.fuselageRadius, 28, 16), bodyMat);
      cap.scale.set(sx === t.cylEnd ? 1.5 : 1.15, 1, 1);
      cap.position.set(sx + (sx === t.cylEnd ? 0.35 : 0), t.fuselageRadius, 0);
      group.add(cap);
    }
    // 垂尾 / 平尾
    const finShape = new THREE.Shape();
    finShape.moveTo(-t.length / 2 + 7.5, t.fuselageRadius);
    finShape.lineTo(-t.length / 2 + 12.5, t.fuselageRadius);
    finShape.lineTo(-t.length / 2 + 10.5, t.fuselageRadius + 6.0 * (t.length > 60 ? 1.35 : 1));
    finShape.lineTo(-t.length / 2 + 7.0, t.fuselageRadius);
    const fin = new THREE.Mesh(new THREE.ShapeGeometry(finShape), bodyMat);
    fin.position.z = 0;
    group.add(fin);
    for (const side of [-1, 1]) {
      const stab = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.25, 4.2), bodyMat);
      stab.position.set(-t.length / 2 + 11, t.fuselageRadius + 0.4, side * 2.4);
      stab.rotation.y = side * 0.25;
      group.add(stab);
    }
    // 主翼
    for (const side of [-1, 1]) {
      const shape = new THREE.Shape();
      // 俯视平面（Shape 的 x=纵向机头方向, y=翼展方向），随后绕 X 轴压平到 XZ
      shape.moveTo(t.wingRootX + 0.6, side * 1.2);
      shape.lineTo(t.wingTipX - 1.0, side * t.wingSpan / 2);
      shape.lineTo(t.wingTipX - 4.2, side * t.wingSpan / 2);
      shape.lineTo(t.wingRootX + t.wingTrailingY, side * 1.2);
      shape.lineTo(t.wingRootX + 0.6, side * 1.2);
      const geo = new THREE.ShapeGeometry(shape);
      geo.rotateX(Math.PI / 2);
      const wing = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        color: t.livery, roughness: 0.5, metalness: 0.15, side: THREE.DoubleSide,
      }));
      wing.position.y = t.fuselageRadius - 0.25;
      group.add(wing);
    }
    // 发动机
    const zs = t.engineCount === 4 ? t.engineZ : [t.engineZ];
    for (const side of [-1, 1]) for (const zAbs of zs) {
      const engGeo = new THREE.CylinderGeometry(t.engineR, t.engineR * 0.85, t.engineLen, 20);
      engGeo.rotateZ(Math.PI / 2);
      const eng = new THREE.Mesh(engGeo, bodyMat);
      eng.position.set(t.engineX, t.engineY, side * zAbs);
      group.add(eng);
      const fan = new THREE.Mesh(new THREE.CircleGeometry(t.engineR * 0.78, 20), darkMat);
      fan.rotation.y = Math.PI / 2;
      fan.position.set(t.engineX + t.engineLen / 2 + 0.02, t.engineY, side * zAbs);
      group.add(fan);
    }
    // 起落架
    const gearMat = new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.7 });
    const wheel = (x, z, r) => {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.3, 14), gearMat);
      w.rotation.x = Math.PI / 2;
      w.position.set(x, r, z);
      group.add(w);
    };
    const strut = (x, z, h) => {
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, h, 8), gearMat);
      s.position.set(x, h / 2, z);
      group.add(s);
    };
    strut(t.noseGear, 0, t.fuselageRadius);
    wheel(t.noseGear, 0.35, 0.38); wheel(t.noseGear, -0.35, 0.38);
    for (const side of [-1, 1]) {
      strut(t.mainGear, side * t.gearTrack / 2, t.fuselageRadius);
      wheel(t.mainGear - 0.5, side * t.gearTrack / 2, 0.55);
      wheel(t.mainGear + 0.5, side * t.gearTrack / 2, 0.55);
    }
    // 舷窗
    const winGeo = new THREE.PlaneGeometry(0.28, 0.2);
    const yWin = t.doubleDeck ? [t.fuselageRadius * 1.28, t.fuselageRadius * 0.35] : [t.fuselageRadius * 0.45];
    for (let x = t.cylStart + 2; x <= t.cylEnd - 2.5; x += 1.15) {
      for (const side of [-1, 1]) for (const yw of yWin) {
        const w = new THREE.Mesh(winGeo, glassMat);
        w.position.set(x, yw, side * (t.fuselageRadius + 0.02));
        w.rotation.y = side < 0 ? -Math.PI / 2 : Math.PI / 2;
        group.add(w);
      }
    }
    // 驾驶舱
    const cockpit = new THREE.Mesh(new THREE.SphereGeometry(t.fuselageRadius * 0.7, 16, 10), glassMat);
    cockpit.scale.set(1.1, 0.5, 0.75);
    cockpit.position.set(t.cylEnd + 1.6, t.fuselageRadius + 0.5, 0);
    group.add(cockpit);
    // 舱门（左舷）
    for (const d of t.doors) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x0c1016, roughness: 0.3, side: THREE.DoubleSide });
      const doorH = d.id.endsWith('U') ? 1.5 : 1.85;
      const door = new THREE.Mesh(new THREE.PlaneGeometry(0.85, doorH), mat);
      door.position.set(d.x, d.y - 0.05, -t.fuselageRadius - 0.02);
      door.rotation.y = -Math.PI / 2;
      door.userData.isDoor = true;
      door.userData.doorId = d.id;
      group.add(door);
    }
    // 机身腰线
    const stripeGeo = new THREE.PlaneGeometry(barrel * 2, 0.22);
    for (const side of [-1, 1]) {
      const stripe = new THREE.Mesh(stripeGeo, stripeMat);
      stripe.position.set(0, t.fuselageRadius * 0.12, side * (t.fuselageRadius + 0.03));
      stripe.rotation.y = side < 0 ? -Math.PI / 2 : Math.PI / 2;
      group.add(stripe);
    }
    this.object = group;
  }
}
