import audit from "./audit-runtime.mjs";
import { createServer } from "vite";
import { chromium } from "playwright";

const server = await createServer({ root: process.cwd(), server: { port: 5199 } });
await server.listen();
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("http://localhost:5199/", { waitUntil: "domcontentloaded" });
const results = await audit(page, {});
console.log(JSON.stringify(results, null, 1));
await browser.close();
await server.close();
process.exit(results.checks.every((c) => c.ok) ? 0 : 1);
