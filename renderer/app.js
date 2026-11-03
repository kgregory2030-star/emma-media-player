/* Emma Media Player: the player screen */
(function () {
"use strict";
const E = window.emma || {};
const $ = id => document.getElementById(id);
const v = $("v"), app = $("app"), stage = $("stage");
const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|weba)$/i;
const MEDIA_EXT = /\.(mp4|m4v|mov|mkv|webm|ogv|avi|wmv|mpg|mpeg|3gp|mp3|m4a|aac|wav|ogg|oga|opus|flac|weba)$/i;
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3];
const LS = {
  get(k, d) { try { const x = localStorage.getItem("emmaMP." + k); return x === null ? d : x; } catch (e) { return d; } },
  set(k, val) { try { localStorage.setItem("emmaMP." + k, val); } catch (e) { /* ignore */ } }
};

let list = [], idx = -1, rot = 0, fit = LS.get("fit", "contain"), repeat = LS.get("repeat", "off"), shuffle = LS.get("shuffle", "0") === "1";
let subUrl = "", subName = "", subOn = true, failRun = 0, dragging = false, played = new Set(), idleT = 0, toastT = 0, osdT = 0, lastSave = 0;

const baseName = p => String(p).split(/[\\/]/).pop();
const niceName = p => baseName(p).replace(/\.[^.]+$/, "");
const fmt = s => {
  if (!isFinite(s) || s < 0) s = 0; s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60, z = n => String(n).padStart(2, "0");
  return (h ? h + ":" + z(m) : m) + ":" + z(x);
};
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

/* ---------- small messages ---------- */
function osd(t) { const o = $("osd"); o.textContent = t; o.classList.add("show"); clearTimeout(osdT); osdT = setTimeout(() => o.classList.remove("show"), 1100); }
function toast(t, opt) {
  opt = opt || {};
  $("tmsg").textContent = t; $("toast").classList.toggle("err", !!opt.err);
  const b = $("tbtn");
  if (opt.btn) { b.textContent = opt.btn; b.onclick = () => { $("toast").classList.remove("show"); opt.fn && opt.fn(); }; b.classList.remove("hide"); } else b.classList.add("hide");
  $("toast").classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => $("toast").classList.remove("show"), opt.ms || 3500);
}

/* ---------- saved places (resume where you stopped) ---------- */
function posStore() { try { return JSON.parse(LS.get("pos", "{}")) || {}; } catch (e) { return {}; } }
function savePos(path, t, d) {
  const s = posStore(), k = path.toLowerCase();
  if (t > 10 && d && t < d - 10) s[k] = { t: Math.floor(t), at: Date.now() }; else delete s[k];
  const keys = Object.keys(s);
  if (keys.length > 200) keys.sort((a, b) => s[a].at - s[b].at).slice(0, keys.length - 200).forEach(x => delete s[x]);
  LS.set("pos", JSON.stringify(s));
}

/* ---------- picture layout and rotation ---------- */
function layout() {
  const w = stage.clientWidth, h = stage.clientHeight, sw = rot % 180 !== 0;
  v.style.width = (sw ? h : w) + "px"; v.style.height = (sw ? w : h) + "px";
  v.style.objectFit = fit;
  v.style.transform = "translate(-50%,-50%) rotate(" + rot + "deg)";
  $("b-rot").dataset.r = String(rot);
  $("b-fit").textContent = fit === "contain" ? "Fit" : "Fill";
  $("b-fit").classList.toggle("on", fit === "cover");
}
if (window.ResizeObserver) new ResizeObserver(layout).observe(stage); window.addEventListener("resize", layout);

