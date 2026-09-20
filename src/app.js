import { createAirportScene } from "./scene.js";
import * as THREE from "three";

const canvas = document.querySelector("#scene");
const airport = createAirportScene(canvas);
const clock = new THREE.Clock();
const elements = {
  statusBadge: document.querySelector("#status-badge"),
  statusText: document.querySelector("#status-text"),
  reasons: document.querySelector("#reasons"),
  yaw: document.querySelector("#metric-yaw"),
  reach: document.querySelector("#metric-reach"),
  height: document.querySelector("#metric-height"),
  slope: document.querySelector("#metric-slope"),
  clearance: document.querySelector("#metric-clearance"),
  model: document.querySelector("#model-select"),
  x: document.querySelector("#position-x"),
  z: document.querySelector("#position-z"),
  xValue: document.querySelector("#position-x-value"),
  zValue: document.querySelector("#position-z-value"),
  auto: document.querySelector("#auto-dock"),
  dock: document.querySelector("#dock-button"),
  retract: document.querySelector("#retract-button"),
  stop: document.querySelector("#stop-button"),
};

let debounceTimer = 0;

const initialParams = new URLSearchParams(window.location.search);
if (initialParams.has("model")) elements.model.value = initialParams.get("model");
if (initialParams.has("x")) elements.x.value = initialParams.get("x");
if (initialParams.has("z")) elements.z.value = initialParams.get("z");

airport.changeConfig({
  modelId: elements.model.value,
  x: Number(elements.x.value),
  z: Number(elements.z.value),
});

function scheduleConfigChange() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    airport.changeConfig({
      modelId: elements.model.value,
      x: Number(elements.x.value),
      z: Number(elements.z.value),
    });
  }, 220);
}

elements.model.addEventListener("change", scheduleConfigChange);
elements.x.addEventListener("input", scheduleConfigChange);
elements.z.addEventListener("input", scheduleConfigChange);
elements.auto.addEventListener("change", () => airport.setAutoMode(elements.auto.checked));
elements.dock.addEventListener("click", () => airport.manualDock());
elements.retract.addEventListener("click", () => airport.manualRetract());
elements.stop.addEventListener("click", () => airport.emergencyStop());

const badgeClass = {
  IDLE: "idle",
  PARKING: "active",
  PARKED: "ready",
  RETRACTING: "active",
  ROTATING: "active",
  ADJUSTING_HEIGHT: "active",
  TELESCOPING: "active",
  DOCKED: "safe",
  BLOCKED: "danger",
  STOPPED: "danger",
};

airport.subscribe((state) => {
  const badge = elements.statusBadge;
  badge.textContent = state.phase;
  badge.className = `badge ${badgeClass[state.phase] ?? "idle"}`;
  elements.statusText.textContent = state.statusText;

  if (state.solution.ok) {
    elements.reasons.innerHTML = state.phase === "DOCKED"
      ? "<li>密封罩已贴合舱门，安全区域封闭</li>"
      : "<li>规划路径未侵入机身安全轮廓，可以执行对接</li>";
  } else {
    elements.reasons.innerHTML = state.solution.errors
      .map((error) => `<li>${error.message}</li>`)
      .join("");
  }

  elements.yaw.textContent = `${state.solution.yawDeg.toFixed(1)}°`;
  elements.reach.textContent = `${state.solution.horizontalReach.toFixed(1)} m`;
  elements.height.textContent = `${state.solution.target.y.toFixed(1)} m`;
  elements.slope.textContent = `${state.solution.slopeDeg.toFixed(1)}°`;
  elements.clearance.textContent = `${state.solution.collision.mainClearance.toFixed(2)} m`;

  const clearance = state.solution.collision.mainClearance - state.model.radius - 1.05;
  elements.clearance.classList.toggle("danger-text", clearance < 0);
  elements.xValue.textContent = `${state.aircraft.x.toFixed(0)} m`;
  elements.zValue.textContent = `${state.aircraft.z.toFixed(0)} m`;
});

function frame() {
  airport.resize();
  airport.render(clock);
  requestAnimationFrame(frame);
}

frame();
