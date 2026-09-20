import * as THREE from 'three';
import { BRIDGE } from '../config.js';

function flatPlane(w, d, color, opacity = 1) {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, side: THREE.DoubleSide, depthWrite: opacity === 1 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  m.rotation.x = -Math.PI / 2;
  return m;
}

// 地面标线绘制器（XZ 平面）
class LinePainter {
  constructor() {
    this.obj = new THREE.Group();
  }
  rect(x, z, w, d, color = 0xf4c20d, opacity = 1) {
    const t = 0.22;
    const top = flatPlane(w, t, color, opacity); top.position.set(x, 0.02, z - d / 2);
    const bot = flatPlane(w, t, color, opacity); bot.position.set(x, 0.02, z + d / 2);
    const l = flatPlane(t, d, color, opacity); l.position.set(x - w / 2, 0.02, z);
    const r = flatPlane(t, d, color, opacity); r.position.set(x + w / 2, 0.02, z);
    this.obj.add(top, bot, l, r);
  }
  box(x, z, w, d, color, opacity) {
    const p = flatPlane(w, d, color, opacity); p.position.set(x, 0.015, z); this.obj.add(p);
  }
  lineAlongX(x1, x2, z, color = 0xf4c20d, width = 0.25, dash = 0) {
    const len = x2 - x1;
    if (!dash) {
      const p = flatPlane(Math.abs(len), width, color);
      p.position.set((x1 + x2) / 2, 0.02, z);
      this.obj.add(p);
    } else {
      for (let x = x1; x < x2; x += dash * 2) {
        const seg = flatPlane(Math.min(dash, x2 - x), width, color);
        seg.position.set(x + Math.min(dash, x2 - x) / 2, 0.02, z);
        this.obj.add(seg);
      }
    }
  }
  lineAlongZ(x, z1, z2, color = 0xf4c20d, width = 0.25) {
    const p = flatPlane(width, Math.abs(z2 - z1), color);
    p.position.set(x, 0.02, (z1 + z2) / 2);
    this.obj.add(p);
  }
  text(label, x, z, size = 3, color = 0xffffff) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#' + new THREE.Color(color).getHexString();
    ctx.font = 'bold 96px Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, 128, 66);
    const tex = new THREE.CanvasTexture(c);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size * 2, size),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.03, z);
    this.obj.add(m);
  }
}

export class Apron {
  constructor() {
    this.group = new THREE.Group();
    this.buildGround();
    this.buildTerminal();
    this.buildMarkings();
    this.buildSafetyZones();
  }

  buildGround() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(260, 200),
      new THREE.MeshStandardMaterial({ color: 0x3a4148, roughness: 0.95 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);

    // 滑行道（稍浅色）
    const taxi = flatPlane(200, 12, 0x454d55);
    taxi.position.set(0, 0.005, 26);
    this.group.add(taxi);
  }

  buildTerminal() {
    const term = new THREE.Group();
    const facade = new THREE.Mesh(
      new THREE.BoxGeometry(120, 12, 14),
      new THREE.MeshStandardMaterial({ color: 0xb9c4cf, roughness: 0.7 })
    );
    facade.position.set(0, 6, -44);
    term.add(facade);
    // 玻璃幕墙
    for (let i = -14; i <= 14; i++) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 7),
        new THREE.MeshStandardMaterial({ color: 0x2c4a63, roughness: 0.15, metalness: 0.5, emissive: 0x0a1a2c, emissiveIntensity: 0.4 }));
      win.position.set(i * 3.6, 5.5, -36.95);
      term.add(win);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(124, 1.2, 16),
      new THREE.MeshStandardMaterial({ color: 0x8d99a6, roughness: 0.6 }));
    roof.position.set(0, 12.4, -44);
    term.add(roof);
    // 登机口编号
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#10161d'; ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#ffd24a'; ctx.font = 'bold 72px Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('B12', 128, 64);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(4, 2),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), side: THREE.DoubleSide }));
    sign.position.set(0, 9.5, -36.9);
    term.add(sign);
    this.group.add(term);
  }

  buildMarkings() {
    const p = new LinePainter();
    // 机位居中线（沿 X，飞机滑行方向）
    p.lineAlongX(-45, 45, 0, 0xf4c20d, 0.3, 1.6);
    // 停止线（前起落架）
    p.lineAlongZ(-0, -1.4, 1.4, 0xffffff, 0.5);
    // 廊桥活动区边界（半圆扇形近似：矩形提示框）
    p.rect(0, -9.5, 34, 25, 0xf4c20d, 0.9);
    // 翼尖净距线
    p.lineAlongX(-40, 40, 20, 0xf4c20d, 0.22, 1.4);
    p.lineAlongX(-40, 40, -20, 0xf4c20d, 0.22, 1.4);
    // 机位编号
    p.text('B12', 24, 14, 3.2, 0xffffff);
    // 廊桥根部禁停斜线区
    for (let i = -6; i <= 6; i += 2) {
      const s = flatPlane(0.35, 3.2, 0xd83b3b, 0.85);
      s.rotation.z = 0.5;
      s.rotation.x = -Math.PI / 2;
      s.position.set(i, 0.02, -22);
      this.group.add(s);
    }
    this.group.add(p.obj);
  }

  buildSafetyZones() {
    // 机身安全带（红色半透明长条）、舱门工作区（黄色）、发动机危险区（红色虚线圆）
    this.fuselageZone = flatPlane(40, 3.0, 0xd83b3b, 0.14);
    this.fuselageZone.position.y = 0.02;
    this.group.add(this.fuselageZone);

    this.doorZone = flatPlane(4, 4, 0xf4c20d, 0.2);
    this.doorZone.position.y = 0.025;
    this.group.add(this.doorZone);

    this.engineZones = [];
    this.engineRingGeo = new THREE.RingGeometry(2.4, 2.75, 40);
    // 运行时按飞机摆放
  }

  updateSafety(aircraft) {
    const t = aircraft.type;
    // 机身安全带：沿飞机长轴
    this.fuselageZone.position.set(aircraft.pose.x, 0.02, aircraft.pose.z);
    this.fuselageZone.scale.set(t.length / 40, 1, 1);
    this.fuselageZone.rotation.z = -aircraft.pose.headingDeg * Math.PI / 180;

    // 舱门工作区
    const door = aircraft.doorTarget();
    this.doorZone.position.set(
      door.x - door.nx * 2.0, 0.025, door.z - door.nz * 2.0
    );
    this.doorZone.rotation.z = -Math.atan2(door.nz, door.nx) - Math.PI / 2;

    // 发动机进气危险区
    while (this.engineZones.length) {
      const r = this.engineZones.pop();
      this.group.remove(r); r.geometry.dispose();
    }
    const zs = t.engineCount === 4 ? t.engineZ : [t.engineZ];
    for (const side of [-1, 1]) for (const zAbs of zs) {
      const front = aircraft.toWorld(t.engineX + t.engineLen / 2 + 1.2, 0.02, side * zAbs);
      const ring = new THREE.Mesh(this.engineRingGeo,
        new THREE.MeshBasicMaterial({ color: 0xd83b3b, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(front.x, 0.03, front.z);
      this.group.add(ring);
      this.engineZones.push(ring);
    }
  }
}

export { flatPlane };
