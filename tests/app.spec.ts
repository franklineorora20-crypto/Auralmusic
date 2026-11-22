import { test, expect } from "@playwright/test";
import { Buffer } from "node:buffer";

function makeWav() {
  const sampleRate = 8000;
  const frames = 80000;
  const bytes = Buffer.alloc(44 + frames * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVE", 8);
  bytes.write("fmt ", 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame += 1) {
    bytes.writeInt16LE(Math.round(Math.sin(frame * 2 * Math.PI * 440 / sampleRate) * 4000), 44 + frame * 2);
  }
  return bytes;
}

test("core navigation, search, playlist creation and player controls work", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Good evening")).toBeVisible();

  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByLabel("Search music").fill("Aurora");
  await expect(page.locator(".search-results").getByText("Aurora Drift")).toBeVisible();
  const auroraRow = page.locator(".search-results .track-row").filter({ hasText: "Aurora Drift" }).first();
  await auroraRow.getByRole("button", { name: "Add to favourites" }).click();

  await page.getByRole("button", { name: "Your library", exact: true }).click();
  const savedTracks = page.locator(".library-page .content-section").filter({ hasText: "Saved tracks" });
  await expect(savedTracks.getByText("Aurora Drift")).toBeVisible();
  await savedTracks.getByRole("button", { name: "Remove from favourites" }).click();
  await page.getByRole("button", { name: "New playlist" }).click();
  await page.getByPlaceholder("Playlist name").fill("Evening Lab");
  await page.getByRole("dialog").getByRole("button", { name: "Create playlist" }).click();
  await expect(page.locator(".playlist-grid").getByText("Evening Lab")).toBeVisible();

  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.locator(".search-results .track-row").filter({ hasText: "Aurora Drift" }).first()
    .getByRole("button", { name: "Add Aurora Drift to a playlist" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Evening Lab" }).click();
  await page.getByRole("button", { name: "Evening Lab", exact: true }).click();
  await page.getByRole("button", { name: "Remove Aurora Drift" }).click();
  await expect(page.getByText("This playlist is empty")).toBeVisible();

  await page.getByRole("button", { name: "Home", exact: true }).click();
  const player = page.locator(".player");
  await player.getByRole("button", { name: "Play", exact: true }).click();
  await expect(player.getByRole("button", { name: "Pause" })).toBeVisible();
  await player.getByRole("button", { name: "Pause" }).click();
  await expect(player.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  await player.getByRole("button", { name: "Play", exact: true }).click();
  await expect(player.getByRole("button", { name: "Pause" })).toBeVisible();
  await player.getByRole("button", { name: "Repeat mode: off" }).click();
  await expect(player.getByRole("button", { name: "Repeat mode: all" })).toBeVisible();
  await player.getByRole("button", { name: "Repeat mode: all" }).click();
  await expect(player.getByRole("button", { name: "Repeat mode: one" })).toBeVisible();
  await player.getByRole("button", { name: "Repeat mode: one" }).click();

  await page.getByRole("button", { name: "Open queue" }).click();
  await expect(page.getByRole("complementary", { name: "Queue" })).toBeVisible();
  await page.getByRole("button", { name: "Close queue" }).click();

  await page.getByLabel("Playback position").evaluate((element: HTMLInputElement) => {
    element.value = "30";
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
});

test("mobile layout renders primary navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Search", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Your library", exact: true })).toBeVisible();
});

test("Audius results can be downloaded, played offline, restored and removed", async ({ page }) => {
  const wav = makeWav();
  await page.route("https://api.audius.co/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/download") || url.pathname.endsWith("/stream")) {
      await route.fulfill({ status: 200, contentType: "audio/wav", body: wav });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [{
          id: "licensed-test-track",
          title: "Licensed test recording",
          duration: 1,
          genre: "Ambient",
          artwork: { "480x480": "https://images.example.test/cover.jpg" },
          user: { name: "Test artist" },
          is_downloadable: true,
        }],
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByLabel("Search music").fill("Licensed test recording");
  await expect(page.locator(".search-results").getByText("Licensed test recording")).toBeVisible();
  await page.getByRole("button", { name: "Download Licensed test recording" }).click();
  await expect(page.getByRole("button", { name: "Remove Licensed test recording download" })).toBeVisible();

  await page.getByRole("button", { name: "Downloads", exact: true }).click();
  await expect(page.locator(".downloads-page").getByText("Licensed test recording")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Downloads", exact: true }).click();
  await expect(page.locator(".downloads-page").getByText("Licensed test recording")).toBeVisible();

  await page.context().setOffline(true);
  await expect(page.locator(".downloads-page .connection-status")).toHaveText("Offline");
  await page.locator(".downloads-page .track-main").click();
  await expect(page.locator("audio")).toHaveJSProperty("paused", false);
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.currentSrc.startsWith("blob:"))).toBe(true);
  await page.context().setOffline(false);
  await expect(page.locator(".downloads-page .connection-status")).toHaveText("Online");

  await page.getByRole("button", { name: "Remove Licensed test recording download" }).click();
  await expect(page.locator(".downloads-page").getByText("No offline music yet")).toBeVisible();
});

test("tracks without explicit download permission have no download control", async ({ page }) => {
  await page.route("https://api.audius.co/v1/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: [{
          id: "stream-only-track",
          title: "Stream only recording",
          duration: 120,
          genre: "Electronic",
          user: { name: "Test artist" },
          is_downloadable: false,
        }],
      }),
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByLabel("Search music").fill("Stream only recording");
  await expect(page.locator(".search-results").getByText("Stream only recording")).toBeVisible();
  await expect(page.getByRole("button", { name: "Download Stream only recording" })).toHaveCount(0);
});
