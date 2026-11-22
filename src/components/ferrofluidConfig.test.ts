import test from "node:test";
import assert from "node:assert/strict";
import { computeFerrofluidBudget, detectSoftwareRenderer } from "./ferrofluidConfig.ts";

test("detectSoftwareRenderer identifies CPU WebGL implementations", () => {
  assert.equal(detectSoftwareRenderer("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)))"), true);
  assert.equal(detectSoftwareRenderer("llvmpipe (LLVM 15.0.7, 256 bits)"), true);
  assert.equal(detectSoftwareRenderer("ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro)"), false);
  assert.equal(detectSoftwareRenderer(null), false);
});

test("computeFerrofluidBudget throttles DPR and FPS on software WebGL", () => {
  const budget = computeFerrofluidBudget({
    requestedDpr: 1.5,
    devicePixelRatio: 2,
    requestedFps: 36,
    isSoftware: true,
  });
  assert.equal(budget.dpr, 0.25);
  assert.equal(budget.fps, 8);
});

test("computeFerrofluidBudget preserves clamped hardware settings", () => {
  const budget = computeFerrofluidBudget({
    requestedDpr: 1,
    devicePixelRatio: 2,
    requestedFps: 36,
    isSoftware: false,
  });
  assert.equal(budget.dpr, 1);
  assert.equal(budget.fps, 36);
});
