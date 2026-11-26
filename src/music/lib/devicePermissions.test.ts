import test from "node:test";
import assert from "node:assert/strict";
import {
  countGrantedDevicePermissions,
  isAudioAbortError,
  shouldHoldWakeLock,
  type DevicePermissionsSnapshot,
} from "./devicePermissions";

test("isAudioAbortError only matches DOMException AbortError", () => {
  assert.equal(isAudioAbortError(new DOMException("Interrupted", "AbortError")), true);
  assert.equal(isAudioAbortError(new DOMException("Blocked", "NotAllowedError")), false);
  assert.equal(isAudioAbortError(new Error("AbortError")), false);
  assert.equal(isAudioAbortError(null), false);
});

test("shouldHoldWakeLock requires both active playback and user enablement", () => {
  assert.equal(shouldHoldWakeLock(true, true), true);
  assert.equal(shouldHoldWakeLock(true, false), false);
  assert.equal(shouldHoldWakeLock(false, true), false);
  assert.equal(shouldHoldWakeLock(false, false), false);
});

test("countGrantedDevicePermissions tallies supported and granted device capabilities", () => {
  const snapshot: DevicePermissionsSnapshot = {
    audioSession: "playback",
    mediaSession: "active",
    persistentStorage: "granted",
    notifications: "prompt",
    wakeLockSupported: true,
    wakeLockEnabled: true,
    wakeLockActive: false,
    keepAliveActive: true,
  };
  assert.deepEqual(countGrantedDevicePermissions(snapshot), { granted: 4, total: 5 });

  const minimal: DevicePermissionsSnapshot = {
    audioSession: "unsupported",
    mediaSession: "active",
    persistentStorage: "unsupported",
    notifications: "denied",
    wakeLockSupported: false,
    wakeLockEnabled: false,
    wakeLockActive: false,
    keepAliveActive: false,
  };
  assert.deepEqual(countGrantedDevicePermissions(minimal), { granted: 1, total: 2 });
});
