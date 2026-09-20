import * as THREE from 'three';
import { AIRCRAFT_TYPES, BRIDGE, STAND } from '../config.js';
import { Aircraft } from '../entities/aircraft.js';
import { JetBridge } from '../entities/bridge.js';
import { Apron } from '../entities/apron.js';
import { GroundVehicles } from '../entities/vehicles.js';
import { solveBridge, bridgePath } from './kinematics.js';
import { clamp } from './math.js';

export const State = {
  NO_PLANE: 'NO_PLANE',
  ARRIVING: 'ARRIVING',
  PARKED: 'PARKED',
  SOLVING: 'SOLVING',
  INVALID: 'INVALID',
  MOVING: 'MOVING',
  DOCKED: 'DOCKED',
  RETRACTING: 'RETRACTING',
  SWAPPING: 'SWAPPING',
};

export class Simulator {
  constructor(scene, ui) {
    this.scene = scene;
    this.ui = ui;
    this.state = State.NO_PLANE;
    this.typeId = 'A320';
    this.shift = { x: 0, z: 0, heading: 0 };
    this.autoDock = true;
    this.recomputeTimer = null;

    this.aircraft = null;
    this.bridge = new JetBridge();
    this.apron = new Apron();
    this.vehicles = new GroundVehicles();
    scene.add(this.apron.group);
    scene.add(this.bridge.group);
    scene.add(this.vehicles.group);

    // 碰撞警示标记
    this.alertMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xff0000, emissiveIntensity: 1.2 })
    );
    this.alertMarker.visible = false;
    scene.add(this.alertMarker);
    // 失败时的尝试路径（红色虚线）
    this.tryLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineDashedMaterial({ color: 0xff3b30, dashSize: 0.7, gapSize: 0.45, linewidth: 2 })
    );
    this.tryLine.visible = false;
    scene.add(this.tryLine);
    // 目标点标记
    this.targetMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 12, 8),
      new THREE.MeshStandardMaterial({ color: 0x35d07f, emissive: 0x1a8f4e, emissiveIntensity: 1 })
    );
    this.targetMarker.visible = false;
    scene.add(this.targetMarker);

    this.parkCfg = this.parkedBridgeCfg();
    this.bridge.update(this.parkCfg);
  }

  // 标称锚定：选定前舱门对齐 STAND.nominalDoor
  nominalPose(typeId, doorId) {
    const t = AIRCRAFT_TYPES[typeId];
    const d = t.doors.find(x => x.id === doorId) || t.doors[0];
    return { x: STAND.nominalDoor.x - d.x, z: STAND.nominalDoor.z + t.fuselageRadius, headingDeg: 0 };
  }

  currentPose() {
    const base = this.nominalPose(this.typeId, this.preferredDoorId());
    return {
      x: base.x + this.shift.x,
      z: base.z + this.shift.z,
      headingDeg: this.shift.heading,
    };
  }

  preferredDoorId() {
    if (this.aircraft) return this.aircraft.door.id;
    return AIRCRAFT_TYPES[this.typeId].doors[0].id;
  }

  parkedBridgeCfg() {
    return { yaw: BRIDGE.yaw.park, pivotH: BRIDGE.pivotH.park, length: BRIDGE.tunnel.parked, pitch: 0, cabinYaw: 0, door: null };
  }

  // ========== 状态切换动作 ==========
  arrival() {
    if (this.state === State.ARRIVING || this.state === State.MOVING) return;
    if (this.aircraft) this.scene.remove(this.aircraft.object);
    this.aircraft = new Aircraft(this.typeId, { x: 0, z: 70, headingDeg: 0 });
    this.aircraft.setDoor(this.pendingDoorId || this.aircraft.door.id);
    this.pendingDoorId = null;
    this.scene.add(this.aircraft.object);
    this.state = State.ARRIVING;
    this.anim = { kind: 'arrival', from: this.aircraft.pose, to: this.currentPose(), t: 0, dur: 4.5 };
    this.alertMarker.visible = false;
    this.tryLine.visible = false;
    this.bridge.setAlert(false);
    this.ui.renderState(this);
  }

  requestDock() {
    if (this.state !== State.PARKED && this.state !== State.INVALID && this.state !== State.DOCKED) return;
    if (this.state === State.DOCKED) return;
    this.startSolving(true);
  }

  retract() {
    if (this.state === State.NO_PLANE || this.state === State.ARRIVING || this.state === State.RETRACTING) return;
    if (this.state === State.MOVING) {
      this.anim.cancel = true;
    }
    this.state = State.RETRACTING;
    this.anim = { kind: 'retract', from: this.liveCfg(), to: this.parkedBridgeCfg(), t: 0, dur: 3.5 };
    this.alertMarker.visible = false;
    this.tryLine.visible = false;
    this.bridge.setAlert(false);
    this.ui.renderState(this);
  }

  // 机型 / 舱门 / 位置参数变化（来自 UI）
  onParamsChanged({ typeChanged, doorChanged, doorId } = {}) {
    clearTimeout(this.recomputeTimer);
    if (this.state === State.SWAPPING || this.state === State.ARRIVING) return;
    if (!this.aircraft || this.state === State.NO_PLANE) return;
    if (doorId) this.pendingDoorId = doorId;

    const doApply = () => {
      if (typeChanged) {
        // 换机型：廊桥先撤回 → 新机滑入 → 自动重新解算
        if (this.anim) this.anim = null;
        this.state = State.SWAPPING;
        this.anim = { kind: 'swapRetract', from: this.liveCfg(), to: this.parkedBridgeCfg(), t: 0, dur: 1.4 };
        this.scene.remove(this.aircraft.object);
        this.aircraft = null;
        this.targetMarker.visible = false;
        this.alertMarker.visible = false;
        this.tryLine.visible = false;
        this.bridge.setAlert(false);
        this.ui.renderState(this);
        return;
      }

      if (doorChanged) this.aircraft.setDoor(doorId || this.preferredDoorId());
      if (this.anim && (this.anim.kind === 'dock' || this.anim.kind === 'retract')) this.anim = null;

      // 飞机位置/朝向直接更新（停位微调）
      this.aircraft.setPose(this.currentPose());
      this.apron.updateSafety(this.aircraft);

      if (this.autoDock) this.startSolving(false);
      else { this.state = State.PARKED; this.ui.renderState(this); }
    };

    this.recomputeTimer = setTimeout(doApply, 200);
  }

  startSolving(userInitiated) {
    if (!this.aircraft) return;
    this.state = State.SOLVING;
    this.ui.renderState(this);
    // 解算是确定性的，短暂延迟仅用于状态展示
    setTimeout(() => {
      if (this.state !== State.SOLVING) return;
      const res = solveBridge(this.aircraft);
      this.solution = res;
      if (!res.ok) {
        this.state = State.INVALID;
        this.bridge.setAlert(true);
        if (res.point) {
          this.alertMarker.position.set(res.point.x, res.point.y, res.point.z);
          this.alertMarker.visible = true;
        }
        if (res.code === 'COLLISION' && res.attempted) {
          const path = bridgePath(res.attempted);
          const pts = [
            new THREE.Vector3(path.rootWorld.x, path.rootWorld.y, path.rootWorld.z),
            new THREE.Vector3(path.cabBase.x, path.cabBase.y, path.cabBase.z),
            new THREE.Vector3(res.point.x, res.point.y, res.point.z),
          ];
          this.tryLine.geometry.dispose();
          this.tryLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
          this.tryLine.computeLineDistances();
          this.tryLine.visible = true;
        } else {
          this.tryLine.visible = false;
        }
        this.targetMarker.visible = false;
        this.ui.renderState(this, res);
        return;
      }
      this.alertMarker.visible = false;
      this.tryLine.visible = false;
      this.bridge.setAlert(false);
      this.targetMarker.position.set(res.cfg.door.x, res.cfg.door.y, res.cfg.door.z);
      this.targetMarker.visible = true;

      this.state = State.MOVING;
      const from = this.liveCfg();
      this.anim = {
        kind: 'dock', from, to: res.cfg, t: 0,
        dur: this.estimateDuration(from, res.cfg), userInitiated,
      };
      this.ui.renderState(this);
    }, 280);
  }

  estimateDuration(a, b) {
    const S = BRIDGE.speeds;
    const tYaw = Math.abs(a.yaw - b.yaw) / S.yaw;
    const tLen = Math.abs(a.length - b.length) / S.length;
    const tH = Math.abs(a.pivotH - b.pivotH) / S.height;
    const tP = Math.abs(a.pitch - b.pitch) / S.pitch;
    return clamp(Math.max(tYaw, tLen, tH, tP) + 0.6, 1.4, 7);
  }

  liveCfg() {
    return this.bridge.cfg;
  }

  // ========== 每帧推进 ==========
  update(dt, elapsed) {
    this.vehicles.update(elapsed);
    if (this.aircraft) this.apron.updateSafety(this.aircraft);

    if (this.anim) {
      const a = this.anim;
      a.t += dt / a.dur;
      const k = a.t >= 1 ? 1 : 1 - Math.pow(1 - a.t, 3);
      if (a.cancel) {
        this.anim = null;
        this.state = State.PARKED;
        this.ui.renderState(this);
        return;
      }
      if (a.kind === 'arrival') {
        const p = {
          x: THREE.MathUtils.lerp(a.from.x, a.to.x, k),
          z: THREE.MathUtils.lerp(a.from.z, a.to.z, k),
          headingDeg: THREE.MathUtils.lerp(a.from.headingDeg, a.to.headingDeg, k),
        };
        this.aircraft.setPose(p);
        this.apron.updateSafety(this.aircraft);
        if (k === 1) {
          this.anim = null;
          this.state = State.PARKED;
          if (this.autoDock) this.startSolving(false);
          else this.ui.renderState(this);
        }
      } else if (a.kind === 'dock') {
        const cfg = lerpCfg(a.from, a.to, k);
        this.bridge.update(cfg);
        this.ui.renderProgress(a.t);
        if (k === 1) {
          this.anim = null;
          this.state = State.DOCKED;
          this.ui.renderState(this);
        }
      } else if (a.kind === 'retract' || a.kind === 'swapRetract') {
        this.bridge.update(lerpCfg(a.from, a.to, k));
        if (k === 1) {
          this.anim = null;
          if (a.kind === 'swapRetract') {
            this.state = State.NO_PLANE;
            this.arrival();
          } else {
            this.state = this.aircraft ? State.PARKED : State.NO_PLANE;
            this.ui.renderState(this);
          }
        }
      }
    }

    if (this.bridgeAnim) {
      const a = this.bridgeAnim;
      a.t += dt / a.dur;
      const k = a.t >= 1 ? 1 : 1 - Math.pow(1 - a.t, 3);
      this.bridge.update(lerpCfg(a.from, a.to, k));
      if (k === 1) this.bridgeAnim = null;
    }

    // 警示灯/标记闪烁
    const blink = (Math.sin(elapsed * 6) + 1) / 2;
    if (this.state === State.INVALID) {
      this.alertMarker.scale.setScalar(0.8 + blink * 0.5);
      this.beaconPulse = blink;
    }
  }
}

function lerpCfg(a, b, t) {
  return {
    yaw: THREE.MathUtils.lerp(a.yaw, b.yaw, t),
    pivotH: THREE.MathUtils.lerp(a.pivotH, b.pivotH, t),
    length: THREE.MathUtils.lerp(a.length, b.length, t),
    pitch: THREE.MathUtils.lerp(a.pitch, b.pitch, t),
    cabinYaw: THREE.MathUtils.lerp(a.cabinYaw, b.cabinYaw, t),
    door: b.door || a.door,
  };
}