/* ---------- the playlist ---------- */
function drawList() {
  const ul = $("items"); ul.textContent = "";
  list.forEach((it, i) => {
    const li = document.createElement("li"); li.className = (i === idx ? "cur " : "") + (it.failed ? "bad" : ""); li.dataset.i = i;
    const n = document.createElement("span"); n.className = "n"; n.textContent = i === idx ? "▶" : String(i + 1);
    const t = document.createElement("span"); t.className = "t"; t.textContent = niceName(it.path); t.title = it.path;
    const x = document.createElement("button"); x.type = "button"; x.className = "x"; x.textContent = "×"; x.title = "Remove"; x.setAttribute("aria-label", "Remove from the playlist");
    li.append(n, t, x); ul.appendChild(li);
  });
  $("lcount").textContent = list.length ? list.length + (list.length === 1 ? " file" : " files") : "";
  const cur = ul.querySelector(".cur"); if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest" });
}
$("items").addEventListener("click", e => {
  const li = e.target.closest("li"); if (!li) return; const i = +li.dataset.i;
  if (e.target.closest(".x")) removeAt(i); else play(i);
});
function removeAt(i) {
  list.splice(i, 1);
  if (i < idx) idx--; else if (i === idx) { stopPlayback(); idx = -1; if (list.length) { play(Math.min(i, list.length - 1)); return; } }
  drawList(); showEmpty();
}
function stopPlayback() { try { v.pause(); } catch (e) { /* ignore */ } v.removeAttribute("src"); v.load(); clearSub(); document.title = "Emma Media Player"; app.classList.remove("playing"); }
function showEmpty() { const none = !list.length || idx < 0; $("empty").classList.toggle("hide", !none); if (none) { $("viz").classList.add("hide"); } }

/* ---------- adding files ---------- */
async function addPaths(paths, opt) {
  opt = opt || {};
  let ps = (paths || []).filter(p => typeof p === "string" && MEDIA_EXT.test(p));
  if (!ps.length) { toast("No video or music files found there.", { err: true }); return; }
  const had = list.length, seen = new Set(list.map(i => i.path));
  ps.forEach(p => { if (!seen.has(p)) { seen.add(p); list.push({ path: p, failed: false }); } });
  drawList();
  if (opt.replace || idx < 0) { const first = opt.replace ? had : (had || 0); play(first < list.length ? first : 0); }
  else toast("Added " + (list.length - had) + " to the playlist.");
}
async function openFiles() { try { const p = await E.openDialog(); if (p && p.length) addPaths(p); } catch (e) { toast("Could not open files.", { err: true }); } }
async function openFolder() { try { const p = await E.openFolder(); if (p && p.length) addPaths(p); else if (p) toast("No video or music files in that folder.", { err: true }); } catch (e) { /* ignore */ } }

/* ---------- playing ---------- */
function nextIndex(dir) {
  if (!list.length) return -1;
  if (shuffle && dir > 0 && list.length > 1) {
    const left = list.map((_, i) => i).filter(i => !played.has(i) && i !== idx);
    if (!left.length) { if (repeat === "all") { played = new Set([idx]); return nextIndex(1); } return -1; }
    return left[Math.floor(Math.random() * left.length)];
  }
  let n = idx + dir;
  if (n >= list.length) return repeat === "all" ? 0 : -1;
  if (n < 0) return repeat === "all" ? list.length - 1 : 0;
  return n;
}
function play(i, opt) {
  if (i < 0 || i >= list.length) return;
  idx = i; played.add(i); const it = list[i];
  rot = 0; layout(); clearSub();
  v.src = E.toUrl ? E.toUrl(it.path) : it.path;
  v.playbackRate = curSpeed(); v.volume = clamp(+$("vol").value / 100, 0, 1); v.muted = LS.get("muted", "0") === "1";
  it.resume = !(opt && opt.fresh);
  const pr = v.play(); if (pr && pr.catch) pr.catch(() => {});
  document.title = niceName(it.path) + " - Emma Media Player";
  $("empty").classList.add("hide");
  $("viz").classList.toggle("hide", !AUDIO_EXT.test(it.path)); $("vname").textContent = niceName(it.path);
  drawList(); autoSub(it.path);
}
function curSpeed() { return +LS.get("speed", "1") || 1; }
function togglePlay() {
  if (idx < 0) { if (list.length) play(0); else openFiles(); return; }
  if (v.paused) { const pr = v.play(); if (pr && pr.catch) pr.catch(() => {}); } else v.pause();
}
function seekBy(s) { if (idx < 0 || !isFinite(v.duration)) return; v.currentTime = clamp(v.currentTime + s, 0, v.duration); osd((s > 0 ? "+" : "") + s + " s"); }
function goNext(dir) { const n = nextIndex(dir); if (n >= 0) play(n); else if (dir > 0) { stopPlayback(); idx = -1; played = new Set(); drawList(); toast("That was the last file."); showEmpty(); } }

