import { createAppState } from "./state/app-state.js";
import { createHardwareState } from "./state/hardware-state.js";
import { createCenterRegistry } from "./centers/center-registry.js";
import { createCenterRenderer, ACTIVE_CENTER_MODES } from "./centers/center-renderer.js";
import { createLightingEngine } from "./lighting/lighting-engine.js";
import { createPlaylistEngine } from "./playlist/playlist-engine.js";
import { createComponentMapDebug } from "./mapping/component-map-debug.js";
import { createTargetProof } from "./mapping/target-proof.js";
import { createAudioFrameEngine } from "./audio/audio-frame-engine.js";
import { SpeakerPhysicsController } from "./audio/speaker-physics-controller.js";
import { createAudioReactiveRenderer } from "./audio/audio-reactive-renderer.js";
import { createHardwareControls } from "./hardware/hardware-controls.js";
import { createNextDebug } from "./diagnostics/next-debug.js";

const $ = selector => document.querySelector(selector);
const shell = $(".console-shell");
const audio = $("#audio-player");
const appState = createAppState();
const hardwareState = createHardwareState();
const centers = createCenterRegistry();
const renderer = createCenterRenderer($("#center-surface"));
const audioFrame = createAudioFrameEngine(audio);
const physics = new SpeakerPhysicsController();
const reactiveRenderer = createAudioReactiveRenderer($("#audio-reactive-surface"), shell, physics);
const lighting = createLightingEngine($("#lighting-surface"), appState);
const mapDebug = createComponentMapDebug($("#component-map-debug"), shell);
const targetProof = createTargetProof($("#target-proof-surface"), shell, $("#target-proof-readout"));

const lightingPanel = $("#lighting-panel");
const lightingButton = $("#lights-button");
const settingsPanel = $("#settings-panel");
const settingsButton = $("#settings-button");
const playlistPanel = $("#playlist-panel");
const picker = $("#track-picker");
const debugPanel = $("#component-map-debug-panel");
const proofPanel = $("#target-proof-panel");
const nextDebugPanel = $("#next-debug-panel");
const centerButton = $("#center-button");
const centerPanel = $("#center-panel");
const centerModes = [...document.querySelectorAll("[data-center-mode]")];
const hardwareReadout = $("#hardware-readout");
const CENTER_STORAGE_KEY = "lumir-v2-center-mode";
const PORTAL_STORAGE_KEY = "lumir-v2-cosmic-portal";
let nextDebug = null;
const time = value => Number.isFinite(value) ? `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}` : "--:--";
const clamp = value => Math.min(1, Math.max(0, value));

const lightingFields = {
  speakerEnabled: "speaker-enabled", mode: "speaker-mode", staticColor: "static-color", cycleSeconds: "cycle-seconds",
  brightness: "brightness", activityEnabled: "activity-enabled", activityAmount: "activity-amount", centerStandby: "center-standby", bassGlow: "bass-glow"
};
const syncLighting = state => {
  Object.entries(lightingFields).forEach(([key, id]) => {
    const field = $(`#${id}`);
    field.type === "checkbox" ? field.checked = state[key] : field.value = state[key];
  });
  $("#cycle-value").value = `${state.cycleSeconds}s`;
  $("#brightness-value").value = `${state.brightness}%`;
  $("#activity-value").value = `${state.activityAmount}%`;
};
lightingButton.addEventListener("click", () => { lightingPanel.hidden = !lightingPanel.hidden; lightingButton.setAttribute("aria-expanded", String(!lightingPanel.hidden)); });
$("#lights-close").addEventListener("click", () => { lightingPanel.hidden = true; lightingButton.setAttribute("aria-expanded", "false"); });
Object.entries(lightingFields).forEach(([key, id]) => $("#" + id).addEventListener("input", event => {
  const value = event.target.type === "checkbox" ? event.target.checked : Number.isNaN(Number(event.target.value)) ? event.target.value : Number(event.target.value);
  appState.updateLighting({ [key]: value });
}));
appState.subscribeLighting(syncLighting);
syncLighting(appState.getLighting());

