import { BRIDGE, STEP } from '../config.js';
import { clamp, wrapAngle, yawOf, dirFromYaw, pointToSegment, pointToTriangle } from './math.js';

// 由廊桥姿态生成关键路径点（世界空间）
export function bridgePath(cfg) {
  const B = BRIDGE;
  const d = dirFromYaw(cfg.yaw);
  const pp = Math.tan(cfg.pitch * Math.PI / 180);
  const rootH = cfg.pivotH;
  const rootWorld = { x: B.pivot.x + d.x * B.tunnel.rootOffset, y: rootH, z: B.pivot.z + d.z * B.tunnel.rootOffset };
  const cabBase = {
    x: B.pivot.x + d.x * (B.tunnel.rootOffset + cfg.length),
    y: rootH + pp * cfg.length,
    z: B.pivot.z + d.z * (B.tunnel.rootOffset + cfg.length),
  };
  const approach = { x: cfg.door.x - cabBase.x, z: cfg.door.z - cabBase.z };
  const alen = Math.hypot(approach.x, approach.z) || 1e-6;
  const nose = { x: cfg.door.x, y: cfg.door.y, z: cfg.door.z };
  // 接机舱中心（门点沿进近反方向回退）
  const cabCenter = { x: cfg.door.x - approach.x / alen * 1.3, y: (cabBase.y + cfg.door.y) / 2, z: cfg.door.z - approach.z / alen * 1.3 };
  return { rootWorld, cabBase, cabCenter, nose, d, pp };
}

// 碰撞检测：对通道/接机舱轴线采样，返回首个侵入
function checkCollision(cfg, aircraft, target) {
  const path = bridgePath(cfg);
  const cols = aircraft.colliders();
  const samples = [];
  // 段: [a,b,跳过a端距离,跳过b端距离]
  const segs = [
    [path.rootWorld, path.cabBase, 0.6, 0.0],
    [path.cabBase, path.cabCenter, 0.15, 0.0],
  ];
  for (const [a, b, skipA, skipB] of segs) {
    const total = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const n = Math.max(1, Math.ceil(total / STEP));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (t * total < skipA || (1 - t) * total < skipB) continue;
      samples.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  for (const p of samples) {
    // 门点本身贴合机身（设计如此）：仅豁免门点沿“机身切线”方向的小邻域，
    // 斜向擦碰机身的路径不会被豁免
    const along = Math.abs((p.x - target.x) * target.nx + (p.z - target.z) * target.nz);
    const df = pointToSegment(p, cols.fuselage.a, cols.fuselage.b) - cols.fuselage.r;
    if (df < BRIDGE.margin.fuselage && along > 0.9) return { hit: true, point: p, object: '机身', clearance: df };
    for (const e of cols.engines) {
      const de = pointToSegment(p, e.a, e.b) - e.r;
      if (de < BRIDGE.margin.engine) return { hit: true, point: p, object: '发动机', clearance: de };
    }
    for (const tri of cols.wingTris) {
      const dw = pointToTriangle(p, tri[0], tri[1], tri[2]);
      if (dw < BRIDGE.margin.wing) return { hit: true, point: p, object: '机翼', clearance: dw };
    }
  }
  return { hit: false };
}

// 主求解
export function solveBridge(aircraft) {
  const B = BRIDGE;
  const target = aircraft.doorTarget();
  const dx = target.x - B.pivot.x;
  const dz = target.z - B.pivot.z;
  const horizontal = Math.hypot(dx, dz);
  const dzc = Math.abs(dz) < 1e-9 && dx === 0 ? 0 : dz;
  const yaw = horizontal < 1e-6 ? 0 : yawOf(dx, dzc);

  if (yaw < B.yaw.min || yaw > B.yaw.max) {
    return { ok: false, code: 'YAW_LIMIT', stage: '水平旋转',
      message: `水平旋转角 ${yaw.toFixed(1)}° 超出机械止档 [${B.yaw.min}°, ${B.yaw.max}°]，停止操作` };
  }

  const reach = horizontal - B.tunnel.rootOffset;
  if (reach < B.tunnel.min) {
    return { ok: false, code: 'TOO_NEAR', stage: '伸缩',
      message: `飞机距廊桥立柱过近（需伸缩 ${reach.toFixed(1)}m < 最小 ${B.tunnel.min}m），停止操作，请重新引导停机` };
  }
  if (reach > B.tunnel.max) {
    return { ok: false, code: 'REACH_LIMIT', stage: '伸缩',
      message: `对接距离 ${reach.toFixed(1)}m 超出最大伸缩 ${B.tunnel.max}m，飞机停靠过远，停止操作` };
  }

  // 接机舱偏航：仅用于补偿机身偏航（让接机舱与舱门平行）。
  // 左舷外法线朝向 doorOutYaw，进近朝向为 yaw+180，二者之差即偏转角。
  const doorOutYaw = yawOf(target.nx, target.nz);
  const cabinYaw = wrapAngle(doorOutYaw - (yaw + 180));
  if (Math.abs(cabinYaw) > B.cabinYaw.max) {
    return { ok: false, code: 'CABIN_YAW_LIMIT', stage: '接机舱偏转',
      message: `机身偏航 ${Math.abs(cabinYaw).toFixed(1)}° 超出接机舱 ±${B.cabinYaw.max}° 补偿范围，停止操作` };
  }

  // 枚举立柱高度（闭区间、密采样），求可行的俯仰/伸缩组合，选俯仰最小者
  const STEP_H = 0.02;
  let best = null;
  for (let rootH = B.pivotH.min; rootH <= B.pivotH.max + 1e-9; rootH += STEP_H) {
    const dV = target.y - rootH;
    const proj = Math.sqrt(Math.max(0, reach * reach - dV * dV));
    const length = Math.hypot(proj, dV);
    const pitch = Math.atan2(dV, proj) * 180 / Math.PI;
    if (length < B.tunnel.min || length > B.tunnel.max) continue;
    if (pitch < B.pitch.min || pitch > B.pitch.max) continue;
    const score = Math.abs(pitch) + Math.abs(rootH - B.fixed.ground) * 0.02;
    if (!best || score < best.score) best = { cfg: { yaw, pivotH: rootH, length, pitch, cabinYaw, door: target }, score };
  }
  if (!best) {
    // 诊断可达包线
    const pitchAtMin = Math.asin(clamp((target.y - B.pivotH.min) / reach, -1, 1)) * 180 / Math.PI;
    const pitchAtMax = Math.asin(clamp((target.y - B.pivotH.max) / reach, -1, 1)) * 180 / Math.PI;
    return { ok: false, code: 'PITCH_LIMIT', stage: '俯仰/升降',
      message: `舱门高 ${target.y.toFixed(2)}m 超出“升降 ${B.pivotH.min}~${B.pivotH.max}m + 俯仰 ±${B.pitch.max}°”可达包线（当前需俯仰 ${pitchAtMin.toFixed(1)}°~${pitchAtMax.toFixed(1)}°），停止操作` };
  }

  const col = checkCollision(best.cfg, aircraft, target);
  if (col.hit) {
    return { ok: false, code: 'COLLISION', stage: '碰撞检测',
      message: `对接路径与${col.object}净距仅 ${Math.max(0, col.clearance).toFixed(2)}m（要求安全距离 ${col.object === '机身' ? B.margin.fuselage : col.object === '发动机' ? B.margin.engine : B.margin.wing}m 以上），停止操作`,
      point: col.point };
  }

  return { ok: true, cfg: best.cfg, horizontal, target };
}
