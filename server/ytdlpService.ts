import { spawn } from "node:child_process";
import crypto from "node:crypto";
import dns from "node:dns/promises";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ALLOWED_AUDIO_FORMATS,
  buildDiscoverArgs,
  buildImportArgs,
  isDisallowedIpAddress,
  isPathInsideDir,
  normalizeDiscoveryPayload,
  parseProgressLine,
  validateAudioFormat,
  validateMediaUrl,
  type YtdlpAudioFormat,
  type YtdlpDiscoveredItem,
  type YtdlpDiscoveryResult,
} from "./ytdlpSecurity";

export interface YtdlpInstallationStatus {
  available: boolean;
  runnerLabel: string;
  version: string;
  ffmpegAvailable: boolean;
  supportedFormats: readonly YtdlpAudioFormat[];
  installHint: string;
}

export type YtdlpJobState = "queued" | "running" | "ready" | "completed" | "cancelled" | "error";

export interface YtdlpImportJobSnapshot {
  jobId: string;
  state: YtdlpJobState;
  percent: number;
  statusText: string;
  format: YtdlpAudioFormat;
  sourceUrl: string;
  error?: string;
  filename?: string;
  mimeType?: string;
  bytes?: number;
  metadata?: YtdlpDiscoveredItem;
}

interface InternalJob extends YtdlpImportJobSnapshot {
  workDir: string;
  outputFilePath?: string;
  cancelRequested: boolean;
  killProcess?: () => void;
  cleanupTimer?: NodeJS.Timeout;
  listeners: Set<(snapshot: YtdlpImportJobSnapshot) => void>;
}

interface RunnerSpec {
  command: string;
  prefixArgs: string[];
  label: string;
}

const TEMP_ROOT = path.join(os.tmpdir(), "aural-ytdlp");
const MAX_CONCURRENT_JOBS = 3;
const DISCOVER_TIMEOUT_MS = 25_000;
const IMPORT_TIMEOUT_MS = 180_000;
const JOB_RETENTION_MS = 10 * 60 * 1000;
const MAX_IMPORT_BYTES = 80 * 1024 * 1024;

const MIME_BY_EXTENSION: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".opus": "audio/opus",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
};

const jobs = new Map<string, InternalJob>();

function existingFile(candidate: string | undefined): string | null {
  if (!candidate) return null;
  const trimmed = candidate.trim();
  if (!trimmed) return null;
  try {
    const resolved = path.resolve(trimmed);
    const stat = fs.statSync(resolved);
    return stat.isFile() ? resolved : null;
  } catch {
    return null;
  }
}

function getResourcesBinDir(): string | null {
  const proc = process as NodeJS.Process & { resourcesPath?: string };
  if (proc.resourcesPath) {
    return path.join(proc.resourcesPath, "bin");
  }
  return null;
}

function candidateRunners(): RunnerSpec[] {
  const isWin = process.platform === "win32";
  const exeName = isWin ? "yt-dlp.exe" : "yt-dlp";
  const runners: RunnerSpec[] = [];

  const envPath = existingFile(process.env.YTDLP_PATH);
  if (envPath) {
    if (envPath.endsWith(".py")) {
      runners.push({ command: isWin ? "python" : "python3", prefixArgs: [envPath], label: "YTDLP_PATH (Python)" });
    } else {
      runners.push({ command: envPath, prefixArgs: [], label: "YTDLP_PATH" });
    }
  }

  const resBin = getResourcesBinDir();
  if (resBin) {
    const bundled = existingFile(path.join(resBin, exeName));
    if (bundled) {
      runners.push({ command: bundled, prefixArgs: [], label: "Bundled yt-dlp" });
    }
  }

  const localBin = existingFile(path.join(process.cwd(), "resources", "bin", exeName));
  if (localBin) {
    runners.push({ command: localBin, prefixArgs: [], label: "Local resources/bin" });
  }

  const devBin = existingFile(path.join(process.cwd(), "bin", exeName));
  if (devBin) {
    runners.push({ command: devBin, prefixArgs: [], label: "Local bin" });
  }

  runners.push({ command: exeName, prefixArgs: [], label: "System PATH" });
  if (isWin) {
    runners.push({ command: "py", prefixArgs: ["-3", "-m", "yt_dlp"], label: "Python (py -3 -m yt_dlp)" });
    runners.push({ command: "python", prefixArgs: ["-m", "yt_dlp"], label: "Python (-m yt_dlp)" });
  } else {
    runners.push({ command: "python3", prefixArgs: ["-m", "yt_dlp"], label: "Python (python3 -m yt_dlp)" });
  }
  return runners;
}

