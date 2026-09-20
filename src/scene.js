import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  AIRCRAFT_MODELS,
  BRIDGE_LIMITS,
  DEFAULT_AIRCRAFT,
  getDoorPosition,
  getModel,
  solveJetBridge,
} from "./kinematics.js";

const HOME_BRIDGE = {
  yaw: 0,
  pitch: 0,
  horizontalReach: 10,
  cabHeight: BRIDGE_LIMITS.pivot.y,
};

const PHASE_LABELS = {
  IDLE: "待机",
  PARKING: "飞机正在滑入停机位",
  PARKED: "飞机已停稳",
  RETRACTING: "廊桥正在收回",
  ROTATING: "廊桥正在旋转对准舱门",
  ADJUSTING_HEIGHT: "廊桥正在调节高度",
  TELESCOPING: "廊桥正在伸缩",
  DOCKED: "对接完成",
  BLOCKED: "对接停止：存在危险或超出范围",
  STOPPED: "已急停",
};

export function createAirportScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fc7e6);
  scene.fog = new THREE.Fog(0x9fc7e6, 90, 180);

  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 300);
  camera.position.set(-12, 24, 26);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(4, 2.8, 4);
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 18;
  controls.maxDistance = 110;

  addLights(scene);
  scene.add(createApron());
  scene.add(createTerminal());

  const targetMarker = createTargetMarker();
  scene.add(targetMarker);
  const safetyEnvelope = createSafetyEnvelope();
  scene.add(safetyEnvelope);

  const aircraft = { group: null, model: getModel(DEFAULT_AIRCRAFT.modelId), config: { ...DEFAULT_AIRCRAFT } };
  let aircraftMesh = createAircraft(aircraft.model);
  aircraft.group = aircraftMesh;
  aircraft.group.position.set(aircraft.config.x, 0, aircraft.config.z + 36);
  scene.add(aircraft.group);

  const bridge = createJetBridge();
  scene.add(bridge.group);

  const vehicles = createVehicles();
  vehicles.forEach((vehicle) => scene.add(vehicle.group));

  let desiredAircraft = { ...DEFAULT_AIRCRAFT };
  let displayedAircraft = { ...DEFAULT_AIRCRAFT };
  let bridgePose = { ...HOME_BRIDGE };
  let phase = "IDLE";
  let statusText = PHASE_LABELS.IDLE;
  let operationId = 0;
  let autoMode = true;
  let listeners = [];

  setBridgePose(bridge, HOME_BRIDGE);

  function notify() {
    listeners.forEach((listener) => listener(getState()));
  }

  function getState() {
    return {
      phase,
      statusText,
      autoMode,
      aircraft: { ...desiredAircraft },
      parkedAircraft: { ...displayedAircraft },
      model: aircraft.model,
      models: AIRCRAFT_MODELS,
      solution: solveJetBridge(displayedAircraft, aircraft.model),
      bridgePose: { ...bridgePose },
    };
  }

  async function scheduleOperation(createNextOperation) {
    const currentId = ++operationId;
    try {
      await createNextOperation(currentId);
    } catch (error) {
      if (error.message !== "CANCELLED" && currentId === operationId) {
        phase = "STOPPED";
        statusText = PHASE_LABELS.STOPPED;
        notify();
      }
    }
  }

  async function waitFrame() {
    await new Promise((resolve) => setTimeout(resolve, 16));
  }

  function smoothStep(t) {
    return t * t * (3 - 2 * t);
  }

  async function moveToPose(currentId, nextPose, duration, posePhase) {
    const previous = { ...bridgePose };
    const startTime = performance.now();
    phase = posePhase;
    statusText = PHASE_LABELS[posePhase];
    notify();

    while (performance.now() - startTime < duration) {
      await waitFrame();
      if (currentId !== operationId) throw new Error("CANCELLED");
      const t = smoothStep(Math.min(1, (performance.now() - startTime) / duration));
      bridgePose = interpolatePose(previous, nextPose, t);
      setBridgePose(bridge, bridgePose);
    }

    bridgePose = { ...nextPose };
    setBridgePose(bridge, bridgePose);
  }

  async function retractBridge(currentId) {
    await moveToPose(currentId, HOME_BRIDGE, 1700, "RETRACTING");
  }

  async function parkAircraft(currentId) {
    phase = "PARKING";
    statusText = PHASE_LABELS.PARKING;
    notify();

    const from = aircraft.group.position.clone();
    const to = new THREE.Vector3(desiredAircraft.x, 0, desiredAircraft.z);
    const duration = Math.max(1200, Math.abs(to.z - from.z) * 70 + Math.abs(to.x - from.x) * 80);
    const startTime = performance.now();

    while (performance.now() - startTime < duration) {
      await waitFrame();
      if (currentId !== operationId) throw new Error("CANCELLED");
      const t = smoothStep(Math.min(1, (performance.now() - startTime) / duration));
      aircraft.group.position.lerpVectors(from, to, t);
    }

    aircraft.group.position.copy(to);
    displayedAircraft = { ...desiredAircraft };
    safetyEnvelope.position.set(displayedAircraft.x, 0, displayedAircraft.z);
    phase = "PARKED";
    statusText = PHASE_LABELS.PARKED;
    updateMarker();
    notify();

    if (autoMode) await dock(currentId);
  }

  async function dock(currentId) {
    const solution = solveJetBridge(displayedAircraft, aircraft.model);
    updateMarker();

    if (!solution.ok) {
      phase = "BLOCKED";
      statusText = solution.errors[0].message;
      notify();
      return;
    }

    const targetPose = {
      yaw: solution.yaw,
      pitch: solution.pitch,
      horizontalReach: solution.horizontalReach,
      cabHeight: solution.target.y,
    };

    await moveToPose(
      currentId,
      { ...bridgePose, yaw: targetPose.yaw },
      1300,
      "ROTATING",
    );
    if (currentId !== operationId) return;

    const heightReach = BRIDGE_LIMITS.minReach +
      Math.max(0, targetPose.horizontalReach - BRIDGE_LIMITS.minReach) * 0.22;
    await moveToPose(
      currentId,
      {
        yaw: targetPose.yaw,
        horizontalReach: heightReach,
        pitch: Math.atan2(BRIDGE_LIMITS.pivot.y - targetPose.cabHeight, heightReach),
        cabHeight: targetPose.cabHeight,
      },
      1400,
      "ADJUSTING_HEIGHT",
    );
    if (currentId !== operationId) return;

    await moveToPose(currentId, targetPose, 1900, "TELESCOPING");
    if (currentId !== operationId) throw new Error("CANCELLED");

    phase = "DOCKED";
    statusText = PHASE_LABELS.DOCKED;
    notify();
  }

  function rebuildAircraftForConfigChange() {
    const newModel = getModel(desiredAircraft.modelId);
    scene.remove(aircraft.group);
    disposeObject(aircraft.group);
    aircraft.model = newModel;
    aircraft.group = createAircraft(newModel);
    aircraft.group.position.set(displayedAircraft.x, 0, displayedAircraft.z + 36);
    scene.add(aircraft.group);
  }

  async function changeConfig(nextConfig) {
    const wasDocked =
      phase === "ROTATING" ||
      phase === "ADJUSTING_HEIGHT" ||
      phase === "TELESCOPING" ||
      phase === "DOCKED" ||
      phase === "BLOCKED";
    desiredAircraft = { ...desiredAircraft, ...nextConfig };
    const currentId = ++operationId;
    notify();

    if (wasDocked) await retractBridge(currentId);
    if (currentId !== operationId) return;

    rebuildAircraftForConfigChange();
    await parkAircraft(currentId);
  }

  async function manualDock() {
    if (phase === "PARKING" || phase === "RETRACTING" || phase === "ROTATING" || phase === "ADJUSTING_HEIGHT" || phase === "TELESCOPING") return;
    desiredAircraft = { ...displayedAircraft, modelId: aircraft.model.id };
    await scheduleOperation(async (id) => dock(id));
  }

  async function manualRetract() {
    await scheduleOperation(async (id) => {
      await retractBridge(id);
      phase = "PARKED";
      statusText = PHASE_LABELS.PARKED;
      notify();
    });
  }

  function emergencyStop() {
    operationId += 1;
    phase = "STOPPED";
    statusText = PHASE_LABELS.STOPPED;
    notify();
  }

  function setAutoMode(value) {
    autoMode = value;
    notify();
    if (autoMode && phase === "PARKED") manualDock();
  }

  function updateMarker() {
    const door = getDoorPosition(displayedAircraft, aircraft.model);
    targetMarker.position.copy(door);
    targetMarker.visible = phase === "PARKED" || phase === "BLOCKED" || phase === "DOCKED";
    const blocked = !solveJetBridge(displayedAircraft, aircraft.model).ok;
    safetyEnvelope.material.color.set(blocked ? 0xef4444 : 0x22c55e);
    safetyEnvelope.material.opacity = phase === "PARKING" ? 0.08 : blocked ? 0.22 : 0.13;
  }

  function render(clock) {
    const elapsed = clock.getElapsedTime();
    const vehiclesHeld = phase === "PARKING" ||
      phase === "ROTATING" ||
      phase === "ADJUSTING_HEIGHT" ||
      phase === "TELESCOPING" ||
      phase === "DOCKED";

    vehicles.forEach((vehicle) => {
      const progress = vehiclesHeld
        ? vehicle.offset
        : (elapsed * vehicle.speed + vehicle.offset) % 1;
      const point = vehicle.path.getPointAt(progress);
      vehicle.group.position.copy(point);
      const ahead = vehicle.path.getPointAt((progress + 0.005) % 1);
      vehicle.group.lookAt(ahead.x, 0, ahead.z);
      const beacon = vehicle.group.children.find((child) => child.isMesh && child.geometry?.type === "SphereGeometry");
      if (beacon && vehiclesHeld) {
        beacon.scale.setScalar(1 + Math.sin(elapsed * 10) * 0.25);
      }
    });
    targetMarker.material.opacity = 0.45 + Math.sin(elapsed * 5) * 0.2;
    controls.update();
    renderer.render(scene, camera);
  }

  function resize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (renderer.getSize(new THREE.Vector2()).x !== width || renderer.getSize(new THREE.Vector2()).y !== height) {
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
  }

  updateMarker();
  safetyEnvelope.position.set(displayedAircraft.x, 0, displayedAircraft.z);
  scheduleOperation(parkAircraft);

  return {
    subscribe(listener) {
      listeners.push(listener);
      listener(getState());
      return () => {
        listeners = listeners.filter((item) => item !== listener);
      };
    },
    changeConfig,
    manualDock,
    manualRetract,
    emergencyStop,
    setAutoMode,
    resize,
    render,
  };
}

