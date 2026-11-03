/* The only things the player screen is allowed to ask the computer for. */
"use strict";
const { contextBridge, ipcRenderer, webUtils } = require("electron");
let pathToFileURL = null;
try { pathToFileURL = require("url").pathToFileURL; } catch (e) { pathToFileURL = null; }

function toUrl(p) {
  p = String(p);
  try { if (pathToFileURL) return pathToFileURL(p).href; } catch (e) { /* use the fallback */ }
  let s = p.replace(/\\/g, "/");
  if (!s.startsWith("/")) s = "/" + s;
  return "file://" + s.split("/").map((x, i) => (i ? encodeURIComponent(x).replace(/%3A/i, ":") : x)).join("/");
}
contextBridge.exposeInMainWorld("emma", {
  toUrl,
  getPathForFile: f => { try { return webUtils.getPathForFile(f) || ""; } catch (e) { return ""; } },
  openDialog: () => ipcRenderer.invoke("open-dialog"),
  openFolder: () => ipcRenderer.invoke("open-folder"),
  initialFiles: () => ipcRenderer.invoke("initial-files"),
  expand: list => ipcRenderer.invoke("expand", list),
  findSub: p => ipcRenderer.invoke("find-sub", p),
  subDialog: () => ipcRenderer.invoke("sub-dialog"),
  screenshot: rect => ipcRenderer.invoke("screenshot", rect),
  onOpen: cb => ipcRenderer.on("open-files", (_e, list) => { try { cb(list); } catch (e) { /* ignore */ } })
});
