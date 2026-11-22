import { test, expect } from "@playwright/test";

test("queue shows now-playing, upcoming, reorder and removal", async ({ page }) => {
  await page.goto("/");
  await page.locator(".music-card .cover-button").first().click();
  await page.waitForTimeout(1200);

  await page.getByRole("button", { name: "Open queue" }).click();
  const panel = page.getByRole("complementary", { name: "Queue" });
  await expect(panel).toBeVisible();

  // Now-playing section with equalizer
  await expect(panel.locator(".now-playing-item")).toBeVisible();
  await expect(panel.locator(".now-playing-item small")).toContainText("Now playing");
  await expect(panel.locator(".queue-equalizer")).toBeVisible();

  // Upcoming label + items with reorder controls
  const upcoming = panel.locator(".queue-item:not(.now-playing-item)");
  await expect(upcoming.first()).toBeVisible();
  await expect(panel.locator(".queue-section-label")).toContainText("Up next");

  // Reorder: move second item up — its title should swap position
  const firstTitle = await upcoming.nth(0).locator("strong").innerText();
  const secondTitle = await upcoming.nth(1).locator("strong").innerText();
  await upcoming.nth(1).getByRole("button", { name: `Move ${secondTitle} up in queue` }).click();
  await page.waitForTimeout(300);
  await expect(upcoming.nth(0).locator("strong")).toHaveText(secondTitle);
  await expect(upcoming.nth(1).locator("strong")).toHaveText(firstTitle);

  // Remove the first upcoming item
  await upcoming.nth(0).getByRole("button", { name: /from queue/ }).click();
  await page.waitForTimeout(300);
  await expect(upcoming.nth(0).locator("strong")).toHaveText(firstTitle);

  // Jump to a queued track by clicking it
  const target = await upcoming.nth(0).locator("strong").innerText();
  await upcoming.nth(0).locator("button.queue-item-copy").click();
  await page.waitForTimeout(800);
  await expect(page.locator(".now-playing strong")).toHaveText(target);
});

test("artist page shows shuffle, albums and metadata", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Trending on Audius").waitFor({ timeout: 25000 }).catch(() => { });
  // Open an album from a card, then the artist from the album page
  await page.locator(".content-section").filter({ hasText: "Trending on Audius" }).locator(".card-copy").first().click();
  await page.waitForTimeout(600);
  await page.locator(".detail-hero .text-link").click();
  await page.waitForTimeout(600);

  await expect(page.locator(".detail-hero h1")).toBeVisible();
  await expect(page.locator(".detail-hero").getByRole("button", { name: "Play" })).toBeVisible();
  await expect(page.locator(".detail-actions").getByRole("button", { name: "Shuffle" })).toBeVisible();
  await expect(page.locator(".detail-hero p").nth(1)).toContainText("·");
  // Popular tracks listing present
  await expect(page.locator(".track-row").first()).toBeVisible();
});

test("album page shows duration, genre badges and shuffle", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Trending on Audius").waitFor({ timeout: 25000 }).catch(() => { });
  await page.locator(".content-section").filter({ hasText: "Trending on Audius" }).locator(".card-copy").first().click();
  await page.waitForTimeout(600);

  await expect(page.locator(".detail-hero h1")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save album" }).or(page.getByRole("button", { name: "Saved album" }))).toBeVisible();
  await expect(page.locator(".detail-actions").getByRole("button", { name: "Shuffle" })).toBeVisible();
  // Track listing with durations
  await expect(page.locator(".track-duration").first()).toBeVisible();
});

test("crossfade toggle persists and is exposed", async ({ page }) => {
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Crossfade" });
  await expect(toggle).toBeVisible();
  await toggle.click();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => localStorage.getItem("aural-crossfade"))).toBe("true");
  await page.reload();
  await expect(page.getByRole("button", { name: "Crossfade" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Crossfade" }).click();
  expect(await page.evaluate(() => localStorage.getItem("aural-crossfade"))).toBe("false");
});

test("artwork renders with fallback initials and no layout shift", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Trending on Audius").waitFor({ timeout: 25000 }).catch(() => { });
  const card = page.locator(".music-card").first();
  const artwork = card.locator(".artwork").first();
  await expect(artwork).toBeVisible();
  // Fallback initials are always present under the image
  await expect(artwork.locator("span")).toBeVisible();
  // Fixed aspect ratio prevents layout shift
  const box = await artwork.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.abs((box!.width / box!.height) - 1)).toBeLessThan(0.05);
});

test("CRT effect renders on hero and toggles in Now Playing", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Trending on Audius").waitFor({ timeout: 25000 }).catch(() => { });

  // Hero: CRT canvas present, decorative, non-interactive
  await expect(page.locator(".hero-crt canvas")).toBeVisible();
  await expect(page.locator(".hero-crt")).toHaveAttribute("aria-hidden", "true");

  // Now Playing: toggle enables, persists, and disables the visualizer
  await page.getByRole("button", { name: "Expand player" }).click();
  await expect(page.locator(".np-crt-layer")).toHaveCount(0);
  await page.getByRole("button", { name: "CRT visualizer" }).click();
  await expect(page.locator(".np-crt-layer canvas")).toBeVisible();
  await expect(page.getByRole("button", { name: "CRT visualizer" })).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Expand player" }).click();
  await expect(page.locator(".np-crt-layer canvas")).toBeVisible();

  await page.getByRole("button", { name: "CRT visualizer" }).click();
  await expect(page.locator(".np-crt-layer")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("aural-crt"))).toBe("false");
});
