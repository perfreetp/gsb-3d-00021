export const BRIDGE_LIMITS = {
  pivot: { x: 0, y: 5.6, z: -16 },
  minReach: 9,
  maxReach: 36,
  maxYawDeg: 125,
  minCabHeight: 2.8,
  maxCabHeight: 5.2,
  maxSlopeDeg: 10,
  contactGap: 0.28,
  cabLength: 1.8,
  tunnelClearance: 1.05,
};

export const AIRCRAFT_MODELS = [
  {
    id: "a320",
    name: "A320 窄体机",
    fuselageLength: 37.6,
    radius: 1.95,
    centerY: 2.5,
    doorOffsetX: 10.4,
    doorY: 3.6,
    wingSpan: 35.8,
    wingChord: 5.2,
    color: 0xe8f0f8,
    stripe: 0x1f77b4,
  },
  {
    id: "b737",
    name: "B737-800 窄体机",
    fuselageLength: 39.5,
    radius: 1.9,
    centerY: 2.45,
    doorOffsetX: 11.1,
    doorY: 3.55,
    wingSpan: 35.9,
    wingChord: 5.0,
    color: 0xf5f7fa,
    stripe: 0x24936f,
  },
  {
    id: "e175",
    name: "E175 支线客机",
    fuselageLength: 31.7,
    radius: 1.65,
    centerY: 2.0,
    doorOffsetX: 8.3,
    doorY: 3.15,
    wingSpan: 28.7,
    wingChord: 4.1,
    color: 0xf3eadb,
    stripe: 0xc77936,
  },
  {
    id: "b777",
    name: "B777-300ER 宽体机",
    fuselageLength: 73.9,
    radius: 3.1,
    centerY: 3.4,
    doorOffsetX: 16.4,
    doorY: 4.75,
    wingSpan: 64.8,
    wingChord: 8.4,
    color: 0xeef2f7,
    stripe: 0x4c5d9a,
  },
];

export const DEFAULT_AIRCRAFT = {
  modelId: "a320",
  x: 0,
  z: 10,
};

export function getModel(modelId) {
  return AIRCRAFT_MODELS.find((model) => model.id === modelId) ?? AIRCRAFT_MODELS[0];
}