function interpolatePose(a, b, t) {
  return {
    yaw: THREE.MathUtils.lerp(a.yaw, b.yaw, t),
    pitch: THREE.MathUtils.lerp(a.pitch, b.pitch, t),
    horizontalReach: THREE.MathUtils.lerp(a.horizontalReach, b.horizontalReach, t),
    cabHeight: THREE.MathUtils.lerp(a.cabHeight, b.cabHeight, t),
  };
}

function setBridgePose(bridge, pose) {
  bridge.rotor.rotation.y = pose.yaw;
  bridge.arm.rotation.x = pose.pitch;
  const reach = Math.max(pose.horizontalReach, 0.1);
  bridge.arm.position.set(0, 0, reach / 2);
  bridge.arm.scale.z = reach;
  const cabX = Math.sin(pose.yaw) * pose.horizontalReach;
  const cabZ = Math.cos(pose.yaw) * pose.horizontalReach;
  bridge.cab.position.set(cabX, pose.cabHeight - BRIDGE_LIMITS.pivot.y, cabZ);
  bridge.cab.rotation.y = pose.yaw;
}

function addLights(scene) {
  const hemi = new THREE.HemisphereLight(0xffffff, 0x66705f, 1.7);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(-30, 45, 28);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -70;
  sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70;
  sun.shadow.camera.bottom = -70;
  scene.add(sun);
}

