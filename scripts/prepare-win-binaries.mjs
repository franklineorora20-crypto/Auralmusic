import fs from "node:fs";
import path from "node:path";

const binDir = path.resolve("resources", "bin");
fs.mkdirSync(binDir, { recursive: true });

const ytdlpUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
const target = path.join(binDir, "yt-dlp.exe");

console.log(`Downloading ${ytdlpUrl} -> ${target}`);
const response = await fetch(ytdlpUrl, { redirect: "follow" });
if (!response.ok) {
  throw new Error(`Failed to download yt-dlp.exe (${response.status})`);
}
const buffer = Buffer.from(await response.arrayBuffer());
fs.writeFileSync(target, buffer);
console.log(`Saved ${target} (${(buffer.byteLength / (1024 * 1024)).toFixed(2)} MB)`);
console.log("For MP3/M4A/Opus conversion on Windows, also place ffmpeg.exe in resources/bin/.");
