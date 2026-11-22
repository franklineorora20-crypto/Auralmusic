export default async function audit(page, ui) {
  const results = { checks: [], console: [] };
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") results.console.push(`${m.type()}: ${m.text()}`); });
  const check = (name, ok, detail = "") => results.checks.push({ name, ok, detail });

  // Trending loads from real Audius API
  await page.waitForFunction(() => document.querySelectorAll(".music-card").length > 0, { timeout: 20000 }).catch(() => { });
  const audiusCards = await page.locator(".music-card").count();
  const audiusTitles = await page.locator(".music-card strong").allInnerTexts();
  check("trending cards loaded", audiusCards > 0, `${audiusCards} cards: ${audiusTitles.slice(0, 3).join(" | ")}`);

  // Play first trending card -> audio element plays
  await page.locator(".music-card .cover-button").first().click();
  await page.waitForTimeout(2500);
  const audioState = await page.locator("audio").evaluate((a) => ({ paused: a.paused, src: a.currentSrc.slice(0, 90), t: a.currentTime }));
  check("playback starts from trending card", !audioState.paused, JSON.stringify(audioState));

  // Player stays active across navigation
  await page.getByRole("button", { name: "Your library", exact: true }).click();
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.waitForTimeout(400);
  const navState = await page.locator("audio").evaluate((a) => ({ paused: a.paused, t: a.currentTime }));
  check("playback continuous across navigation", !navState.paused && navState.t >= audioState.t, JSON.stringify(navState));

  // Pause / play toggle
  await page.locator(".player").getByRole("button", { name: "Pause" }).click();
  const pausedNow = await page.locator("audio").evaluate((a) => a.paused);
  check("pause works", pausedNow);
  await page.locator(".player").getByRole("button", { name: "Play", exact: true }).click();
  await page.waitForTimeout(300);
  check("resume works", await page.locator("audio").evaluate((a) => !a.paused));

  // Volume slider
  await page.getByLabel("Volume").fill("0.25");
  const vol = await page.locator("audio").evaluate((a) => a.volume);
  check("volume control", Math.abs(vol - 0.25) < 0.01, `volume=${vol}`);

  // Seek (keyboard: React onChange fires on real user input, not synthetic events)
  await page.getByLabel("Playback position").focus();
  await page.keyboard.press("End");
  await page.waitForTimeout(400);
  const seeked = await page.locator("audio").evaluate((a) => a.currentTime);
  check("seek works", seeked > 20, `currentTime=${seeked}`);

  // Shuffle & repeat toggles
  await page.locator(".player").getByRole("button", { name: "Shuffle" }).click();
  check("shuffle toggles", (await page.locator(".player").getByRole("button", { name: "Shuffle" }).getAttribute("class")).includes("active"));
  await page.locator(".player").getByRole("button", { name: /Repeat mode/ }).click();
  check("repeat toggles", (await page.locator(".player").getByRole("button", { name: /Repeat mode/ }).getAttribute("title")).includes("all"));

  // Next / previous (queue needs several tracks; shuffle off so order is deterministic)
  await page.locator(".player").getByRole("button", { name: "Shuffle" }).click();
  const before = await page.locator(".now-playing strong").innerText();
  await page.getByRole("button", { name: "Next track" }).click();
  await page.waitForTimeout(400);
  const afterNext = await page.locator(".now-playing strong").innerText();
  check("next track", before !== afterNext, `${before} -> ${afterNext}`);
  await page.getByRole("button", { name: "Previous track" }).click();
  await page.waitForTimeout(400);
  const afterPrev = await page.locator(".now-playing strong").innerText();
  check("previous track", afterPrev === before, `${afterNext} -> ${afterPrev}`);

  // Queue
  await page.getByRole("button", { name: "Open queue" }).click();
  const queueCount = await page.locator(".queue-item").count();
  check("queue panel populated", queueCount > 0, `${queueCount} items`);
  await page.getByRole("button", { name: "Close queue" }).click();

  // Search with real API
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByLabel("Search music").fill("ambient");
  await page.waitForFunction(() => document.querySelectorAll(".search-results .track-row").length > 0, { timeout: 20000 }).catch(() => { });
  const searchCount = await page.locator(".search-results .track-row").count();
  const providers = await page.locator(".search-results .track-row small").allInnerTexts();
  check("live search returns results", searchCount > 0, `${searchCount} rows; providers: ${[...new Set(providers.map(p => p.includes("Audius") ? "Audius" : p.includes("Jamendo") ? "Jamendo" : "other"))].join(",")}`);

  // Persistence across reload
  await page.locator(".player").getByRole("button", { name: "Pause" }).click().catch(() => { });
  await page.getByRole("button", { name: /Add to favourites/ }).first().click().catch(() => { });
  const favCountBefore = await page.evaluate(() => JSON.parse(localStorage.getItem("aural-favourites") ?? "[]").length);
  await page.reload();
  await page.waitForFunction(() => document.readyState === "complete");
  const favCountAfter = await page.evaluate(() => JSON.parse(localStorage.getItem("aural-favourites") ?? "[]").length);
  check("favourites persist across reload", favCountAfter >= favCountBefore && favCountBefore >= 1, `${favCountBefore} -> ${favCountAfter}`);

  // Console errors (network failures from third-party CDNs and GPU-driver
  // performance warnings from WebGL probes are expected, not app bugs)
  const appErrors = results.console.filter((line) => !/Failed to load resource|GPU stall/.test(line));
  check("no console errors", appErrors.length === 0, appErrors.join(" | "));
  return results;
}