v.addEventListener("play", () => app.classList.add("playing"));
v.addEventListener("pause", () => app.classList.remove("playing"));
v.addEventListener("loadedmetadata", () => {
  failRun = 0;
  const it = list[idx]; if (!it) return;
  if (v.videoWidth === 0 && !AUDIO_EXT.test(it.path)) $("viz").classList.remove("hide");
  if (v.videoWidth > 0) $("viz").classList.add("hide");
  $("dur").textContent = fmt(v.duration);
  if (it.resume) {
    const s = posStore()[it.path.toLowerCase()];
    if (s && s.t > 10 && s.t < v.duration - 10) { v.currentTime = s.t; toast("Continuing from " + fmt(s.t), { btn: "Start over", fn: () => { v.currentTime = 0; }, ms: 5000 }); }
  }
  layout();
});
v.addEventListener("timeupdate", () => {
  if (!dragging) { const d = v.duration; $("seek").value = d ? Math.round(v.currentTime / d * 1000) : 0; paintSeek(); }
  $("cur").textContent = fmt(v.currentTime);
  const now = Date.now();
  if (now - lastSave > 3000 && list[idx] && isFinite(v.duration)) { lastSave = now; savePos(list[idx].path, v.currentTime, v.duration); }
});
v.addEventListener("durationchange", () => { $("dur").textContent = fmt(v.duration); });
v.addEventListener("ended", () => {
  if (list[idx]) savePos(list[idx].path, 0, 0);
  if (repeat === "one") { v.currentTime = 0; const pr = v.play(); if (pr && pr.catch) pr.catch(() => {}); return; }
  goNext(1);
});
v.addEventListener("error", () => {
  const it = list[idx]; if (!it || !v.getAttribute("src")) return;
  it.failed = true; failRun++; drawList();
  const c = v.error && v.error.code;
  toast(c === 4 ? "Emma cannot play this file yet: " + niceName(it.path) + ". Its format is not supported in this version."
    : "Emma could not play this file: " + niceName(it.path) + ".", { err: true, ms: 5000 });
  if (list.length > 1 && failRun < list.length) setTimeout(() => { if (list[idx] === it) goNext(1); }, 2200);
});
v.addEventListener("volumechange", () => { app.classList.toggle("muted", v.muted || v.volume === 0); });
v.addEventListener("click", () => { if (idx >= 0) togglePlay(); });
v.addEventListener("dblclick", toggleFull);
$("viz").addEventListener("click", () => { if (idx >= 0) togglePlay(); });

/* ---------- the seek bar and volume ---------- */
function paintSeek() { const s = $("seek"); s.style.setProperty("--p", (+s.value / 10) + "%"); }
function paintVol() { const s = $("vol"); s.style.setProperty("--p", s.value + "%"); }
$("seek").addEventListener("input", () => { dragging = true; paintSeek(); if (isFinite(v.duration)) { const t = +$("seek").value / 1000 * v.duration; $("cur").textContent = fmt(t); } });
$("seek").addEventListener("change", () => { if (isFinite(v.duration)) v.currentTime = +$("seek").value / 1000 * v.duration; dragging = false; });
$("vol").addEventListener("input", () => { const x = +$("vol").value; v.volume = x / 100; if (x > 0) { v.muted = false; LS.set("muted", "0"); } LS.set("vol", String(x)); paintVol(); osd("Volume " + x + "%"); });
function setVol(x) { x = clamp(Math.round(x), 0, 100); $("vol").value = x; $("vol").dispatchEvent(new Event("input")); }
function toggleMute() { v.muted = !v.muted; LS.set("muted", v.muted ? "1" : "0"); osd(v.muted ? "Muted" : "Sound on"); }

