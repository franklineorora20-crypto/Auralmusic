const { app, BrowserWindow, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

let mainWindow = null;
let backendServer = null;

function configureBundledBinaries() {
  const isPackaged = app.isPackaged;
  const binDir = isPackaged
    ? path.join(process.resourcesPath, "bin")
    : path.join(__dirname, "..", "resources", "bin");
  const isWin = process.platform === "win32";
  const ytdlpName = isWin ? "yt-dlp.exe" : "yt-dlp";
  const ffmpegName = isWin ? "ffmpeg.exe" : "ffmpeg";

  const ytdlpCandidate = path.join(binDir, ytdlpName);
  const ffmpegCandidate = path.join(binDir, ffmpegName);

  if (!process.env.YTDLP_PATH && fs.existsSync(ytdlpCandidate)) {
    process.env.YTDLP_PATH = ytdlpCandidate;
  }
  if (!process.env.FFMPEG_PATH && fs.existsSync(ffmpegCandidate)) {
    process.env.FFMPEG_PATH = ffmpegCandidate;
  }
}

async function startBackend() {
  const distServerPath = path.join(__dirname, "..", "dist-server", "server.mjs");
  const distDir = path.join(__dirname, "..", "dist");
  const mod = await import(pathToFileURL(distServerPath).href);
  const { server, port } = await mod.startAuralServer({
    port: 0,
    host: "127.0.0.1",
    distDir,
    isDev: false,
  });
  backendServer = server;
  return `http://127.0.0.1:${port}`;
}

async function createWindow() {
  configureBundledBinaries();
  const devUrl = process.env.ELECTRON_START_URL;
  const targetUrl = devUrl || (await startBackend());

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 390,
    minHeight: 640,
    backgroundColor: "#100f0d",
    title: "Aural",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  await mainWindow.loadURL(targetUrl);
}

app.whenReady().then(() => {
  void createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (backendServer) {
    backendServer.close();
    backendServer = null;
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});
