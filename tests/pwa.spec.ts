import { test, expect } from "@playwright/test";
import { preview } from "vite";
import type { PreviewServer } from "vite";

/**
 * Service-worker tests run against a real production build (the dev server
 * never registers one), so this file spins up `vite preview` itself.
 */

let server: PreviewServer;

test.beforeAll(async () => {
  server = await preview({ preview: { port: 4174, strictPort: true } });
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => server.httpServer.close(() => resolve()));
});

test("service worker enables full offline shell load", async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto("http://localhost:4174/");
  await expect(page.getByText("Good evening")).toBeVisible();

  // Warm the runtime cache with the hashed assets, waiting for the service
  // worker's active state before going offline.
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    const html = await (await fetch("/")).text();
    const assets = [...html.matchAll(/\/assets\/[^"]+/g)].map((m) => m[0]);
    for (const asset of assets) {
      await fetch(asset, { cache: "reload" });
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  });
  // Second reload while online lets the fetch handler store every asset.
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByText("Good evening")).toBeVisible();
  await page.waitForTimeout(800);

  await page.context().setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => { });
  await page.waitForTimeout(2500);
  await expect(page.locator(".app-shell")).toBeVisible();
  await expect(page.getByRole("button", { name: "Home", exact: true })).toBeVisible();
  await page.context().setOffline(false);
  await page.close();
});