function createApron() {
  const root = new THREE.Group();
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(150, 120),
    new THREE.MeshStandardMaterial({ color: 0x596167, roughness: 0.94 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  root.add(ground);

  addGroundPlane(root, 84, 44, 0, 9, 0x737b81, 0.32);
  addGroundLine(root, 0, 9, 76, 0.25, 0xf5d54d);
  addGroundLine(root, -39, 9, 0.22, 42, 0xf5d54d);
  addGroundLine(root, 39, 9, 0.22, 42, 0xf5d54d);
  addGroundLine(root, 0, -13, 80, 0.22, 0xf5d54d);
  addGroundLine(root, 0, 31, 80, 0.22, 0xf5d54d);

  for (let index = 0; index < 12; index += 1) {
    addGroundLine(root, -36 + index * 6.55, -13, 2.6, 0.38, index % 2 ? 0xffffff : 0xd53d3d, -0.55);
    addGroundLine(root, -36 + index * 6.55, 31, 2.6, 0.38, index % 2 ? 0xffffff : 0xd53d3d, 0.55);
  }

  const labelTexture = createTextTexture("G21");
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(9, 4.5),
    new THREE.MeshBasicMaterial({ map: labelTexture, transparent: true }),
  );
  label.rotation.x = -Math.PI / 2;
  label.position.set(-16, 0.012, 24);
  root.add(label);

  for (let index = 0; index < 10; index += 1) {
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.65, 12),
      new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.6 }),
    );
    cone.position.set(index < 5 ? -42 : 42, 0.33, -8 + (index % 5) * 8.5);
    cone.castShadow = true;
    root.add(cone);
  }

  return root;
}