export function resolveFfmpegPath(): string | undefined {
  const isWin = process.platform === "win32";
  const exeName = isWin ? "ffmpeg.exe" : "ffmpeg";
  const envPath = existingFile(process.env.FFMPEG_PATH);
  if (envPath) return envPath;

  const resBin = getResourcesBinDir();
  if (resBin) {
    const bundled = existingFile(path.join(resBin, exeName));
    if (bundled) return bundled;
  }

  const localBin = existingFile(path.join(process.cwd(), "resources", "bin", exeName));
  if (localBin) return localBin;

  const devBin = existingFile(path.join(process.cwd(), "bin", exeName));
  if (devBin) return devBin;

  return undefined;
}

function runProbe(command: string, args: string[], timeoutMs = 4500): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    let stdout = "";
    let settled = false;
    const child = spawn(command, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve({ ok: false, stdout: "" });
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < 4096) stdout += chunk.toString("utf8");
    });
    child.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, stdout: "" });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, stdout: stdout.trim() });
    });
  });
}

let cachedRunner: { runner: RunnerSpec; version: string } | null = null;

async function detectRunner(): Promise<{ runner: RunnerSpec; version: string } | null> {
  if (cachedRunner) {
    const recheck = await runProbe(cachedRunner.runner.command, [...cachedRunner.runner.prefixArgs, "--version"], 2500);
    if (recheck.ok) return cachedRunner;
    cachedRunner = null;
  }
  for (const runner of candidateRunners()) {
    const res = await runProbe(runner.command, [...runner.prefixArgs, "--version"], 4000);
    if (res.ok && res.stdout) {
      cachedRunner = { runner, version: res.stdout.split(/\r?\n/)[0].trim() };
      return cachedRunner;
    }
  }
  return null;
}

