import * as THREE from 'three';
import { flatPlane } from './apron.js';

const mat = (c, r = 0.6, m = 0.1) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });

function wheel(cx, cz, r = 0.45, width = 0.3) {
  const g = new THREE.Group();
  const w = new THREE.Mesh(new THREE.CylinderGeometry(r, r, width, 14), mat(0x15181c, 0.9));
  w.rotation.x = Math.PI / 2;
  w.position.set(cx, r, cz);
  g.add(w);
  return g;
}

function beacon(x, y, z, color = 0xff8a00) {
  return new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8 }));
}

// 牵引车 + 行李拖车
function baggageTrain() {
  const g = new THREE.Group();
  const yellow = mat(0xf2b705);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.6, 2.0), yellow);
  cab.position.set(0, 1.1, 0); g.add(cab);
  const cabGlass = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.7, 1.8), mat(0x243444, 0.2, 0.5));
  cabGlass.position.set(0, 1.55, 0); g.add(cabGlass);
  g.add(wheel(0.8, 0.95), wheel(0.8, -0.95), wheel(-0.8, 0.95), wheel(-0.8, -0.95));
  g.add(beacon(0, 2.05, 0));
  for (let i = 0; i < 3; i++) {
    const trailer = new THREE.Group();
    const bed = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.3, 2.6), mat(0x6b7480));
    bed.position.set(-2.6 - i * 2.9, 0.75, 0); trailer.add(bed);
    for (let j = -1; j <= 1; j++) {
      const carton = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.7),
        mat([0x3b6ea5, 0x8a5a3b, 0x4f7a4f][(i + j + 3) % 3]));
      carton.position.set(-2.6 - i * 2.9, 1.3, j * 0.8);
      trailer.add(carton);
    }
    trailer.add(wheel(-2.0 - i * 2.9, 0.85, 0.35), wheel(-3.2 - i * 2.9, 0.85, 0.35));
    trailer.add(wheel(-2.0 - i * 2.9, -0.85, 0.35), wheel(-3.2 - i * 2.9, -0.85, 0.35));
    g.add(trailer);
  }
  return g;
}

// 加油车
function fuelTruck() {
  const g = new THREE.Group();
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.8, 2.2), mat(0xdfe3e8));
  cab.position.set(2.6, 1.2, 0); g.add(cab);
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 4.2, 18), mat(0xc9d2da));
  tank.rotation.z = Math.PI / 2;
  tank.position.set(-0.6, 1.4, 0); g.add(tank);
  for (const zz of [0.9, -0.9]) {
    g.add(wheel(2.4, zz), wheel(0, zz, 0.5), wheel(-1.8, zz, 0.5));
  }
  g.add(beacon(2.6, 2.25, 0, 0xff2a2a));
  const label = flatPlane(3.4, 0.7, 0xc0392b, 1);
  label.rotation.x = -Math.PI / 2;
  label.position.set(-0.6, 2.46, 0);
  g.add(label);
  return g;
}

// 摆渡车（大巴）
function bus() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(9, 2.6, 2.4), mat(0x2f7fc1));
  body.position.y = 1.7; g.add(body);
  const win = new THREE.Mesh(new THREE.BoxGeometry(8.4, 0.8, 2.45), mat(0x163047, 0.15, 0.5));
  win.position.set(0, 2.2, 0); g.add(win);
  for (const x of [-3.2, 3.2]) for (const z of [1.05, -1.05]) g.add(wheel(x, z, 0.55));
  return g;
}

// 自行式登机车（客梯/高舱）
function passengerStep() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(3.0, 1.2, 1.8), mat(0xe8b500));
  base.position.set(0, 0.9, 0); g.add(base);
  const platform = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.25, 1.6), mat(0xdfe3e8));
  platform.position.set(-1.6, 2.6, 0); g.add(platform);
  const rail = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.9, 0.08), mat(0xf2c14e));
  rail.position.set(-1.6, 3.1, 0.8); g.add(rail);
  const rail2 = rail.clone(); rail2.position.z = -0.8; g.add(rail2);
  g.add(wheel(1.0, 0.8), wheel(-1.0, 0.8), wheel(1.0, -0.8), wheel(-1.0, -0.8));
  return g;
}

// 行李传送带车
function beltLoader() {
  const g = new THREE.Group();
  const car = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.4, 1.8), mat(0x6f7c8a));
  car.position.set(1.4, 1.0, 0); g.add(car);
  const belt = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.2, 1.2), mat(0x222831, 0.85));
  belt.position.set(-1.0, 1.8, 0);
  belt.rotation.z = 0.28;
  g.add(belt);
  g.add(wheel(1.8, 0.8), wheel(0.8, 0.8), wheel(1.8, -0.8), wheel(0.8, -0.8));
  g.add(beacon(1.4, 1.85, 0));
  return g;
}

function cone(x, z) {
  const g = new THREE.Group();
  const c = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.55, 12), mat(0xf26b21, 0.8));
  c.position.y = 0.3; g.add(c);
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.06, 0.42), mat(0x1c1f24, 0.9));
  base.position.y = 0.03; g.add(base);
  g.position.set(x, 0, z);
  return g;
}

export class GroundVehicles {
  constructor() {
    this.group = new THREE.Group();
    this.movers = [];

    const train = baggageTrain();
    train.position.set(14, 0, 22);
    train.rotation.y = Math.PI / 2;
    this.group.add(train);
    this.train = train;

    const fuel = fuelTruck();
    fuel.position.set(-24, 0, 14);
    fuel.rotation.y = Math.PI;
    this.group.add(fuel);

    const bus1 = bus();
    bus1.position.set(30, 0, 26);
    this.group.add(bus1);
    this.movers.push({ o: bus1, axis: 'x', base: 30, range: 26, speed: 1.6, phase: 0 });

    const steps = passengerStep();
    steps.position.set(20, 0, -13.5);
    steps.rotation.y = -Math.PI / 2;
    this.group.add(steps);

    const belt = beltLoader();
    belt.position.set(16, 0, -15);
    belt.rotation.y = -Math.PI / 2;
    this.group.add(belt);

    // 安全锥：廊桥根部禁停区四角
    for (const [x, z] of [[-3.2, -20], [3.2, -20], [-3.2, -24], [3.2, -24],
      [12, -18], [-12, -18]]) {
      this.group.add(cone(x, z));
    }
  }

  // 车辆沿滑行道缓慢往返（纯氛围，不进入安全区）
  update(elapsed) {
    for (const m of this.movers) {
      const t = (Math.sin(elapsed * 0.12 * m.speed + m.phase) + 1) / 2;
      m.o.position.x = m.base - m.range + t * m.range * 2;
    }
  }
}
