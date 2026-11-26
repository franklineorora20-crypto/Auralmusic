import fs from "node:fs";
import type http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import {
  cancelImportJob,
  discoverMedia,
  getImportJob,
  getYtdlpStatus,
  readImportJobFile,
  startImportJob,
  subscribeImportJob,
} from "./server/ytdlpService";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname);

export function createAuralApiRouter(): express.Router {
  const router = express.Router();

  router.get("/ytdlp/status", async (_req, res) => {
    try {
      const status = await getYtdlpStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Could not check yt-dlp status.",
      });
    }
  });

  router.post("/ytdlp/discover", async (req, res) => {
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      const body = (req.body ?? {}) as { url?: unknown };
      const result = await discoverMedia(body.url, controller.signal);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Metadata discovery failed.";
      const status = message.includes("URL") || message.includes("blocked") || message.includes("scheme") ? 400 : 502;
      res.status(status).json({ error: message });
    }
  });

  router.post("/ytdlp/import", async (req, res) => {
    try {
      const body = (req.body ?? {}) as {
        url?: unknown;
        format?: unknown;
        authorized?: unknown;
        metadataHint?: Record<string, unknown>;
      };
      if (body.authorized !== true) {
        res.status(403).json({
          error: "Confirm that you own the rights or have permission to import this audio.",
        });
        return;
      }
      const rawHint = body.metadataHint && typeof body.metadataHint === "object" ? body.metadataHint : undefined;
      const metadataHint = rawHint
        ? {
            ...(typeof rawHint.id === "string" ? { id: rawHint.id } : {}),
            ...(typeof rawHint.title === "string" ? { title: rawHint.title } : {}),
            ...(typeof rawHint.artist === "string" ? { artist: rawHint.artist } : {}),
            ...(typeof rawHint.album === "string" ? { album: rawHint.album } : {}),
            ...(typeof rawHint.duration === "number" ? { duration: rawHint.duration } : {}),
            ...(typeof rawHint.thumbnail === "string" ? { thumbnail: rawHint.thumbnail } : {}),
            ...(typeof rawHint.webpageUrl === "string" ? { webpageUrl: rawHint.webpageUrl } : {}),
            ...(typeof rawHint.extractor === "string" ? { extractor: rawHint.extractor } : {}),
          }
        : undefined;
      const snapshot = await startImportJob({
        url: body.url,
        format: body.format,
        authorized: body.authorized,
        metadataHint,
      });
      res.status(202).json(snapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not start media import.";
      const status = message.includes("Too many") ? 429 : 400;
      res.status(status).json({ error: message });
    }
  });

  router.get("/ytdlp/jobs/:id", (req, res) => {
    const snapshot = getImportJob(req.params.id);
    if (!snapshot) {
      res.status(404).json({ error: "Import job not found." });
      return;
    }
    res.json(snapshot);
  });

  router.get("/ytdlp/jobs/:id/stream", (req, res) => {
    const snapshot = getImportJob(req.params.id);
    if (!snapshot) {
      res.status(404).json({ error: "Import job not found." });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const send = (data: unknown) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    send(snapshot);

    if (snapshot.state === "ready" || snapshot.state === "completed" || snapshot.state === "cancelled" || snapshot.state === "error") {
      res.end();
      return;
    }

    const unsubscribe = subscribeImportJob(req.params.id, (next) => {
      send(next);
      if (next.state === "ready" || next.state === "completed" || next.state === "cancelled" || next.state === "error") {
        unsubscribe?.();
        res.end();
      }
    });

    req.on("close", () => {
      unsubscribe?.();
    });
  });

  router.post("/ytdlp/jobs/:id/cancel", async (req, res) => {
    const snapshot = await cancelImportJob(req.params.id);
    if (!snapshot) {
      res.status(404).json({ error: "Import job not found." });
      return;
    }
    res.json(snapshot);
  });

  router.get("/ytdlp/jobs/:id/file", async (req, res) => {
    const file = await readImportJobFile(req.params.id);
    if (!file) {
      res.status(404).json({ error: "Extracted audio file is not available." });
      return;
    }

    res.setHeader("Content-Type", file.mimeType);
    if (file.bytes > 0) {
      res.setHeader("Content-Length", String(file.bytes));
    }
    res.setHeader("X-Aural-Filename", encodeURIComponent(file.filename));

    const stream = fs.createReadStream(file.filePath);
    let cleaned = false;
    const finishCleanup = () => {
      if (cleaned) return;
      cleaned = true;
      void file.cleanup();
    };

    stream.on("error", () => {
      if (!res.headersSent) res.status(500).end();
      finishCleanup();
    });
    res.on("finish", finishCleanup);
    res.on("close", finishCleanup);
    stream.pipe(res);
  });

  return router;
}

export async function startAuralServer(options?: {
  port?: number;
  host?: string;
  distDir?: string;
  isDev?: boolean;
}): Promise<{ server: http.Server; port: number }> {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));

  app.use("/api", createAuralApiRouter());

  const isDev = options?.isDev ?? process.env.NODE_ENV !== "production";
  const distDir = options?.distDir ?? path.join(ROOT_DIR, "dist");

  if (isDev) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distDir));
    app.use((_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  const port = options?.port ?? Number(process.env.PORT || 3000);
  const host = options?.host ?? process.env.HOST ?? "0.0.0.0";

  return new Promise((resolve) => {
    const server = app.listen(port, host, () => {
      const addr = server.address();
      const boundPort = typeof addr === "object" && addr ? addr.port : port;
      console.log(`Aural server listening on http://${host}:${boundPort}`);
      resolve({ server, port: boundPort });
    });
  });
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  void startAuralServer();
}
