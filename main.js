/* Emma Media Player: the small program that opens the window and talks to the computer. */
"use strict";
const { app, BrowserWindow, ipcMain, dialog, Menu, protocol } = require("electron");
const { Readable } = require("stream");
const path = require("path");
const fs = require("fs");

const MEDIA_EXT = new Set([".mp4", ".m4v", ".mov", ".mkv", ".webm", ".ogv", ".avi", ".wmv", ".mpg", ".mpeg", ".3gp",
  ".mp3", ".m4a", ".aac", ".wav", ".ogg", ".oga", ".opus", ".flac", ".weba"]);
const SUB_EXT = new Set([".srt", ".vtt"]);
let win = null;

/* Media is served through our own small address (emma-media://) so the equalizer is allowed to process the sound.
   Only real media files can be served, and only to this player window. */
protocol.registerSchemesAsPrivileged([
  { scheme: "emma-media", privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }
]);
const MIME = { ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/mp4", ".mkv": "video/x-matroska", ".webm": "video/webm", ".ogv": "video/ogg",
  ".avi": "video/x-msvideo", ".wmv": "video/x-ms-wmv", ".mpg": "video/mpeg", ".mpeg": "video/mpeg", ".3gp": "video/3gpp",
  ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".wav": "audio/wav", ".ogg": "audio/ogg", ".oga": "audio/ogg",
  ".opus": "audio/ogg", ".flac": "audio/flac", ".weba": "audio/webm" };
function serveMedia(request) {
  const cors = { "Access-Control-Allow-Origin": "*", "Accept-Ranges": "bytes" };
  try {
    const u = new URL(request.url);
    const file = decodeURIComponent(u.pathname.replace(/^\//, ""));
    if (!path.isAbsolute(file) || !isMedia(file)) return new Response("Not allowed", { status: 403, headers: cors });
    const st = fs.statSync(file);
    if (!st.isFile()) return new Response("Not found", { status: 404, headers: cors });
    const size = st.size, type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
    let start = 0, end = size - 1, status = 200;
    const r = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") || "");
    if (r && (r[1] || r[2])) {
      if (r[1]) { start = parseInt(r[1], 10); if (r[2]) end = Math.min(parseInt(r[2], 10), size - 1); }
      else { start = Math.max(0, size - parseInt(r[2], 10)); }
      if (start > end || start >= size) return new Response("Bad range", { status: 416, headers: { ...cors, "Content-Range": "bytes */" + size } });
      status = 206;
    }
    const headers = { ...cors, "Content-Type": type, "Content-Length": String(size ? end - start + 1 : 0) };
    if (status === 206) headers["Content-Range"] = "bytes " + start + "-" + end + "/" + size;
    if (!size) return new Response(null, { status: 200, headers });
    const stream = fs.createReadStream(file, { start, end });
    return new Response(Readable.toWeb(stream), { status, headers });
  } catch (e) {
    return new Response("Could not read the file", { status: 404, headers: cors });
  }
}

const isMedia = p => MEDIA_EXT.has(path.extname(String(p)).toLowerCase());
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/* a list of files or folders -> a list of playable files (folders are opened one level deep) */
function expand(list) {
  const out = [];
  for (const p of (Array.isArray(list) ? list : []).slice(0, 500)) {
    if (typeof p !== "string" || p.length > 1000) continue;
    try {
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        fs.readdirSync(p).sort(natural).forEach(n => {
          const f = path.join(p, n);
          try { if (out.length < 2000 && fs.statSync(f).isFile() && isMedia(f)) out.push(f); } catch (e) { /* skip */ }
        });
      } else if (st.isFile() && isMedia(p)) out.push(p);
    } catch (e) { /* skip */ }
  }
  return out;
}
function argvFiles(argv) {
  const rest = argv.slice(app.isPackaged ? 1 : 2).filter(a => a && !a.startsWith("-"));
  return expand(rest);
}
function send(ch, data) { if (win && !win.isDestroyed()) win.webContents.send(ch, data); }

function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1100, height: 680, minWidth: 640, minHeight: 440,
    backgroundColor: "#0b2a52", autoHideMenuBar: true, title: "Emma Media Player",
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", e => e.preventDefault());
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.on("closed", () => { win = null; });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); send("open-files", argvFiles(argv)); }
  });
  app.whenReady().then(() => { protocol.handle("emma-media", serveMedia); createWindow(); });
  app.on("window-all-closed", () => app.quit());
}

ipcMain.handle("open-dialog", async () => {
  const r = await dialog.showOpenDialog(win, {
    title: "Open video or music files", properties: ["openFile", "multiSelect"],
    filters: [
      { name: "Video and music", extensions: [...MEDIA_EXT].map(e => e.slice(1)) },
      { name: "All files", extensions: ["*"] }
    ]
  });
  return r.canceled ? [] : expand(r.filePaths);
});
ipcMain.handle("open-folder", async () => {
  const r = await dialog.showOpenDialog(win, { title: "Open a folder of videos or music", properties: ["openDirectory"] });
  return r.canceled ? [] : expand(r.filePaths);
});
ipcMain.handle("initial-files", () => argvFiles(process.argv));
ipcMain.handle("expand", (_e, list) => expand(list));

function readSub(p) {
  if (typeof p !== "string" || !SUB_EXT.has(path.extname(p).toLowerCase())) return null;
  try {
    const st = fs.statSync(p);
    if (!st.isFile() || st.size > 5 * 1024 * 1024) return null;
    return { name: path.basename(p), text: fs.readFileSync(p).toString("utf8") };
  } catch (e) { return null; }
}
ipcMain.handle("find-sub", (_e, p) => {
  if (typeof p !== "string") return null;
  try {
    const dir = path.dirname(p), base = path.basename(p, path.extname(p)).toLowerCase();
    const hit = fs.readdirSync(dir).sort(natural).find(n => {
      const e = path.extname(n).toLowerCase();
      return SUB_EXT.has(e) && path.basename(n, e).toLowerCase().startsWith(base);
    });
    return hit ? readSub(path.join(dir, hit)) : null;
  } catch (e) { return null; }
});
ipcMain.handle("sub-dialog", async () => {
  const r = await dialog.showOpenDialog(win, { title: "Choose a subtitle file", properties: ["openFile"], filters: [{ name: "Subtitles", extensions: ["srt", "vtt"] }] });
  return r.canceled || !r.filePaths[0] ? null : readSub(r.filePaths[0]);
});
ipcMain.handle("screenshot", async (_e, rect) => {
  try {
    const n = v => Math.max(0, Math.round(Number(v) || 0));
    const r = { x: n(rect && rect.x), y: n(rect && rect.y), width: n(rect && rect.width), height: n(rect && rect.height) };
    if (!r.width || !r.height || !win) return { ok: false };
    const img = await win.webContents.capturePage(r);
    const dir = path.join(app.getPath("pictures"), "Emma Media Player");
    fs.mkdirSync(dir, { recursive: true });
    const d = new Date(), z = x => String(x).padStart(2, "0");
    const file = path.join(dir, `Emma-${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}.png`);
    fs.writeFileSync(file, img.toPNG());
    return { ok: true, path: file };
  } catch (e) { return { ok: false }; }
});