export async function getYtdlpStatus(): Promise<YtdlpInstallationStatus> {
  const detected = await detectRunner();
  const ffmpegCandidate = resolveFfmpegPath() ?? (process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  const ffmpegProbe = await runProbe(ffmpegCandidate, ["-version"], 3500);

  return {
    available: Boolean(detected),
    runnerLabel: detected ? detected.runner.label : "Not installed",
    version: detected ? detected.version : "",
    ffmpegAvailable: ffmpegProbe.ok,
    supportedFormats: ALLOWED_AUDIO_FORMATS,
    installHint: detected
      ? ffmpegProbe.ok
        ? "Ready for authorized metadata lookup and audio extraction."
        : "yt-dlp is available, but ffmpeg was not found. Audio conversion requires ffmpeg."
      : "Install yt-dlp (pip install yt-dlp or place yt-dlp.exe in resources/bin/) and ffmpeg to enable this optional source.",
  };
}

async function assertPublicDestination(validatedUrl: string): Promise<void> {
  const parsed = new URL(validatedUrl);
  try {
    const records = await dns.lookup(parsed.hostname, { all: true });
    for (const record of records) {
      if (isDisallowedIpAddress(record.address)) {
        throw new Error("Local network and loopback addresses are blocked.");
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("blocked")) {
      throw error;
    }
    // If DNS cannot resolve in offline mode, let yt-dlp report its standard network error or fail cleanly.
  }
}

export async function discoverMedia(rawUrl: unknown, signal?: AbortSignal): Promise<YtdlpDiscoveryResult> {
  const validated = validateMediaUrl(rawUrl);
  if (!validated.ok) {
    throw new Error(validated.error);
  }
  await assertPublicDestination(validated.url);

  const detected = await detectRunner();
  if (!detected) {
    throw new Error("yt-dlp is not installed on this host. Install yt-dlp or bundle it in resources/bin/ first.");
  }

  const args = [...detected.runner.prefixArgs, ...buildDiscoverArgs(validated.url, 25)];
  const rawJson = await new Promise<string>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const maxBytes = 6 * 1024 * 1024;

    const child = spawn(detected.runner.command, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1200).unref();
      reject(new Error("Metadata lookup was cancelled."));
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1200).unref();
      reject(new Error("Metadata lookup timed out. Check the URL or network connection."));
    }, DISCOVER_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (Buffer.byteLength(stdout) > maxBytes) {
        if (!settled) {
          settled = true;
          cleanup();
          child.kill("SIGKILL");
          reject(new Error("Metadata payload exceeded maximum allowed size."));
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 8192) stderr += chunk.toString("utf8");
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Could not start yt-dlp: ${err.message}`));
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (code !== 0) {
        const message = stderr
          .split(/\r?\n/)
          .map((line) => line.replace(/^ERROR:\s*/i, "").trim())
          .filter(Boolean)
          .pop();
        reject(new Error(message || "yt-dlp could not read metadata from this URL."));
        return;
      }
      resolve(stdout);
    });
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error("yt-dlp returned malformed metadata JSON.");
  }
  return normalizeDiscoveryPayload(parsed, validated.url);
}

function toSnapshot(job: InternalJob): YtdlpImportJobSnapshot {
  return {
    jobId: job.jobId,
    state: job.state,
    percent: job.percent,
    statusText: job.statusText,
    format: job.format,
    sourceUrl: job.sourceUrl,
    ...(job.error ? { error: job.error } : {}),
    ...(job.filename ? { filename: job.filename } : {}),
    ...(job.mimeType ? { mimeType: job.mimeType } : {}),
    ...(job.bytes !== undefined ? { bytes: job.bytes } : {}),
    ...(job.metadata ? { metadata: job.metadata } : {}),
  };
}

function notifyJob(job: InternalJob): void {
  const snapshot = toSnapshot(job);
  for (const listener of job.listeners) {
    listener(snapshot);
  }
}

async function cleanupJobFiles(job: InternalJob): Promise<void> {
  if (job.cleanupTimer) {
    clearTimeout(job.cleanupTimer);
    job.cleanupTimer = undefined;
  }
  try {
    if (isPathInsideDir(job.workDir, TEMP_ROOT)) {
      await fsp.rm(job.workDir, { recursive: true, force: true });
    }
  } catch {
    // Ignore cleanup errors on temp directories.
  }
}

function scheduleCleanup(job: InternalJob): void {
  if (job.cleanupTimer) clearTimeout(job.cleanupTimer);
  job.cleanupTimer = setTimeout(() => {
    void cleanupJobFiles(job).finally(() => {
      jobs.delete(job.jobId);
    });
  }, JOB_RETENTION_MS);
  job.cleanupTimer.unref();
}

function countActiveJobs(): number {
  let count = 0;
  for (const job of jobs.values()) {
    if (job.state === "queued" || job.state === "running") count += 1;
  }
  return count;
}

export async function startImportJob(params: {
  url: unknown;
  format?: unknown;
  authorized: unknown;
  metadataHint?: Partial<YtdlpDiscoveredItem>;
}): Promise<YtdlpImportJobSnapshot> {
  if (params.authorized !== true) {
    throw new Error("Explicit rights or permission confirmation is required before importing audio.");
  }

  const validated = validateMediaUrl(params.url);
  if (!validated.ok) {
    throw new Error(validated.error);
  }
  const format = validateAudioFormat(params.format);
  await assertPublicDestination(validated.url);

  if (countActiveJobs() >= MAX_CONCURRENT_JOBS) {
    throw new Error("Too many active media imports are already running. Wait or cancel an active import.");
  }

  const detected = await detectRunner();
  if (!detected) {
    throw new Error("yt-dlp is not installed on this host. Install yt-dlp or bundle it in resources/bin/ first.");
  }

  const jobId = crypto.randomUUID();
  const workDir = path.join(TEMP_ROOT, jobId);
  await fsp.mkdir(workDir, { recursive: true });
  if (!isPathInsideDir(workDir, TEMP_ROOT)) {
    throw new Error("Invalid import workspace directory.");
  }

  const job: InternalJob = {
    jobId,
    state: "running",
    percent: 2,
    statusText: "Starting authorized import…",
    format,
    sourceUrl: validated.url,
    workDir,
    cancelRequested: false,
    listeners: new Set(),
    ...(params.metadataHint?.title
      ? {
          metadata: {
            id: params.metadataHint.id || jobId,
            title: params.metadataHint.title,
            artist: params.metadataHint.artist || "Unknown artist",
            album: params.metadataHint.album || "Imported",
            duration: params.metadataHint.duration || 0,
            thumbnail: params.metadataHint.thumbnail || "",
            sourceUrl: validated.url,
            webpageUrl: params.metadataHint.webpageUrl || validated.url,
            extractor: params.metadataHint.extractor || "yt-dlp",
          },
        }
      : {}),
  };

  jobs.set(jobId, job);
  scheduleCleanup(job);

  const ffmpegLocation = resolveFfmpegPath();
  const outputTemplate = path.join(workDir, "audio.%(ext)s");
  const args = [
    ...detected.runner.prefixArgs,
    ...buildImportArgs(validated.url, outputTemplate, {
      format,
      maxFilesizeMb: 75,
      ...(ffmpegLocation ? { ffmpegLocation } : {}),
      embedThumbnail: Boolean(ffmpegLocation),
    }),
  ];

  const child = spawn(detected.runner.command, args, {
    shell: false,
    cwd: workDir,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  const timeoutTimer = setTimeout(() => {
    if (job.state === "running") {
      job.state = "error";
      job.error = "Media import timed out.";
      job.statusText = "Import timed out.";
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1200).unref();
      notifyJob(job);
      void cleanupJobFiles(job);
    }
  }, IMPORT_TIMEOUT_MS);

  job.killProcess = () => {
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 1200).unref();
  };

  let stderrTail = "";
  let lineBuffer = "";

  const handleOutputChunk = (chunk: Buffer, isErr: boolean) => {
    const text = chunk.toString("utf8");
    if (isErr && stderrTail.length < 8192) {
      stderrTail += text;
    }
    lineBuffer += text;
    const lines = lineBuffer.split(/\r?\n/);
    lineBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const progress = parseProgressLine(line);
      if (progress && job.state === "running") {
        if (progress.percent !== undefined) job.percent = Math.max(job.percent, progress.percent);
        if (progress.statusText) job.statusText = progress.statusText;
        notifyJob(job);
      }
    }
  };

  child.stdout.on("data", (chunk: Buffer) => handleOutputChunk(chunk, false));
  child.stderr.on("data", (chunk: Buffer) => handleOutputChunk(chunk, true));

  child.on("error", (err) => {
    clearTimeout(timeoutTimer);
    if (job.cancelRequested || job.state !== "running") return;
    job.state = "error";
    job.error = `Could not execute yt-dlp: ${err.message}`;
    job.statusText = "Import failed.";
    notifyJob(job);
    void cleanupJobFiles(job);
  });

  child.on("close", async (code) => {
    clearTimeout(timeoutTimer);
    if (job.cancelRequested || job.state === "cancelled") {
      job.state = "cancelled";
      job.statusText = "Import cancelled.";
      notifyJob(job);
      await cleanupJobFiles(job);
      return;
    }
    if (job.state !== "running") return;

    if (code !== 0) {
      const errorLine = stderrTail
        .split(/\r?\n/)
        .map((line) => line.replace(/^ERROR:\s*/i, "").trim())
        .filter(Boolean)
        .pop();
      job.state = "error";
      job.error = errorLine || "yt-dlp failed to extract audio from this source.";
      job.statusText = "Import failed.";
      notifyJob(job);
      await cleanupJobFiles(job);
      return;
    }

    try {
      const entries = await fsp.readdir(workDir);
      const audioName = entries.find((name) => {
        const ext = path.extname(name).toLowerCase();
        return ext in MIME_BY_EXTENSION;
      });
      if (!audioName) {
        throw new Error("No extracted audio file was produced.");
      }

      const audioPath = path.join(workDir, audioName);
      if (!isPathInsideDir(audioPath, workDir)) {
        throw new Error("Resolved output path escaped workspace.");
      }

      const stat = await fsp.stat(audioPath);
      if (!stat.isFile() || stat.size <= 0) {
        throw new Error("Extracted audio file is empty.");
      }
      if (stat.size > MAX_IMPORT_BYTES) {
        throw new Error("Extracted audio exceeds the 80 MB offline storage limit.");
      }

      const infoName = entries.find((name) => name.endsWith(".info.json"));
      if (infoName) {
        const infoPath = path.join(workDir, infoName);
        if (isPathInsideDir(infoPath, workDir)) {
          try {
            const rawInfo = JSON.parse(await fsp.readFile(infoPath, "utf8")) as unknown;
            const normalized = normalizeDiscoveryPayload(rawInfo, validated.url);
            if (normalized.items[0]) {
              job.metadata = normalized.items[0];
            }
          } catch {
            // Keep metadataHint if info json cannot be parsed.
          }
        }
      }

      const ext = path.extname(audioName).toLowerCase();
      const safeBase = (job.metadata?.title || "imported-audio")
        .replace(/[\\/:*?"<>|]+/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80) || "imported-audio";

      job.outputFilePath = audioPath;
      job.filename = `${safeBase}${ext}`;
      job.mimeType = MIME_BY_EXTENSION[ext] ?? "application/octet-stream";
      job.bytes = stat.size;
      job.percent = 100;
      job.state = "ready";
      job.statusText = "Saving to Aural offline library…";
      notifyJob(job);
      scheduleCleanup(job);
    } catch (err) {
      job.state = "error";
      job.error = err instanceof Error ? err.message : "Could not finalize imported audio.";
      job.statusText = "Import failed.";
      notifyJob(job);
      await cleanupJobFiles(job);
    }
  });

  return toSnapshot(job);
}

export function getImportJob(jobId: string): YtdlpImportJobSnapshot | null {
  const job = jobs.get(jobId);
  return job ? toSnapshot(job) : null;
}

export function subscribeImportJob(
  jobId: string,
  listener: (snapshot: YtdlpImportJobSnapshot) => void,
): (() => void) | null {
  const job = jobs.get(jobId);
  if (!job) return null;
  job.listeners.add(listener);
  return () => {
    job.listeners.delete(listener);
  };
}

export async function cancelImportJob(jobId: string): Promise<YtdlpImportJobSnapshot | null> {
  const job = jobs.get(jobId);
  if (!job) return null;
  if (job.state === "completed" || job.state === "error" || job.state === "cancelled") {
    return toSnapshot(job);
  }
  job.cancelRequested = true;
  job.state = "cancelled";
  job.statusText = "Import cancelled.";
  job.killProcess?.();
  notifyJob(job);
  await cleanupJobFiles(job);
  return toSnapshot(job);
}

export async function readImportJobFile(jobId: string): Promise<{
  filePath: string;
  filename: string;
  mimeType: string;
  bytes: number;
  cleanup: () => Promise<void>;
} | null> {
  const job = jobs.get(jobId);
  if (!job || job.state !== "ready" || !job.outputFilePath || !isPathInsideDir(job.outputFilePath, job.workDir)) {
    return null;
  }
  return {
    filePath: job.outputFilePath,
    filename: job.filename ?? "audio.mp3",
    mimeType: job.mimeType ?? "audio/mpeg",
    bytes: job.bytes ?? 0,
    cleanup: async () => {
      job.state = "completed";
      job.statusText = "Imported to Aural offline library.";
      notifyJob(job);
      await cleanupJobFiles(job);
      jobs.delete(job.jobId);
    },
  };
}
