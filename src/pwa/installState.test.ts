import test from "node:test";
import assert from "node:assert/strict";
import {
  detectIsIOS,
  detectPlatformFamily,
  getInstallGuideContent,
  resolveInstallMode,
} from "./installState.ts";

test("detectIsIOS identifies iPhone, iPad, and touch-capable iPadOS desktop UA", () => {
  assert.equal(detectIsIOS("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"), true);
  assert.equal(detectIsIOS("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5), true);
  assert.equal(detectIsIOS("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0), false);
});

test("detectPlatformFamily classifies desktop and mobile platforms", () => {
  assert.equal(detectPlatformFamily("Mozilla/5.0 (Linux; Android 14; Pixel 8)"), "android");
  assert.equal(detectPlatformFamily("Mozilla/5.0 (Windows NT 10.0; Win64; x64)"), "windows");
  assert.equal(detectPlatformFamily("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)"), "mac");
});

test("resolveInstallMode prioritizes installed -> native-prompt -> ios -> embedded -> browser menu", () => {
  assert.equal(
    resolveInstallMode({ isStandalone: true, hasNativePrompt: true, isIOS: true, isEmbedded: true }),
    "installed",
  );
  assert.equal(
    resolveInstallMode({ isStandalone: false, hasNativePrompt: true, isIOS: false, isEmbedded: false }),
    "native-prompt",
  );
  assert.equal(
    resolveInstallMode({ isStandalone: false, hasNativePrompt: false, isIOS: true, isEmbedded: false }),
    "ios-safari",
  );
  assert.equal(
    resolveInstallMode({ isStandalone: false, hasNativePrompt: false, isIOS: false, isEmbedded: true }),
    "embedded-tab",
  );
  assert.equal(
    resolveInstallMode({ isStandalone: false, hasNativePrompt: false, isIOS: false, isEmbedded: false }),
    "browser-menu",
  );
});

test("getInstallGuideContent returns tailored platform instructions", () => {
  const ios = getInstallGuideContent("ios-safari", "ios");
  assert.match(ios.title, /iPhone|iPad/i);
  assert.ok(ios.steps.some((step) => /Add to Home Screen/i.test(step)));

  const mac = getInstallGuideContent("browser-menu", "mac");
  assert.ok(mac.steps.some((step) => /Add to Dock/i.test(step)));
});