function addGroundPlane(parent, width, depth, x, z, color, opacity) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(x, 0.006, z);
  parent.add(mesh);
}

function addGroundLine(parent, x, z, width, depth, color, angle = 0) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshBasicMaterial({ color }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = angle;
  mesh.position.set(x, 0.014, z);
  parent.add(mesh);
}

function createTextTexture(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  context.fillStyle = "#f5d54d";
  context.font = "bold 150px Arial";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, 256, 128);
  return new THREE.CanvasTexture(canvas);
}

function createTerminal() {
  const root = new THREE.Group();
  const concrete = new THREE.MeshStandardMaterial({ color: 0xcbd5df, roughness: 0.8 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x75a7c7,
    roughness: 0.18,
    metalness: 0.15,
    transparent: true,
    opacity: 0.72,
  });

  const building = new THREE.Mesh(new THREE.BoxGeometry(112, 12, 10), concrete);
  building.position.set(0, 6, -35);
  building.castShadow = true;
  building.receiveShadow = true;
  root.add(building);

  const facade = new THREE.Mesh(new THREE.BoxGeometry(108, 6.8, 0.18), glass);
  facade.position.set(0, 5.3, -29.9);
  root.add(facade);

  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(116, 0.9, 12.5),
    new THREE.MeshStandardMaterial({ color: 0x8794a3 }),
  );
  roof.position.set(0, 12.4, -35);
  root.add(roof);

  const corridor = new THREE.Mesh(new THREE.BoxGeometry(5.4, 4.4, 17), concrete);
  corridor.position.set(0, 5.8, -23.5);
  corridor.castShadow = true;
  root.add(corridor);

  const rotunda = new THREE.Mesh(
    new THREE.CylinderGeometry(4.2, 4.2, 5.3, 32),
    new THREE.MeshStandardMaterial({ color: 0xb8c4d0, roughness: 0.65 }),
  );
  rotunda.position.set(0, 5.7, -15);
  rotunda.castShadow = true;
  root.add(rotunda);

  return root;
}

function createJetBridge() {
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x8ea3b8, roughness: 0.55, metalness: 0.18 });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x46586b, roughness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x4d7895, roughness: 0.25, transparent: true, opacity: 0.7 });

  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, BRIDGE_LIMITS.pivot.y, 20), metal);
  pedestal.position.set(0, BRIDGE_LIMITS.pivot.y / 2, 0);
  pedestal.castShadow = true;
  group.add(pedestal);

  const rotor = new THREE.Group();
  rotor.position.set(0, BRIDGE_LIMITS.pivot.y, 0);
  group.add(rotor);

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.8, 24), darkMetal);
  hub.castShadow = true;
  rotor.add(hub);

  const arm = new THREE.Group();
  rotor.add(arm);

  const fixedTunnel = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.35, 1), metal);
  fixedTunnel.castShadow = true;
  arm.add(fixedTunnel);

  const windowStrip = new THREE.Mesh(new THREE.BoxGeometry(2.64, 0.48, 1), glass);
  windowStrip.position.y = 0.35;
  arm.add(windowStrip);

  const floor = new THREE.Mesh(new THREE.BoxGeometry(2.75, 0.18, 1), darkMetal);
  floor.position.y = -1.05;
  arm.add(floor);

  const cab = new THREE.Group();
  const cabBody = new THREE.Mesh(
    new THREE.BoxGeometry(3.45, 2.75, 2.45),
    new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.48, metalness: 0.08 }),
  );
  cabBody.castShadow = true;
  cab.add(cabBody);

  const seal = new THREE.Mesh(
    new THREE.BoxGeometry(3.45, 2.65, 0.22),
    new THREE.MeshStandardMaterial({ color: 0x202936, roughness: 0.9 }),
  );
  seal.position.z = 1.26;
  cab.add(seal);

  const cabWindow = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.55, 0.12), glass);
  cabWindow.position.set(0, 0.35, 1.24);
  cab.add(cabWindow);

  const cabLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.2, 10), darkMetal);
  cabLeg.position.set(-1.15, -2.25, 0);
  cab.add(cabLeg);
  group.add(cab);

  return { group, rotor, arm, cab };
}

