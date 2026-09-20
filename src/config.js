// 廊桥（乘客登机桥 PBB）机械参数
export const BRIDGE = {
  root: { x: 0, z: -30 },          // 航站楼门洞
  pivot: { x: 0, z: -22 },         // rotunda 立柱（转盘）地面位置
  // 固定廊道：root -> pivot，南→北
  fixed: { ground: 4.15, length: 8 },
  // rotunda 升降范围（决定通道根部高度）
  pivotH: { min: 3.0, max: 6.5, park: 4.15 },
  // 主通道伸缩（rotunda 中心 -> 通道根部水平偏移 1.0）
  tunnel: {
    rootOffset: 1.0,
    min: 7.0,
    max: 19.0,
    parked: 9.0,
    width: 1.7,
    height: 2.15,
  },
  yaw: { min: -165, max: 165, park: 0, deg: true },   // 相对 +Z 的水平角
  pitch: { min: -10, max: 10 },                          // 通道俯仰（度）
  cabinYaw: { min: -25, max: 25 },                     // 接机舱相对通道偏航（度）
  approach: { x: 2.6, y: 1.35 },                       // 接机舱尺寸
  margin: { fuselage: 0.6, engine: 0.8, wing: 0.25 },   // 碰撞安全距离（米）
  speeds: { yaw: 32, length: 3.2, height: 1.6, pitch: 8 }, // 单位: deg/s, m/s
};

// 舱门候选（飞机局部坐标，x 纵向机头为正，y 离地高，z 恒为左舷）
function doors(rows) { return rows.map(([id, x, y, label]) => ({ id, x, y, z: null, label })); }

// 机型库：尺寸单位米。机身以“胶囊”近似（圆柱段+半球端），机翼拆为两个三角形
export const AIRCRAFT_TYPES = {
  A320: {
    id: 'A320', label: '空客 A320', group: '窄体机',
    length: 37.57, fuselageRadius: 1.98, cylStart: -15.5, cylEnd: 15.5,
    noseGear: 12.5, mainGear: -1.5, gearTrack: 3.8,
    wingSpan: 35.8, wingRootX: 1.0, wingLeadingY: -0.9, wingTrailingY: 1.6, wingTipX: -4.2,
    engineCount: 2, engineX: 1.6, engineY: 1.45, engineZ: 4.6, engineLen: 3.2, engineR: 1.0,
    livery: 0xe8ecef, stripe: 0xd8232f,
    doors: doors([['L1', 14.2, 2.15, '前左舱门 L1'], ['L2', -14.6, 2.15, '后左舱门 L2']]),
  },
  B738: {
    id: 'B738', label: '波音 737-800', group: '窄体机',
    length: 39.47, fuselageRadius: 1.88, cylStart: -16.6, cylEnd: 16.6,
    noseGear: 13.2, mainGear: -1.7, gearTrack: 3.5,
    wingSpan: 35.8, wingRootX: 0.8, wingLeadingY: -0.7, wingTrailingY: 1.7, wingTipX: -4.0,
    engineCount: 2, engineX: 1.7, engineY: 1.25, engineZ: 4.3, engineLen: 2.6, engineR: 0.85,
    livery: 0x1b3a6b, stripe: 0x8ec3e8,
    doors: doors([['L1', 15.3, 2.05, '前左舱门 L1'], ['L2', -15.8, 2.05, '后左舱门 L2']]),
  },
  B77W: {
    id: 'B77W', label: '波音 777-300ER', group: '宽体机',
    length: 73.86, fuselageRadius: 3.1, cylStart: -31.0, cylEnd: 31.0,
    noseGear: 25.0, mainGear: -7.5, gearTrack: 6.5,
    wingSpan: 64.8, wingRootX: 3.0, wingLeadingY: -2.2, wingTrailingY: 4.2, wingTipX: -9.0,
    engineCount: 2, engineX: 3.2, engineY: 2.25, engineZ: 9.2, engineLen: 5.0, engineR: 1.55,
    livery: 0xf4f5f7, stripe: 0x2c5aa0,
    doors: doors([['L1', 29.6, 2.55, '前左舱门 L1'], ['L2', 12.0, 2.55, '二号舱门 L2'], ['L3', -12.0, 2.55, '三号舱门 L3']]),
  },
  A388: {
    id: 'A388', label: '空客 A380-800', group: '超大型',
    length: 72.72, fuselageRadius: 3.5, cylStart: -30.0, cylEnd: 30.0,
    noseGear: 24.0, mainGear: -9.0, gearTrack: 9.0,
    wingSpan: 79.8, wingRootX: 4.0, wingLeadingY: -2.6, wingTrailingY: 5.0, wingTipX: -10.0,
    engineCount: 4, engineX: 4.5, engineY: 2.3, engineZ: [8.5, 14.5], engineLen: 4.3, engineR: 1.35,
    doubleDeck: true,
    livery: 0x2a4d8f, stripe: 0x6fd3e8,
    doors: doors([
      ['L1U', 28.0, 5.0, '上层前舱门 U-L1'],
      ['L1', 28.0, 2.55, '主层前舱门 M-L1'],
      ['L2', 10.0, 2.55, '主层二号舱门 M-L2'],
    ]),
  },
};

// 标准停机线：廊桥对接点（门）目标世界位置
export const STAND = {
  nominalDoor: { x: 0, y: null, z: -7 },  // 标称时前舱门对齐此处
  bounds: { xMin: -30, xMax: 30, zMin: -4, zMax: -12 },
};

export const STEP = 0.5; // 碰撞采样步长（米）
