const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("auralDesktop", {
  platform: process.platform,
  isElectron: true,
});
