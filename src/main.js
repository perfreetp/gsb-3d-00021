import * as THREE from 'three';
import { WorldScene } from './world/scene.js';
import { Simulator, State } from './sim/simulator.js';
import { AIRCRAFT_TYPES } from './config.js';

const container = document.getElementById('app');
const world = new WorldScene(container);

const $ = (id) => document.getElementById(id);
const ui = {
  setTitle(text, tone, msg, bad = false) {
    $('statusTitle').textContent = text;
    const lamp = $('lamp');
    lamp.className = 'lamp ' + (tone || 'info');
    $('statusMsg').textContent = msg || '';
    $('statusMsg').classList.toggle('bad', bad);
  },
  setKV(map) {
    const defs = [
      ['kvStage', 'stage'], ['kvYaw', 'yaw'], ['kvLen', 'len'], ['kvH', 'h'],
      ['kvPitch', 'pitch'], ['kvCab', 'cab'], ['kvDoor', 'door'],
    ];
    for (const [id, key] of defs) $(id).textContent = map[key] ?? '—';
  },
  showProgress(show) { $('progress').style.display = show ? 'block' : 'none'; },
  renderProgress(t) { $('progress').firstElementChild.style.width = `${Math.round(t * 100)}%`; },
  renderState(sim, res) {
    render(sim, res);
  },
};

const sim = new Simulator(world.scene, ui);

function fmt(v, unit = '', digits = 1) {
  if (v === null || v === undefined) return '—';
  return `${Number(v).toFixed(digits)}${unit}`;
}

function render(sim, res) {
  const S = State;
  const cfg = sim.bridge.cfg;
  let tone = 'info', title = '', msg = '', stage = '—';
  switch (sim.state) {
    case S.NO_PLANE:
      tone = 'info'; title = '待命中'; msg = '等待飞机入位。'; stage = '空闲'; break;
    case S.ARRIVING:
      tone = 'info'; title = '飞机入位中'; msg = '客机正在滑行至 B12 机位，请等待停稳。'; stage = '滑行入位'; break;
    case S.PARKED:
      tone = 'warn'; title = '已停稳 · 待对接';
      msg = sim.autoDock ? '正在重新解算廊桥姿态…' : '飞机已停稳，点击“自动对接”。';
      stage = '就绪'; break;
    case S.SOLVING:
      tone = 'info'; title = '解算中'; msg = '计算机翼净空、伸缩/旋转/高度包线并做碰撞检测…'; stage = '运动学解算'; break;
    case S.INVALID:
      tone = 'err'; title = '对接中止';
      msg = res?.message || '当前停靠不可对接。';
      stage = res?.stage || '校验失败'; break;
    case S.MOVING:
      tone = 'info'; title = '廊桥对接中';
      msg = '正在按解算姿态调整旋转角、伸缩长度与高度，实时运动限位生效。';
      stage = '桥体运动'; break;
    case S.DOCKED:
      tone = 'ok'; title = '对接完成';
      msg = `接机舱已贴合 ${sim.aircraft.type.label} ${sim.aircraft.door.label}，可以上下旅客。`;
      stage = '已对接'; break;
    case S.RETRACTING:
      tone = 'info'; title = '撤回中'; msg = '廊桥正收回至停泊位。'; stage = '撤回'; break;
    case S.SWAPPING:
      tone = 'info'; title = '更换机型中'; msg = '廊桥正在撤回，随后引导新型号客机入位…'; stage = '更换机型'; break;
  }
  ui.setTitle(title, tone, msg, sim.state === S.INVALID);

  const show = sim.state === S.MOVING || sim.state === S.RETRACTING;
  ui.showProgress(show);
  if (sim.state === S.MOVING && sim.solution?.cfg) ui.renderProgress(sim.anim?.t ?? 1);

  if (sim.state === S.INVALID) {
    const a = res?.attempted || cfg;
    ui.setKV({
      stage,
      yaw: fmt(a.yaw, '°'),
      len: fmt(a.length, ' m'),
      h: fmt(a.pivotH, ' m', 2),
      pitch: fmt(a.pitch, '°'),
      cab: fmt(a.cabinYaw, '°'),
      door: sim.aircraft ? doorStr(sim) : '—',
    });
    return;
  }

  ui.setKV({
    stage,
    yaw: cfg.yaw === 0 && cfg.pivotH === 4.15 && !sim.aircraft ? '—' : fmt(cfg.yaw, '°'),
    len: sim.aircraft ? fmt(cfg.length, ' m') : '—',
    h: sim.aircraft ? fmt(cfg.pivotH, ' m', 2) : '—',
    pitch: sim.aircraft ? fmt(cfg.pitch, '°') : '—',
    cab: sim.aircraft ? fmt(cfg.cabinYaw, '°') : '—',
    door: sim.aircraft ? doorStr(sim) : '—',
  });
}

