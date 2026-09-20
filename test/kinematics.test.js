import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AIRCRAFT_MODELS, getModel, solveJetBridge } from "../src/kinematics.js";

describe("jet bridge kinematics", () => {
  it("plans a valid A320 docking pose from the front door", () => {
    const model = getModel("a320");
    const result = solveJetBridge({ modelId: "a320", x: 0, z: 10 }, model);

    assert.equal(result.ok, true);
    assert.equal(result.errors.length, 0);
    assert.ok(result.yawDeg > 20 && result.yawDeg < 26);
    assert.ok(result.horizontalReach > 26 && result.horizontalReach < 27);
    assert.equal(Number(result.target.y.toFixed(1)), 3.6);
  });

  it("recomputes a different pose for another aircraft model", () => {
    const narrow = solveJetBridge({ modelId: "a320", x: 0, z: 10 }, getModel("a320"));
    const wide = solveJetBridge({ modelId: "b777", x: 0, z: 10 }, getModel("b777"));

    assert.equal(narrow.ok, true);
    assert.equal(wide.ok, true);
    assert.notEqual(narrow.yawDeg, wide.yawDeg);
    assert.notEqual(narrow.horizontalReach, wide.horizontalReach);
    assert.notEqual(narrow.target.y, wide.target.y);
  });

  it("stops when the bridge path intersects the fuselage safety envelope", () => {
    const result = solveJetBridge({ modelId: "a320", x: 12, z: 0 }, getModel("a320"));

    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.code === "FUSELAGE_COLLISION"));
  });

  it("stops when the aircraft crosses the terminal-side pivot", () => {
    const result = solveJetBridge({ modelId: "a320", x: 0, z: -20 }, getModel("a320"));

    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.code === "FUSELAGE_COLLISION"));
  });

  it("enforces telescopic reach limits", () => {
    const result = solveJetBridge({ modelId: "b777", x: 12, z: 10 }, getModel("b777"));

    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.code === "REACH_MAX"));
  });

  it("enforces slope and yaw limits", () => {
    const result = solveJetBridge({ modelId: "e175", x: 0, z: -20 }, getModel("e175"));

    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.code === "SLOPE_LIMIT"));
  });

  it("exposes all selectable aircraft models", () => {
    assert.deepEqual(
      AIRCRAFT_MODELS.map((model) => model.id),
      ["a320", "b737", "e175", "b777"],
    );
  });
});
