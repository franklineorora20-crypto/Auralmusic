import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";

/**
 * Integration tests for /api/ytdlp/* routes using a real Python 3 subprocess
 * configured via YTDLP_PATH (simulating yt-dlp CLI behavior cleanly offline).
 */
test("yt-dlp Express API handles status, discovery, auth gate, progress, cancel, and file cleanup", async () => {
  const fixtureDir = await fsp.mkdtemp(path.join(os.tmpdir(), "aural-ytdlp-test-"));
  const fakeYtdlpPy = path.join(fixtureDir, "fake_ytdlp.py");

  await fsp.writeFile(
    fakeYtdlpPy,
    `#!/usr/bin/env python3
import json, os, sys, time

args = sys.argv[1:]
if "--version" in args:
    print("2026.11.20")
    sys.exit(0)

url = args[-1]
if "--dump-single-json" in args:
    if "fail-discover" in url:
        sys.stderr.write("ERROR: Unsupported URL\\n")
        sys.exit(1)
    print(json.dumps({
        "id": "open-01",
        "title": "Public Domain Suite",
        "uploader": "Open Archive",
        "duration": 42,
        "thumbnail": "https://example.com/cover.jpg",
        "webpage_url": url,
        "extractor_key": "Generic",
    }))
    sys.exit(0)

if "--extract-audio" in args:
    out_idx = args.index("-o") + 1
    out_tpl = args[out_idx]
    out_dir = os.path.dirname(out_tpl)
    if "slow-cancel" in url:
        print("[download]  15.0% of 1.00MiB at 100KiB/s", flush=True)
        time.sleep(10)
        sys.exit(0)
    print("[download]  50.0% of 0.10MiB at 100KiB/s", flush=True)
    time.sleep(0.05)
    print("[download] 100% of 0.10MiB in 00:01", flush=True)
    print("[ExtractAudio] Destination: " + os.path.join(out_dir, "audio.mp3"), flush=True)
    with open(os.path.join(out_dir, "audio.mp3"), "wb") as f:
        f.write(b"ID3" + b"\\x00" * 64)
    with open(os.path.join(out_dir, "audio.info.json"), "w") as f:
        json.dump({
            "id": "open-01",
            "title": "Public Domain Suite",
            "artist": "Open Archive",
            "duration": 42,
            "webpage_url": url,
            "extractor_key": "Generic",
        }, f)
    sys.exit(0)
`,
    "utf8",
  );
  await fsp.chmod(fakeYtdlpPy, 0o755);

  const prevYtdlpPath = process.env.YTDLP_PATH;
  process.env.YTDLP_PATH = fakeYtdlpPy;

  const { createAuralApiRouter } = await import("../server");
  const app = express();
  app.use(express.json());
  app.use("/api", createAuralApiRouter());

  const server = await new Promise<import("node:http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });

  try {
    const addr = server.address();
    assert.ok(addr && typeof addr === "object");
    const base = `http://127.0.0.1:${addr.port}/api`;

    // 1. Status check
    const statusRes = await fetch(`${base}/ytdlp/status`);
    assert.equal(statusRes.status, 200);
    const status = (await statusRes.json()) as { available: boolean; version: string };
    assert.equal(status.available, true);
    assert.equal(status.version, "2026.11.20");

    // 2. Discovery validation blocks SSRF loopback
    const badDiscover = await fetch(`${base}/ytdlp/discover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "http://127.0.0.1:8080/secret" }),
    });
    assert.equal(badDiscover.status, 400);

    // 3. Valid metadata discovery
    const okDiscover = await fetch(`${base}/ytdlp/discover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/open-suite" }),
    });
    assert.equal(okDiscover.status, 200);
    const discovery = (await okDiscover.json()) as { title: string; items: Array<{ title: string }> };
    assert.equal(discovery.title, "Public Domain Suite");
    assert.equal(discovery.items[0].title, "Public Domain Suite");

    // 4. Import rejected when authorized !== true
    const unauthImport = await fetch(`${base}/ytdlp/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/open-suite", format: "mp3", authorized: false }),
    });
    assert.equal(unauthImport.status, 403);

    // 5. Authorized import succeeds and returns audio file
    const startRes = await fetch(`${base}/ytdlp/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/open-suite", format: "mp3", authorized: true }),
    });
    assert.equal(startRes.status, 202);
    const started = (await startRes.json()) as { jobId: string };

    let snap: { state: string; percent: number } = { state: "running", percent: 0 };
    for (let i = 0; i < 40; i += 1) {
      await new Promise((r) => setTimeout(r, 50));
      const pollRes = await fetch(`${base}/ytdlp/jobs/${started.jobId}`);
      snap = (await pollRes.json()) as { state: string; percent: number };
      if (snap.state === "ready" || snap.state === "error") break;
    }
    assert.equal(snap.state, "ready");
    assert.equal(snap.percent, 100);

    const fileRes = await fetch(`${base}/ytdlp/jobs/${started.jobId}/file`);
    assert.equal(fileRes.status, 200);
    assert.equal(fileRes.headers.get("content-type"), "audio/mpeg");
    const fileBuf = Buffer.from(await fileRes.arrayBuffer());
    assert.equal(fileBuf.subarray(0, 3).toString("utf8"), "ID3");

    // 6. Cancellation stops active job cleanly
    const slowStart = await fetch(`${base}/ytdlp/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/slow-cancel", format: "mp3", authorized: true }),
    });
    assert.equal(slowStart.status, 202);
    const slowJob = (await slowStart.json()) as { jobId: string };
    await new Promise((r) => setTimeout(r, 80));
    const cancelRes = await fetch(`${base}/ytdlp/jobs/${slowJob.jobId}/cancel`, { method: "POST" });
    assert.equal(cancelRes.status, 200);
    const cancelled = (await cancelRes.json()) as { state: string };
    assert.equal(cancelled.state, "cancelled");
  } finally {
    if (prevYtdlpPath === undefined) delete process.env.YTDLP_PATH;
    else process.env.YTDLP_PATH = prevYtdlpPath;
    server.close();
    if (fs.existsSync(fixtureDir)) {
      await fsp.rm(fixtureDir, { recursive: true, force: true });
    }
  }
});