const physicsFields = {
  subForce: "physics-sub-force", wooferForce: "physics-woofer-force", midForce: "physics-mid-force", attack: "physics-attack",
  release: "physics-release", spring: "physics-spring", damping: "physics-damping", maxExcursion: "physics-max-excursion"
};
const mixerFields = { master: "mixer-master", left: "mixer-left", right: "mixer-right", crossfader: "mixer-crossfader", low: "mixer-low", mid: "mixer-mid", high: "mixer-high", mute: "mixer-mute" };
let hardwareSettings = hardwareState.get();
const formatPhysics = value => `${Number(value).toFixed(2)}×`;
const formatMixer = (key, value) => key === "low" || key === "mid" || key === "high" ? `${value >= 0 ? "+" : ""}${Number(value).toFixed(1)} dB` : key === "crossfader" ? `${Math.round(value * 100)}` : `${Math.round(value * 100)}%`;
const syncHardware = state => {
  hardwareSettings = state;
  audioFrame.setMixer(state.mixer);
  physics.setTuning(state.physics);
  Object.entries(physicsFields).forEach(([key, id]) => { $(`#${id}`).value = state.physics[key]; $(`#${id}-value`).value = formatPhysics(state.physics[key]); });
  Object.entries(mixerFields).forEach(([key, id]) => {
    const field = $(`#${id}`);
    field.type === "checkbox" ? field.checked = state.mixer[key] : field.value = state.mixer[key];
    const output = $(`#${id}-value`); if (output) output.value = formatMixer(key, state.mixer[key]);
  });
};
Object.entries(physicsFields).forEach(([key, id]) => $("#" + id).addEventListener("input", event => hardwareState.updatePhysics({ [key]: Number(event.target.value) })));
Object.entries(mixerFields).forEach(([key, id]) => $("#" + id).addEventListener("input", event => hardwareState.updateMixer({ [key]: event.target.type === "checkbox" ? event.target.checked : Number(event.target.value) })));
hardwareState.subscribe(syncHardware);
syncHardware(hardwareSettings);
settingsButton.addEventListener("click", () => { settingsPanel.hidden = !settingsPanel.hidden; settingsButton.setAttribute("aria-expanded", String(!settingsPanel.hidden)); });
$("#settings-close").addEventListener("click", () => { settingsPanel.hidden = true; settingsButton.setAttribute("aria-expanded", "false"); });
$("#hardware-reset").addEventListener("click", () => hardwareState.reset());

function renderPlaylist(state) {
  $("#play-button").textContent = state.playing ? "PAUSE" : "PLAY";
  $("#repeat-button").textContent = `REPEAT: ${state.repeat.toUpperCase()}`;
  $("#shuffle-button").classList.toggle("is-active", state.shuffle);
  const current = state.tracks.find(track => track.id === state.currentId);
  $("#track-readout").textContent = current ? `${current.name} · ${time(state.currentTime)} / ${time(state.duration || current.duration)}` : "NO TRACK LOADED · 00:00 / 00:00";
  $("#playlist-empty").hidden = state.tracks.length > 0;
  const list = $("#playlist-items");
  list.replaceChildren(...state.tracks.map(track => {
    const item = document.createElement("li");
    item.className = `playlist-track ${track.id === state.currentId ? "is-current" : ""}`;
    item.innerHTML = `<button class="track-main" data-play="${track.id}"><b>${track.id === state.currentId ? "● " : ""}${track.name}</b><small>${time(track.duration)}</small></button><div><button data-next="${track.id}">${track.id === state.queuedId ? "QUEUED" : "PLAY NEXT"}</button><button data-up="${track.id}">↑</button><button data-down="${track.id}">↓</button><button data-remove="${track.id}">REMOVE</button></div>`;
    return item;
  }));
}

const playlist = createPlaylistEngine({ audio, onChange: renderPlaylist, beforePlay: () => audioFrame.resume(), onTransition: event => nextDebug?.transition(event) });
$("#load-button").onclick = () => picker.click();
$("#playlist-add").onclick = () => picker.click();
picker.onchange = () => { playlist.addFiles(picker.files); picker.value = ""; };
$("#play-button").onclick = playlist.playPause;
$("#next-button").onclick = playlist.next;
$("#prev-button").onclick = playlist.prev;
$("#repeat-button").onclick = playlist.toggleRepeat;
$("#shuffle-button").onclick = playlist.toggleShuffle;
$("#playlist-clear").onclick = playlist.clear;
$("#playlist-button").onclick = () => { playlistPanel.hidden = !playlistPanel.hidden; $("#playlist-button").setAttribute("aria-expanded", String(!playlistPanel.hidden)); };
$("#playlist-close").onclick = () => { playlistPanel.hidden = true; $("#playlist-button").setAttribute("aria-expanded", "false"); };
$("#playlist-items").onclick = event => {
  const button = event.target.closest("button");
  if (!button) return;
  const id = button.dataset.play || button.dataset.next || button.dataset.up || button.dataset.down || button.dataset.remove;
  if (button.dataset.play) playlist.select(id, true);
  if (button.dataset.next) playlist.queue(id);
  if (button.dataset.up) playlist.move(id, -1);
  if (button.dataset.down) playlist.move(id, 1);
  if (button.dataset.remove) playlist.remove(id);
};
document.addEventListener("dragover", event => { if (event.dataTransfer?.types.includes("Files")) { event.preventDefault(); document.body.classList.add("is-dropping"); } });
document.addEventListener("dragleave", () => document.body.classList.remove("is-dropping"));
document.addEventListener("drop", event => { if (event.dataTransfer?.files?.length) { event.preventDefault(); document.body.classList.remove("is-dropping"); playlist.addFiles(event.dataTransfer.files); } });

