import { test, expect } from "@playwright/test";
import { Buffer } from "node:buffer";

/** A tiny valid WAV so the browser treats the response as real audio. */
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

test("Jamendo tracks are searched, played, licensed and downloadable", async ({ page }) => {
  const wav = makeWav();
  await page.route("https://prod.example.test/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "audio/mpeg", body: wav });
  });
  await page.route("https://api.jamendo.com/**", async (route) => {
    const url = new URL(route.request().url());
    const client = url.searchParams.get("client_id");
    if (!client) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ headers: { status: "failed", code: 5, error_message: "no client id" }, results: [] }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        headers: { status: "success", results_count: 1 },
        results: [{
          id: "j1",
          name: "Jamendo test track",
          duration: 180,
          artist_name: "Jam Artist",
          artist_id: "ja1",
          album_name: "Jam Album",
          album_image: "https://img.example.test/a.jpg",
          image: "https://img.example.test/a.jpg",
          audio: "https://prod.example.test/audio.mp3",
          audiodownload: "https://prod.example.test/dl/audio.mp3",
          audiodownload_allowed: true,
          license_ccurl: "https://creativecommons.org/licenses/by-nc/3.0/",
          musicinfo: { tags: { genres: ["electronic"], vartags: [], instruments: [] } },
        }],
      }),
    });
  });

  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("aural-jamendo-client-id", "e2e-client-id"));
  await page.reload();

  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByLabel("Search music").fill("Jamendo test track");
  await expect(page.locator(".search-results").getByText("Jamendo test track")).toBeVisible();

  const row = page.locator(".search-results .track-row").filter({ hasText: "Jamendo test track" }).first();
  await expect(row.locator("small")).toHaveText(/Jam Artist · Jamendo/);
  await expect(row.getByRole("button", { name: "Download Jamendo test track" })).toBeVisible();

  await row.locator("button").first().click();
  await expect(page.locator("audio")).toHaveJSProperty("paused", false);
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.currentSrc)).toContain("prod.example.test");

  await page.getByRole("button", { name: "Download Jamendo test track" }).click();
  await expect(page.getByRole("button", { name: "Remove Jamendo test track download" })).toBeVisible();

  await page.getByRole("button", { name: "Downloads", exact: true }).click();
  await expect(page.locator(".downloads-page").getByText("Jamendo test track")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Downloads", exact: true }).click();
  await expect(page.locator(".downloads-page").getByText("Jamendo test track")).toBeVisible();
});

test("Jamendo failures do not break Audius search", async ({ page }) => {
  await page.route("https://api.jamendo.com/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ headers: { status: "failed", code: 5, error_message: "Invalid Client Id" }, results: [] }) });
  });
  await page.goto("/");
  await page.evaluate(() => localStorage.setItem("aural-jamendo-client-id", "bad-id"));
  await page.reload();

  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByLabel("Search music").fill("Aurora");
  await expect(page.locator(".search-results").getByText("Aurora Drift")).toBeVisible();
  await expect(page.locator("audio")).toHaveJSProperty("paused", true);
});

test("imported local files persist across reload and play offline", async ({ page }) => {
  const wav = makeWav();
  await page.goto("/");

  await page.getByRole("button", { name: "Your library", exact: true }).click();
  await page.getByRole("button", { name: /Import audio/ }).first().click();
  await page.setInputFiles('input[type="file"]', {
    name: "Local Artist - Local Song.wav",
    mimeType: "audio/wav",
    buffer: wav,
  });
  await expect(page.getByText("audio file", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Downloads", exact: true }).click();
  await expect(page.locator(".downloads-page").getByText("Local Song")).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Downloads", exact: true }).click();
  await expect(page.locator(".downloads-page").getByText("Local Song")).toBeVisible();

  await page.context().setOffline(true);
  await page.locator(".downloads-page .track-main").click();
  await expect(page.locator("audio")).toHaveJSProperty("paused", false);
  await page.context().setOffline(false);
});

test("playlist reordering and deletion work", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Your library", exact: true }).click();
  await page.getByRole("button", { name: "New playlist" }).click();
  await page.getByPlaceholder("Playlist name").fill("Order test");
  await page.getByRole("dialog").getByRole("button", { name: "Create playlist" }).click();
  await expect(page.locator(".playlist-grid").getByText("Order test")).toBeVisible();

  await page.getByRole("button", { name: "Order test", exact: true }).click();
  await expect(page.getByText("This playlist is empty")).toBeVisible();

  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByLabel("Search music").fill("Aurora");
  await page.locator(".search-results .track-row").filter({ hasText: "Aurora Drift" }).first()
    .getByRole("button", { name: "Add Aurora Drift to a playlist" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Order test" }).click();

  await page.getByRole("button", { name: "Order test", exact: true }).click();
  await expect(page.locator(".track-row").first()).toContainText("Aurora Drift");
  await page.getByRole("button", { name: /Delete/ }).click();
  await page.getByRole("button", { name: "Your library", exact: true }).click();
  await expect(page.locator(".playlist-grid").getByText("Order test")).toHaveCount(0);
});