export function getDoorPosition(aircraft, model, contactGap = BRIDGE_LIMITS.contactGap) {
  const verticalOffset = model.doorY - model.centerY;
  const sideOffset = Math.sqrt(Math.max(0, model.radius ** 2 - verticalOffset ** 2));
  return {
    x: aircraft.x + model.doorOffsetX,
    y: model.doorY,
    z: aircraft.z - sideOffset - contactGap,
  };
}

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function lerp(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

function pointSegmentCapsuleDistance(start, end, aircraft, model) {
  const halfCylinder = Math.max(0, model.fuselageLength / 2 - model.radius);
  const leftX = aircraft.x - halfCylinder;
  const rightX = aircraft.x + halfCylinder;
  const breaks = [0, 1];

  if (end.x !== start.x) {
    for (const boundX of [leftX, rightX]) {
      const t = (boundX - start.x) / (end.x - start.x);
      if (t > 0 && t < 1) breaks.push(t);
    }
  }
  breaks.sort((a, b) => a - b);

  let minimum = Number.POSITIVE_INFINITY;

  for (let interval = 0; interval < breaks.length - 1; interval += 1) {
    const t0 = breaks[interval];
    const t1 = breaks[interval + 1];
    const midpoint = (t0 + t1) / 2;
    const sample = lerp(start, end, midpoint);

    let axial;
    if (sample.x < leftX) {
      axial = { base: leftX - sample.x, slope: start.x - end.x };
    } else if (sample.x > rightX) {
      axial = { base: sample.x - rightX, slope: end.x - start.x };
    } else {
      axial = { base: 0, slope: 0 };
    }

    const vertical = { base: sample.y - model.centerY, slope: end.y - start.y };
    const lateral = { base: sample.z - aircraft.z, slope: end.z - start.z };

    for (const t of [t0, t1]) {
      const point = lerp(start, end, t);
      const dx = Math.max(0, leftX - point.x, point.x - rightX);
      const dy = point.y - model.centerY;
      const dz = point.z - aircraft.z;
      minimum = Math.min(minimum, Math.hypot(dx, dy, dz));
    }

    const denominator = axial.slope ** 2 + vertical.slope ** 2 + lateral.slope ** 2;
    if (denominator > 1e-9) {
      const numerator =
        axial.base * axial.slope + vertical.base * vertical.slope + lateral.base * lateral.slope;
      const stationary = -numerator / denominator;
      if (stationary > t0 && stationary < t1) {
        const point = lerp(start, end, stationary);
        const dx = Math.max(0, leftX - point.x, point.x - rightX);
        minimum = Math.min(
          minimum,
          Math.hypot(dx, point.y - model.centerY, point.z - aircraft.z),
        );
      }
    }
  }

  return minimum;
}

export function inspectBridgePath(pivot, target, aircraft, model, limits = BRIDGE_LIMITS) {
  const horizontal = new Float32Array([target.x - pivot.x, target.z - pivot.z]);
  const horizontalReach = Math.hypot(horizontal[0], horizontal[1]);
  const direction = horizontalReach === 0
    ? { x: 0, y: 0, z: 0 }
    : {
        x: (target.x - pivot.x) / horizontalReach,
        y: 0,
        z: (target.z - pivot.z) / horizontalReach,
      };
  const tunnelEnd = {
    x: target.x - direction.x * limits.cabLength,
    y: target.y - (pivot.y - target.y) * (limits.cabLength / Math.max(horizontalReach, 0.0001)),
    z: target.z - direction.z * limits.cabLength,
  };

  const mainClearance = pointSegmentCapsuleDistance(pivot, tunnelEnd, aircraft, model);
  const doorVertical = model.doorY - model.centerY;
  const doorSide = Math.sqrt(Math.max(0, model.radius ** 2 - doorVertical ** 2));
  const contactDistance = Math.hypot(doorSide + limits.contactGap, doorVertical);
  const startRequired = model.radius + limits.tunnelClearance;
  let cabClearance = Number.POSITIVE_INFINITY;
  let cabParameter = 0;
  const samples = 32;

  for (let index = 0; index <= samples; index += 1) {
    const t = index / samples;
    const point = lerp(tunnelEnd, target, t);
    const clearance = pointSegmentCapsuleDistance(point, point, aircraft, model);
    const required = startRequired + (contactDistance - startRequired) * t;
    if (clearance - required < cabClearance) {
      cabClearance = clearance - required;
      cabParameter = t;
    }
  }

  const mainSafe = mainClearance >= model.radius + limits.tunnelClearance - 0.001;
  return {
    safe: mainSafe && cabClearance >= -0.001,
    mainClearance,
    cabClearance,
    cabParameter,
    tunnelEnd,
  };
}

export function solveJetBridge(aircraft, model, limits = BRIDGE_LIMITS) {
  const pivot = limits.pivot;
  const target = getDoorPosition(aircraft, model, limits.contactGap);
  const delta = sub(target, pivot);
  const horizontalReach = Math.hypot(delta.x, delta.z);
  const yaw = Math.atan2(delta.x, delta.z);
  const pitch = Math.atan2(pivot.y - target.y, horizontalReach);
  const length = Math.hypot(horizontalReach, pivot.y - target.y);
  const slopeDeg = Math.abs(pitch) * 180 / Math.PI;
  const yawDeg = yaw * 180 / Math.PI;
  const collision = inspectBridgePath(pivot, target, aircraft, model, limits);

  const errors = [];
  if (horizontalReach < limits.minReach) {
    errors.push({ code: "REACH_MIN", message: `水平距离 ${horizontalReach.toFixed(1)}m 小于最小伸缩行程 ${limits.minReach}m` });
  }
  if (horizontalReach > limits.maxReach) {
    errors.push({ code: "REACH_MAX", message: `水平距离 ${horizontalReach.toFixed(1)}m 超过最大伸缩行程 ${limits.maxReach}m` });
  }
  if (Math.abs(yawDeg) > limits.maxYawDeg) {
    errors.push({ code: "YAW_LIMIT", message: `旋转角 ${yawDeg.toFixed(1)}° 超出 ±${limits.maxYawDeg}° 范围` });
  }
  if (target.y < limits.minCabHeight || target.y > limits.maxCabHeight) {
    errors.push({ code: "HEIGHT_LIMIT", message: `舱门高度 ${target.y.toFixed(1)}m 超出 ${limits.minCabHeight}-${limits.maxCabHeight}m 调节范围` });
  }
  if (slopeDeg > limits.maxSlopeDeg) {
    errors.push({ code: "SLOPE_LIMIT", message: `廊桥坡度 ${slopeDeg.toFixed(1)}° 超过 ${limits.maxSlopeDeg}° 安全限制` });
  }
  if (!collision.safe) {
    errors.push({ code: "FUSELAGE_COLLISION", message: "对接直线轨迹会侵入机身安全轮廓，已停止伸缩" });
  }

  return {
    ok: errors.length === 0,
    target,
    pivot,
    yaw,
    yawDeg,
    pitch,
    pitchDeg: pitch * 180 / Math.PI,
    slopeDeg,
    horizontalReach,
    length,
    errors,
    collision,
  };
}

export function formatSolution(solution) {
  if (!solution.ok) {
    return {
      state: "BLOCKED",
      title: "停止对接",
      reasons: solution.errors.map((error) => error.message),
    };
  }

  return {
    state: "PLANNED",
    title: "姿态计算完成",
    reasons: [
      `旋转角 ${solution.yawDeg.toFixed(1)}°`,
      `伸缩长度 ${solution.horizontalReach.toFixed(1)}m`,
      `舱门高度 ${solution.target.y.toFixed(1)}m`,
      `坡度 ${solution.slopeDeg.toFixed(1)}°`,
    ],
  };
}
