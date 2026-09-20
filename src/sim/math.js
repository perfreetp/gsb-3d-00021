export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const RAD = Math.PI / 180;
export const DEG = 180 / Math.PI;

export function wrapAngle(a) {
  while (a > 180) a -= 360;
  while (a < -180) a += 360;
  return a;
}

// 相对 +Z 的水平角（向 +X 为正），单位度
export function yawOf(dx, dz) {
  if (Math.abs(dx) < 1e-9 && Math.abs(dz) < 1e-9) return 0;
  return Math.atan2(dx, dz) * DEG;
}

// yaw（度）→ 水平方向
export function dirFromYaw(yawDeg) {
  const a = yawDeg * RAD;
  return { x: Math.sin(a), z: Math.cos(a) };
}

export function dist2D(ax, az, bx, bz) {
  return Math.hypot(ax - bx, az - bz);
}

// 点到线段（3D）最近距离
export function pointToSegment(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y, vz = b.z - a.z;
  const wx = p.x - a.x, wy = p.y - a.y, wz = p.z - a.z;
  const len2 = vx * vx + vy * vy + vz * vz;
  let t = len2 > 1e-9 ? (wx * vx + wy * vy + wz * vz) / len2 : 0;
  t = clamp(t, 0, 1);
  const dx = p.x - (a.x + vx * t), dy = p.y - (a.y + vy * t), dz = p.z - (a.z + vz * t);
  return Math.hypot(dx, dy, dz);
}

// 点到“沿 X 轴胶囊”的距离（表面）：x 段 [cx0,cx1]，半径 r
export function pointToCapsuleX(p, cx0, cx1, cy, cz, r) {
  const x = clamp(p.x, cx0, cx1);
  const d = Math.hypot(p.x - x, p.y - cy, p.z - cz);
  return d - r;
}

function closestOnSegment2(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const len2 = vx * vx + vy * vy;
  let t = len2 > 1e-9 ? ((px - ax) * vx + (py - ay) * vy) / len2 : 0;
  t = clamp(t, 0, 1);
  return [ax + vx * t, ay + vy * t];
}

// 点到三角形（3D）表面最近距离
export function pointToTriangle(p, a, b, c) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const acx = c.x - a.x, acy = c.y - a.y, acz = c.z - a.z;
  const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
  const nlen = Math.hypot(nx, ny, nz) || 1e-9;
  const ux = nx / nlen, uy = ny / nlen, uz = nz / nlen;
  const t = ((a.x - p.x) * ux + (a.y - p.y) * uy + (a.z - p.z) * uz);
  const qx = p.x + ux * t, qy = p.y + uy * t, qz = p.z + uz * t;
  const w0x = qx - a.x, w0y = qy - a.y, w0z = qz - a.z;
  const wu = w0x * abx + w0y * aby + w0z * abz;
  const wv = w0x * acx + w0y * acy + w0z * acz;
  if (wu >= 0 && wv >= 0 && wu + wv <= abx * abx + aby * aby + abz * abz) {
    return Math.hypot(p.x - qx, p.y - qy, p.z - qz);
  }
  const d1 = pointToSegment(p, a, b);
  const d2 = pointToSegment(p, b, c);
  const d3 = pointToSegment(p, c, a);
  return Math.min(d1, d2, d3);
}