/* ---------- speed, rotate, fit ---------- */
function setSpeed(s) { s = clamp(s, 0.25, 3); LS.set("speed", String(s)); v.playbackRate = s; $("b-speed").textContent = s + "x"; $("b-speed").classList.toggle("on", s !== 1); osd("Speed " + s + "x"); drawSpeed(); }
function stepSpeed(d) { let i = SPEEDS.indexOf(curSpeed()); if (i < 0) i = 3; setSpeed(SPEEDS[clamp(i + d, 0, SPEEDS.length - 1)]); }
function drawSpeed() {
  const m = $("speedmenu"); m.textContent = "";
  SPEEDS.slice().reverse().forEach(s => { const b = document.createElement("button"); b.type = "button"; b.textContent = s + "x"; b.className = s === curSpeed() ? "cur" : ""; b.onclick = () => { setSpeed(s); m.classList.add("hide"); }; m.appendChild(b); });
}
$("b-speed").onclick = e => { e.stopPropagation(); drawSpeed(); $("speedmenu").classList.toggle("hide"); };
document.addEventListener("click", e => { if (!e.target.closest("#eq") && e.target.id !== "b-eq") $("eq").classList.add("hide"); if (!e.target.closest("#speedmenu") && e.target.id !== "b-speed") $("speedmenu").classList.add("hide"); });
function rotate() { rot = (rot + 90) % 360; layout(); osd("Rotated " + rot + "°"); }
function toggleFit() { fit = fit === "contain" ? "cover" : "contain"; LS.set("fit", fit); layout(); osd(fit === "contain" ? "Fit to screen" : "Fill the screen"); }