const portalFields = {
  depth: "center-depth", bassReaction: "center-bass-reaction", particleAmount: "center-particle-amount",
  glow: "center-glow", rotation: "center-rotation", nebulaIntensity: "center-nebula-intensity"
};
const syncPortalSettings = settings => Object.entries(portalFields).forEach(([key, id]) => {
  const field = $(`#${id}`); const output = $(`#${id}-value`);
  field.value = settings[key]; output.value = `${Math.round(settings[key] * 100)}%`;
});
const storedPortal = (() => {
  try { return JSON.parse(localStorage.getItem(PORTAL_STORAGE_KEY) || "null"); } catch { return null; }
})();
syncPortalSettings(renderer.setPortalSettings(storedPortal && typeof storedPortal === "object" ? storedPortal : {}));
Object.entries(portalFields).forEach(([key, id]) => $("#" + id).addEventListener("input", event => {
  const settings = renderer.setPortalSettings({ [key]: Number(event.target.value) });
  syncPortalSettings(settings);
  try { localStorage.setItem(PORTAL_STORAGE_KEY, JSON.stringify(settings)); } catch {}
}));

const storedCenter = (() => { try { return localStorage.getItem(CENTER_STORAGE_KEY); } catch { return null; } })();
const selectCenter = mode => {
  if (!centers.has(mode) || !ACTIVE_CENTER_MODES.includes(mode)) return;
  renderer.setMode(mode);
  centerModes.forEach(button => button.classList.toggle("is-selected", button.dataset.centerMode === mode));
  try { localStorage.setItem(CENTER_STORAGE_KEY, mode); } catch {}
};
const openCenterPanel = () => { centerPanel.hidden = false; centerButton.setAttribute("aria-expanded", "true"); };
selectCenter(ACTIVE_CENTER_MODES.includes(storedCenter) ? storedCenter : "subwoofer");
centerButton.addEventListener("click", () => { centerPanel.hidden ? openCenterPanel() : (centerPanel.hidden = true, centerButton.setAttribute("aria-expanded", "false")); });
$("#center-close").addEventListener("click", () => { centerPanel.hidden = true; centerButton.setAttribute("aria-expanded", "false"); });
centerPanel.addEventListener("click", event => {
  const button = event.target.closest("[data-center-mode]");
  if (!button) return;
  selectCenter(button.dataset.centerMode); centerPanel.hidden = true; centerButton.setAttribute("aria-expanded", "false");
});

const hardware = createHardwareControls({
  inputSurface: $("#hardware-input-surface"), feedbackCanvas: $("#hardware-feedback-surface"), shell, playlist, audio,
  getMixer: () => hardwareSettings.mixer, setMixer: patch => hardwareState.updateMixer(patch), onCenter: openCenterPanel
});

$("#fullscreen-button").addEventListener("click", async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await shell.requestFullscreen(); } catch {}
});

const query = new URLSearchParams(location.search);
const proofMode = query.has("target-proof");
nextDebug = query.get("debug-next") === "1" ? createNextDebug({ panel: nextDebugPanel, audio, playlist, audioFrame, nextButton: $("#next-button") }) : null;
if (nextDebug) nextDebugPanel.hidden = false;
const setDebugMap = enabled => { mapDebug.setEnabled(enabled); debugPanel.hidden = !enabled; document.documentElement.dataset.componentMapDebug = String(enabled); };
setDebugMap(!proofMode && query.has("debug-component-map"));
if (proofMode) { targetProof.start(); proofPanel.hidden = false; document.documentElement.dataset.targetProof = "true"; }
document.addEventListener("keydown", event => {
  if (event.key.toLowerCase() === "m" && !event.ctrlKey && !event.metaKey && !event.altKey) { setDebugMap(mapDebug.toggle()); debugPanel.hidden = !mapDebug.isEnabled(); }
});

let previousFrameAt = performance.now();
const renderAudioCore = now => {
  const deltaMs = Math.min(80, Math.max(4, now - previousFrameAt));
  previousFrameAt = now;
  const frame = audioFrame.sample(now, deltaMs);
  const tuning = hardwareSettings.physics;
  physics.update({
    center: clamp((frame.sub * .72 + frame.kickEnergy * .52) * tuning.subForce),
    leftWoofer: clamp(frame.leftBass * tuning.wooferForce), rightWoofer: clamp(frame.rightBass * tuning.wooferForce),
    leftMid: clamp(frame.leftMid * tuning.midForce), rightMid: clamp(frame.rightMid * tuning.midForce), leftHigh: frame.leftHigh, rightHigh: frame.rightHigh
  }, deltaMs);
  const centerFrame = { ...frame, centerExcursion: physics.getExcursion("CENTER_OUTER_RING"), centerMaximum: physics.getMaximum("CENTER_OUTER_RING") };
  reactiveRenderer.render(frame);
  renderer.render(centerFrame, now);
  lighting.render(frame, now);
  nextDebug?.update(frame);
  const feedback = hardware.render(now);
  hardwareReadout.hidden = !feedback;
  if (feedback) hardwareReadout.textContent = feedback;
  requestAnimationFrame(renderAudioCore);
};
requestAnimationFrame(renderAudioCore);

document.documentElement.dataset.runtime = "ready";
window.__lumirConsoleV2 = Object.freeze({ appState, hardwareState, centers, renderer, lighting, playlist, mapDebug, targetProof, audioFrame, physics, reactiveRenderer, hardware });