function doorStr(sim) {
  const d = sim.aircraft.doorTarget();
  return `(${d.x.toFixed(1)}, ${d.y.toFixed(2)}, ${d.z.toFixed(1)})`;
}

// ============ UI 事件 ============
const typeSel = $('aircraftType');
const doorSel = $('doorSelect');

function refreshDoorOptions(keepId) {
  const t = AIRCRAFT_TYPES[typeSel.value];
  doorSel.innerHTML = '';
  for (const d of t.doors) {
    const o = document.createElement('option');
    o.value = d.id; o.textContent = d.label;
    doorSel.appendChild(o);
  }
  const prefer = keepId && t.doors.some(d => d.id === keepId) ? keepId : (t.doors.find(d => !d.id.endsWith('U')) || t.doors[0]).id;
  doorSel.value = prefer;
}
refreshDoorOptions();

typeSel.addEventListener('change', () => {
  sim.typeId = typeSel.value;
  const doors = AIRCRAFT_TYPES[typeSel.value].doors;
  const firstDoor = (doors.find(d => !d.id.endsWith('U')) || doors[0]).id;
  refreshDoorOptions(firstDoor);
  doorSel.value = firstDoor;
  sim.onParamsChanged({ typeChanged: true, doorId: firstDoor });
});
doorSel.addEventListener('change', () => {
  sim.typeId = typeSel.value;
  sim.onParamsChanged({ doorChanged: true, doorId: doorSel.value });
});

const bindRange = (id, key, valId, unit, digits) => {
  const el = $(id);
  el.addEventListener('input', () => {
    const v = parseFloat(el.value);
    sim.shift[key] = v;
    $(valId).textContent = v.toFixed(digits);
    if (sim.aircraft && sim.state !== State.ARRIVING) sim.onParamsChanged({});
  });
};
bindRange('xShift', 'x', 'xVal', 'm', 1);
bindRange('zShift', 'z', 'zVal', 'm', 1);
bindRange('heading', 'heading', 'hVal', '°', 0);

$('btnDock').addEventListener('click', () => { $('autoDock').checked = sim.autoDock = true; sim.requestDock(); });
$('btnRetract').addEventListener('click', () => sim.retract());
$('btnArrival').addEventListener('click', () => {
  clearTimeout(sim.recomputeTimer);
  $('autoDock').checked = sim.autoDock = true;
  sim.arrival();
});
$('btnReset').addEventListener('click', () => {
  clearTimeout(sim.recomputeTimer);
  if (sim.aircraft) { world.scene.remove(sim.aircraft.object); sim.aircraft = null; }
  sim.shift = { x: 0, z: 0, heading: 0 };
  $('xShift').value = 0; $('zShift').value = 0; $('heading').value = 0;
  $('xVal').textContent = '0.0'; $('zVal').textContent = '0.0'; $('hVal').textContent = '0';
  sim.alertMarker.visible = false; sim.targetMarker.visible = false; sim.tryLine.visible = false;
  sim.bridge.setAlert(false);
  sim.state = State.NO_PLANE; sim.anim = null;
  sim.bridge.update(sim.parkedBridgeCfg());
  render(sim);
});
$('autoDock').addEventListener('change', (e) => { sim.autoDock = e.target.checked; });

document.querySelectorAll('[data-view]').forEach(b =>
  b.addEventListener('click', () => world.setView(b.dataset.view)));

// ============ 主循环 ============
const clock = new THREE.Clock();
sim.arrival();
function loop() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;
  sim.update(dt, elapsed);
  world.updateViewTween(dt);
  world.render();
  requestAnimationFrame(loop);
}
loop();