/* ---------- subtitles ---------- */
function srtToVtt(t) {
  t = String(t).replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();
  if (/^WEBVTT/.test(t)) return t;
  return "WEBVTT\n\n" + t.replace(/(\d{1,2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
}
function clearSub() {
  v.querySelectorAll("track").forEach(t => t.remove());
  if (subUrl) { URL.revokeObjectURL(subUrl); subUrl = ""; }
  subName = ""; $("b-sub").classList.remove("on");
}
function setSub(sub) {
  if (!sub || !sub.text) return false;
  clearSub();
  subUrl = URL.createObjectURL(new Blob([srtToVtt(sub.text)], { type: "text/vtt" })); subName = sub.name || "subtitles";
  const tr = document.createElement("track"); tr.kind = "subtitles"; tr.label = subName; tr.srclang = "en"; tr.src = subUrl; tr.default = true;
  v.appendChild(tr); subOn = true;
  const show = () => { if (v.textTracks[0]) v.textTracks[0].mode = subOn ? "showing" : "hidden"; };
  tr.addEventListener("load", show); setTimeout(show, 200);
  $("b-sub").classList.add("on"); return true;
}
async function autoSub(path) { try { if (E.findSub) { const s = await E.findSub(path); if (s && list[idx] && list[idx].path === path && setSub(s)) toast("Subtitles: " + s.name); } } catch (e) { /* ignore */ } }
async function chooseSub() { try { const s = await E.subDialog(); if (s) { if (setSub(s)) toast("Subtitles: " + s.name); else toast("That subtitle file is empty.", { err: true }); } } catch (e) { /* ignore */ } }
function toggleSub() {
  if (!subUrl) { chooseSub(); return; }
  subOn = !subOn; if (v.textTracks[0]) v.textTracks[0].mode = subOn ? "showing" : "hidden";
  $("b-sub").classList.toggle("on", subOn); osd(subOn ? "Subtitles on" : "Subtitles off");
}
$("b-sub").addEventListener("click", e => { if (e.shiftKey) chooseSub(); else toggleSub(); });

/* ---------- picture of this moment ---------- */
async function shot() {
  if (idx < 0 || v.videoWidth === 0) { toast("Open a video first to save a picture.", { err: true }); return; }
  const hide = [$("toast"), $("osd")]; hide.forEach(x => x.classList.add("hide"));
  const r = stage.getBoundingClientRect();
  await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
  let out = null; try { out = await E.screenshot({ x: r.left, y: r.top, width: r.width, height: r.height }); } catch (e) { out = null; }
  hide.forEach(x => x.classList.remove("hide"));
  if (out && out.ok) toast("Picture saved in Pictures, in the folder Emma Media Player."); else toast("Could not save the picture.", { err: true });
}

/* ---------- repeat, shuffle, full screen ---------- */
function setRepeat(m) { repeat = m; LS.set("repeat", m); osd("Repeat: " + (m === "off" ? "off" : m === "all" ? "all files" : "this file")); }
function toggleFull() { if (document.fullscreenElement) document.exitFullscreen(); else app.requestFullscreen && app.requestFullscreen().catch(() => {}); }
document.addEventListener("fullscreenchange", () => { app.classList.toggle("fs", !!document.fullscreenElement); app.classList.remove("idle"); layout(); setTimeout(layout, 120); });
function wake() { app.classList.remove("idle"); clearTimeout(idleT); if (document.fullscreenElement) idleT = setTimeout(() => { if (!v.paused) app.classList.add("idle"); }, 2800); }
document.addEventListener("mousemove", wake);

/* ---------- the buttons ---------- */
$("b-open").onclick = openFiles; $("e-open").onclick = openFiles; $("e-folder").onclick = openFolder; $("l-add").onclick = openFiles;
$("b-play").onclick = togglePlay; $("b-prev").onclick = () => { if (v.currentTime > 4) { v.currentTime = 0; } else goNext(-1); };
$("b-next").onclick = () => goNext(1); $("b-back").onclick = () => seekBy(-10); $("b-fwd").onclick = () => seekBy(10);
$("b-mute").onclick = toggleMute; $("b-rot").onclick = rotate; $("b-fit").onclick = toggleFit; $("b-shot").onclick = shot; $("b-full").onclick = toggleFull;
$("b-list").onclick = () => { $("list").classList.toggle("hide"); $("b-list").classList.toggle("on", !$("list").classList.contains("hide")); layout(); };
$("l-clear").onclick = () => { list = []; idx = -1; played = new Set(); stopPlayback(); drawList(); showEmpty(); };
$("b-help").onclick = () => $("help").classList.remove("hide"); $("hx").onclick = () => $("help").classList.add("hide");
$("help").addEventListener("click", e => { if (e.target.id === "help") $("help").classList.add("hide"); });
document.addEventListener("mouseup", e => { const b = e.target.closest && e.target.closest("button"); if (b) setTimeout(() => b.blur(), 0); });
document.addEventListener("pointerup", e => { if (e.target && e.target.type === "range") setTimeout(() => e.target.blur(), 0); });

/* repeat and shuffle live on the playlist header and the keyboard */
(function addModeButtons() {
  const h = document.querySelector(".lh");
  const sh = document.createElement("button"); sh.type = "button"; sh.className = "sm"; sh.id = "l-shuf"; sh.textContent = "Shuffle"; sh.title = "Shuffle (X)";
  const rp = document.createElement("button"); rp.type = "button"; rp.className = "sm"; rp.id = "l-rep"; rp.title = "Repeat (Y)";
  h.insertBefore(rp, $("l-add")); h.insertBefore(sh, rp);
  const draw = () => { sh.textContent = "Shuffle: " + (shuffle ? "on" : "off"); rp.textContent = "Repeat: " + (repeat === "off" ? "off" : repeat === "all" ? "all" : "one"); };
  sh.onclick = () => { shuffle = !shuffle; LS.set("shuffle", shuffle ? "1" : "0"); played = new Set(idx >= 0 ? [idx] : []); draw(); osd("Shuffle " + (shuffle ? "on" : "off")); };
  rp.onclick = () => { setRepeat(repeat === "off" ? "all" : repeat === "all" ? "one" : "off"); draw(); };
  window.__drawModes = draw; draw();
})();

/* ---------- equalizer ---------- */
const FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const FLABEL = ["31", "62", "125", "250", "500", "1k", "2k", "4k", "8k", "16k"];
const PRESETS = {
  "Flat": [0, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  "Bass boost": [-4, [7, 6, 5, 3, 1, 0, 0, 0, 0, 0]],
  "Bass cut": [0, [-6, -5, -4, -2, -1, 0, 0, 0, 0, 0]],
  "Treble boost": [-3, [0, 0, 0, 0, 0, 1, 3, 5, 6, 7]],
  "Vocal": [-2, [-3, -3, -2, 0, 3, 4, 4, 2, 0, -1]],
  "Speech": [-2, [-6, -5, -3, 0, 3, 5, 5, 3, 1, -2]],
  "Rock": [-3, [5, 4, 2, -1, -2, 0, 2, 4, 5, 5]],
  "Pop": [-2, [-1, 1, 3, 4, 3, 0, -1, -1, 1, 2]],
  "Jazz": [-2, [3, 2, 1, 2, -2, -2, 0, 1, 2, 3]],
  "Classical": [-1, [4, 3, 2, 1, -1, -1, 0, 2, 3, 4]],
  "Party": [-4, [6, 5, 2, 0, 0, 0, 0, 2, 5, 6]],
  "Small speakers": [-3, [6, 5, 4, 2, 0, 0, 0, 1, 2, 3]]
};
let ac = null, eqPre = null, eqFilters = [], eqSrc = null, eqBroken = false;
let eqState = (function () {
  try { const s = JSON.parse(LS.get("eq", "")); if (s && Array.isArray(s.g) && s.g.length === 10) return { on: !!s.on, pre: +s.pre || 0, g: s.g.map(x => clamp(+x || 0, -12, 12)), preset: String(s.preset || "Flat") }; } catch (e) { /* use flat */ }
  return { on: false, pre: 0, g: new Array(10).fill(0), preset: "Flat" };
})();
const saveEq = () => LS.set("eq", JSON.stringify(eqState));

function eqGraph() {
  if (eqBroken) return false;
  if (ac) return true;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    ac = new AC(); eqSrc = ac.createMediaElementSource(v);
    eqPre = ac.createGain();
    eqFilters = FREQS.map((f, i) => { const b = ac.createBiquadFilter(); b.type = i === 0 ? "lowshelf" : i === 9 ? "highshelf" : "peaking"; b.frequency.value = f; b.Q.value = 1.1; b.gain.value = 0; return b; });
    eqSrc.connect(eqPre); let n = eqPre; eqFilters.forEach(f => { n.connect(f); n = f; }); n.connect(ac.destination);
    eqApply(); return true;
  } catch (e) { eqBroken = true; ac = null; eqNote("The equalizer could not start on this computer.", true); return false; }
}
function eqApply() {
  if (!ac) return;
  const on = eqState.on, t = ac.currentTime;
  eqPre.gain.setTargetAtTime(on ? Math.pow(10, eqState.pre / 20) : 1, t, 0.02);
  eqFilters.forEach((f, i) => f.gain.setTargetAtTime(on ? eqState.g[i] : 0, t, 0.02));
}
function eqNote(t, err) { const n = $("eq-note"); n.textContent = t || ""; n.classList.toggle("err", !!err); }
function eqDraw() {
  const box = $("eq-bands"); box.textContent = "";
  const mk = (label, val, min, max, cb, cls) => {
    const c = document.createElement("div"); c.className = "eqc" + (cls ? " " + cls : "");
    const d = document.createElement("span"); d.className = "db";
    const r = document.createElement("input"); r.type = "range"; r.min = min; r.max = max; r.step = 0.5; r.value = val; r.setAttribute("aria-label", label);
    const l = document.createElement("span"); l.textContent = label;
    const show = () => { d.textContent = (+r.value > 0 ? "+" : "") + (+r.value) + " dB"; };
    r.addEventListener("input", () => { cb(+r.value); show(); });
    r.addEventListener("dblclick", () => { r.value = 0; r.dispatchEvent(new Event("input")); });
    show(); c.append(d, r, l); box.appendChild(c); return r;
  };
  mk("Pre-amp", eqState.pre, -12, 12, x => { eqState.pre = x; eqChanged(); }, "pre");
  FREQS.forEach((_, i) => mk(FLABEL[i], eqState.g[i], -12, 12, x => { eqState.g[i] = x; eqChanged(); }));
  const sel = $("eq-pre"); sel.textContent = "";
  const names = Object.keys(PRESETS).concat(["Custom"]);
  names.forEach(n => { const o = document.createElement("option"); o.textContent = n; o.value = n; sel.appendChild(o); });
  sel.value = names.includes(eqState.preset) ? eqState.preset : "Custom";
  $("eq-on").textContent = eqState.on ? "On" : "Off"; $("eq-on").classList.toggle("on", eqState.on);
  $("b-eq").classList.toggle("on", eqState.on);
}
function eqChanged() {
  eqState.preset = "Custom"; $("eq-pre").value = "Custom";
  if (!eqState.on) { eqState.on = true; $("eq-on").textContent = "On"; $("eq-on").classList.add("on"); $("b-eq").classList.add("on"); }
  if (eqGraph()) eqApply(); saveEq();
}
function eqSetPreset(n) {
  if (n === "Custom") return;
  const p = PRESETS[n]; if (!p) return;
  eqState.pre = p[0]; eqState.g = p[1].slice(); eqState.preset = n; if (n !== "Flat") eqState.on = true;
  eqDraw(); if (eqGraph()) eqApply(); saveEq(); osd("Equalizer: " + n);
}
function eqToggle() {
  eqState.on = !eqState.on; if (eqGraph()) eqApply(); saveEq(); eqDraw(); osd("Equalizer " + (eqState.on ? "on" : "off"));
}
function eqOpen(show) {
  const p = $("eq"); const open = show === undefined ? p.classList.contains("hide") : show;
  p.classList.toggle("hide", !open);
  if (open) { eqDraw(); eqGraph(); if (ac && ac.state === "suspended") ac.resume().catch(() => {}); }
}
$("b-eq").onclick = e => { e.stopPropagation(); eqOpen(); };
$("eq-x").onclick = () => eqOpen(false);
$("eq-on").onclick = eqToggle;
$("eq-reset").onclick = () => eqSetPreset("Flat");
$("eq-pre").onchange = () => eqSetPreset($("eq-pre").value);
$("eq").addEventListener("click", e => e.stopPropagation());
v.addEventListener("play", () => { if (ac && ac.state === "suspended") ac.resume().catch(() => {}); });
/* if the equalizer was left on last time, start it quietly with the first file */
v.addEventListener("loadstart", () => { if (eqState.on && !ac && !eqBroken) eqGraph(); });
/* safety: if sound goes silent right after the equalizer starts, say so instead of failing quietly */
let silentCheck = 0;
v.addEventListener("playing", () => {
  if (!ac || eqBroken) return;
  const an = ac.createAnalyser(); an.fftSize = 256; eqFilters[9].connect(an);
  const buf = new Uint8Array(an.fftSize); let ticks = 0, heard = false; clearInterval(silentCheck);
  silentCheck = setInterval(() => {
    an.getByteTimeDomainData(buf); for (let i = 0; i < buf.length; i++) if (Math.abs(buf[i] - 128) > 1) { heard = true; break; }
    if (heard || v.paused || v.muted || v.volume === 0 || ++ticks > 12) {
      clearInterval(silentCheck); try { eqFilters[9].disconnect(an); } catch (e) { /* ignore */ }
      if (!heard && !v.paused && !v.muted && v.volume > 0 && ticks > 12) eqNote("No sound is coming through the equalizer. Please tell Emma support.", true);
    }
  }, 250);
});

/* ---------- the keyboard ---------- */
document.addEventListener("keydown", e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  if (k !== "Escape" && e.target && e.target.closest && e.target.closest("#eq")) return;
  if (k === "Escape") { if (!$("help").classList.contains("hide")) { $("help").classList.add("hide"); e.preventDefault(); } else if (!$("eq").classList.contains("hide")) { eqOpen(false); e.preventDefault(); } $("speedmenu").classList.add("hide"); return; }
  if (!$("help").classList.contains("hide")) return;
  let h = true;
  switch (k) {
    case " ": case "k": case "K": togglePlay(); break;
    case "ArrowLeft": seekBy(-5); break;
    case "ArrowRight": seekBy(5); break;
    case "j": case "J": seekBy(-10); break;
    case "l": case "L": seekBy(10); break;
    case "ArrowUp": setVol(+$("vol").value + 5); break;
    case "ArrowDown": setVol(+$("vol").value - 5); break;
    case "m": case "M": toggleMute(); break;
    case "f": case "F": toggleFull(); break;
    case "r": case "R": rotate(); break;
    case "z": case "Z": toggleFit(); break;
    case "s": case "S": if (e.shiftKey) chooseSub(); else toggleSub(); break;
    case "c": case "C": shot(); break;
    case "[": stepSpeed(-1); break;
    case "]": stepSpeed(1); break;
    case "n": case "N": goNext(1); break;
    case "p": case "P": goNext(-1); break;
    case "o": case "O": openFiles(); break;
    case "e": case "E": eqOpen(); break;
    case "t": case "T": $("b-list").click(); break;
    case "x": case "X": $("l-shuf").click(); break;
    case "y": case "Y": $("l-rep").click(); break;
    case "?": $("help").classList.remove("hide"); break;
    default: h = false;
  }
  if (h) { e.preventDefault(); wake(); }
}, true);

/* ---------- drag and drop, and "open with" from Windows ---------- */
["dragenter", "dragover"].forEach(t => document.addEventListener(t, e => { e.preventDefault(); app.classList.add("dragging"); }));
["dragleave", "drop"].forEach(t => document.addEventListener(t, e => { e.preventDefault(); if (t === "drop" || e.target === document.documentElement || !e.relatedTarget) app.classList.remove("dragging"); }));
document.addEventListener("drop", async e => {
  const files = e.dataTransfer ? [...e.dataTransfer.files] : [];
  const ps = files.map(f => (E.getPathForFile ? E.getPathForFile(f) : "")).filter(Boolean);
  if (!ps.length) return;
  try { const exp = E.expand ? await E.expand(ps) : ps; addPaths(exp && exp.length ? exp : ps, { replace: !list.length ? false : false }); } catch (x) { addPaths(ps); }
});
if (E.onOpen) E.onOpen(p => { if (p && p.length) addPaths(p, { replace: true }); });
(async function start() {
  $("vol").value = LS.get("vol", "100"); paintVol(); paintSeek(); layout(); $("b-speed").textContent = curSpeed() + "x"; $("b-speed").classList.toggle("on", curSpeed() !== 1);
  v.muted = LS.get("muted", "0") === "1"; app.classList.toggle("muted", v.muted);
  try { const f = E.initialFiles ? await E.initialFiles() : []; if (f && f.length) addPaths(f); } catch (e) { /* ignore */ }
})();
window.__emmaTest = { get ac() { return ac; }, get filters() { return eqFilters; }, get pre() { return eqPre; }, get eq() { return eqState; }, get acState() { return ac && ac.state; }, get list() { return list; }, get idx() { return idx; }, get rot() { return rot; } };
})();