function createAircraft(model) {
  const root = new THREE.Group();
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: model.color,
    roughness: 0.42,
    metalness: 0.08,
  });
  const wingMaterial = new THREE.MeshStandardMaterial({ color: 0xd7dee8, roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x263241, roughness: 0.45 });
  const stripeMaterial = new THREE.MeshStandardMaterial({ color: model.stripe, roughness: 0.35 });

  const barrelLength = model.fuselageLength - model.radius * 2;
  const fuselage = new THREE.Mesh(
    new THREE.CylinderGeometry(model.radius, model.radius, barrelLength, 32),
    bodyMaterial,
  );
  fuselage.rotation.z = Math.PI / 2;
  fuselage.position.y = model.centerY;
  fuselage.castShadow = true;
  fuselage.receiveShadow = true;
  root.add(fuselage);

  const nose = new THREE.Mesh(new THREE.ConeGeometry(model.radius, model.radius * 2, 32), bodyMaterial);
  nose.rotation.z = -Math.PI / 2;
  nose.position.set(model.fuselageLength / 2, model.centerY, 0);
  nose.castShadow = true;
  root.add(nose);

  const tail = new THREE.Mesh(new THREE.ConeGeometry(model.radius, model.radius * 2, 32), bodyMaterial);
  tail.rotation.z = Math.PI / 2;
  tail.position.set(-model.fuselageLength / 2, model.centerY, 0);
  tail.castShadow = true;
  root.add(tail);

  for (const side of [-1, 1]) {
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(model.fuselageLength * 0.72, 0.18, 0.05),
      stripeMaterial,
    );
    stripe.position.set(1.5, model.centerY + 0.2, side * (model.radius + 0.025));
    root.add(stripe);

    const windowCount = Math.floor((barrelLength - 4) / 1.7);
    for (let index = 0; index < windowCount; index += 1) {
      const window = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.22, 0.04), dark);
      window.position.set(
        -barrelLength / 2 + 2.5 + index * 1.7,
        model.centerY + 0.48,
        side * (model.radius + 0.03),
      );
      root.add(window);
    }

    const wing = new THREE.Mesh(
      new THREE.BoxGeometry(model.wingChord, 0.22, model.wingSpan / 2),
      wingMaterial,
    );
    wing.position.set(-2.8, model.centerY - 0.25, side * model.wingSpan / 4);
    wing.rotation.y = side * 0.16;
    wing.castShadow = true;
    root.add(wing);

    const engine = new THREE.Mesh(
      new THREE.CylinderGeometry(model.radius * 0.34, model.radius * 0.38, 1.9, 20),
      new THREE.MeshStandardMaterial({ color: 0x8793a0, roughness: 0.35, metalness: 0.3 }),
    );
    engine.rotation.z = Math.PI / 2;
    engine.position.set(-3.2, model.centerY - 1.05, side * model.wingSpan * 0.22);
    engine.castShadow = true;
    root.add(engine);
  }

  const verticalTail = new THREE.Mesh(
    new THREE.BoxGeometry(0.38, model.radius * 2.8, model.radius * 2.4),
    wingMaterial,
  );
  verticalTail.position.set(-model.fuselageLength / 2 + model.radius * 2.1, model.centerY + model.radius * 1.25, 0);
  verticalTail.rotation.x = -0.18;
  verticalTail.castShadow = true;
  root.add(verticalTail);

  const horizontalTail = new THREE.Mesh(
    new THREE.BoxGeometry(model.wingChord * 0.42, 0.16, model.wingSpan * 0.28),
    wingMaterial,
  );
  horizontalTail.position.set(-model.fuselageLength / 2 + model.radius * 2.5, model.centerY + 0.2, 0);
  horizontalTail.castShadow = true;
  root.add(horizontalTail);

  const door = new THREE.Mesh(
    new THREE.PlaneGeometry(0.86, 1.55),
    new THREE.MeshBasicMaterial({ color: 0xffe08a, side: THREE.DoubleSide }),
  );
  door.position.set(model.doorOffsetX, model.doorY, -model.radius - 0.04);
  root.add(door);

  for (const x of [model.doorOffsetX + 0.8, -3.2]) {
    const strut = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.1, model.centerY - 0.35, 10),
      dark,
    );
    strut.position.set(x, (model.centerY - 0.35) / 2, 0);
    root.add(strut);

    for (const side of [-1, 1]) {
      const wheel = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), dark);
      wheel.scale.set(0.75, 1, 0.38);
      wheel.position.set(x, 0.32, side * 0.32);
      root.add(wheel);
    }
  }

  root.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });

  return root;
}

function createTargetMarker() {
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.72, 0.95, 32),
    new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  marker.rotation.y = Math.PI / 2;
  marker.visible = false;
  return marker;
}

function createSafetyEnvelope() {
  const envelope = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 44),
    new THREE.MeshBasicMaterial({
      color: 0x22c55e,
      transparent: true,
      opacity: 0.13,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  envelope.rotation.x = -Math.PI / 2;
  envelope.position.y = 0.018;
  return envelope;
}

function createVehicles() {
  return [
    { group: createServiceVehicle(0xfacc15, "GPU"), speed: 0.018, offset: 0, path: makeVehiclePath(0) },
    { group: createServiceVehicle(0xef4444, "FOAM"), speed: 0.012, offset: 0.38, path: makeVehiclePath(1) },
    { group: createServiceVehicle(0x38bdf8, "BUS"), speed: 0.015, offset: 0.72, path: makeVehiclePath(2) },
  ];
}

function makeVehiclePath(seed) {
  const offsetX = [-55, 52, 38][seed];
  const innerX = [-33, 31, 44][seed];
  return new THREE.CatmullRomCurve3(
    [
      new THREE.Vector3(offsetX, 0, 42),
      new THREE.Vector3(innerX, 0, 36),
      new THREE.Vector3(innerX, 0, 8),
      new THREE.Vector3(innerX * 0.55, 0, -24),
      new THREE.Vector3(-innerX * 0.55, 0, -25),
      new THREE.Vector3(-innerX, 0, 8),
      new THREE.Vector3(-innerX, 0, 36),
      new THREE.Vector3(-offsetX, 0, 42),
    ],
    true,
    "catmullrom",
    0.25,
  );
}

function createServiceVehicle(color, code) {
  const group = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.55 });
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.75, 4.5), paint);
  chassis.position.y = 0.72;
  chassis.castShadow = true;
  group.add(chassis);

  const cab = new THREE.Mesh(
    new THREE.BoxGeometry(2.15, 1.1, 1.55),
    new THREE.MeshStandardMaterial({ color: 0xe5edf5, roughness: 0.35 }),
  );
  cab.position.set(0, 1.28, 1.15);
  cab.castShadow = true;
  group.add(cab);

  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0xff8c00 }),
  );
  beacon.position.set(0, 1.95, 1.1);
  group.add(beacon);

  for (const x of [-1.24, 1.24]) {
    for (const z of [-1.45, 1.45]) {
      const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.32, 0.32, 0.22, 16),
        new THREE.MeshStandardMaterial({ color: 0x111827 }),
      );
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.34, z);
      group.add(wheel);
    }
  }

  const texture = createTextTexture(code);
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 0.7),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide }),
  );
  sign.position.set(0, 1.28, -2.27);
  sign.rotation.y = Math.PI;
  group.add(sign);

  return group;
}

function disposeObject(object) {
  const geometries = new Set();
  const materials = new Set();

  object.traverse((child) => {
    if (child.geometry) geometries.add(child.geometry);
    if (child.material) {
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => materials.add(material));
      } else {
        materials.add(child.material);
      }
    }
  });

  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => {
    Object.values(material).forEach((value) => {
      if (value && value.isTexture) value.dispose();
    });
    material.dispose();
  });
}
