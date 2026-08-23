const MAX_EVENTS = 20;
const formatTime = seconds => Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}` : "--:--";
const readyState = ["HAVE_NOTHING", "HAVE_METADATA", "HAVE_CURRENT_DATA", "HAVE_FUTURE_DATA", "HAVE_ENOUGH_DATA"];
const networkState = ["NETWORK_EMPTY", "NETWORK_IDLE", "NETWORK_LOADING", "NETWORK_NO_SOURCE"];
const stamp = () => new Date().toLocaleTimeString("pl-PL", { hour12: false }) + `.${String(performance.now() % 1000 | 0).padStart(3, "0")}`;
const display = value => value === undefined || value === null || value === "" ? "—" : String(value);

export function createNextDebug({ panel, audio, playlist, audioFrame, nextButton }) {
  if (!panel || !audio || !playlist || !audioFrame || !nextButton) throw new TypeError("NEXT debug requires the live transport dependencies.");
  const values = Object.fromEntries([...panel.querySelectorAll("[data-next-debug]")].map(node => [node.dataset.nextDebug, node]));
  const logNode = panel.querySelector("[data-next-debug-log]");
  const events = [];
  let lastIndex = Symbol("uninitialized"), lastSrc = Symbol("uninitialized"), lastFrame = null;
  let lastAction = "Waiting for transport input";
  let lastError = "—";
  let transitionInfo = null;
  const originalPlay = audio.play.bind(audio);
  const originalLoad = audio.load.bind(audio);

  const write = () => {
    const state = playlist.state();
    const index = state.tracks.findIndex(track => track.id === state.currentId);
    const current = index >= 0 ? state.tracks[index] : null;
    const diagnostics = audioFrame.diagnostics();
    const playerTransition = playlist.diagnostics?.().transition || transitionInfo;
    const frame = lastFrame;
    const frameActive = Boolean(frame?.active);
    const wave = Boolean(frameActive && frame.waveformLeft?.length && frame.waveformRight?.length);
    const spectrum = Boolean(frameActive && frame.fftMaster?.length);
    const vu = Boolean(frameActive && Number.isFinite(frame.leftRms) && Number.isFinite(frame.rightRms) && Number.isFinite(frame.masterRms));
    const center = Boolean(frameActive && frame.time !== undefined);
    const output = {
      index: index >= 0 ? `${index} / ${Math.max(0, state.tracks.length - 1)}` : "—",
      track: current?.name || "—",
      src: audio.currentSrc || audio.src || "—",
      currentTime: formatTime(audio.currentTime), duration: formatTime(audio.duration), paused: audio.paused ? "YES" : "NO", ended: audio.ended ? "YES" : "NO",
      readyState: `${audio.readyState} · ${readyState[audio.readyState] || "UNKNOWN"}`,
      networkState: `${audio.networkState} · ${networkState[audio.networkState] || "UNKNOWN"}`,
      repeat: state.repeat.toUpperCase(), shuffle: state.shuffle ? "ON" : "OFF", queue: state.queuedId ? (state.tracks.find(track => track.id === state.queuedId)?.name || state.queuedId) : "—",
      context: diagnostics.state, mediaSource: diagnostics.sourceCount ? `YES (${diagnostics.sourceCount})` : "NO", frameActive: frameActive ? "YES" : "NO",
      waveform: wave ? "YES" : "NO", spectrum: spectrum ? "YES" : "NO", vu: vu ? "YES" : "NO", center: center ? "YES" : "NO",
      transition: playerTransition ? `#${playerTransition.id} · ${playerTransition.stage}` : "—",
      loadCount: playerTransition ? `${playerTransition.loadCount} / 1` : "—", playCount: playerTransition ? `${playerTransition.playCount} / 1` : "—",
      action: lastAction, error: lastError
    };
    Object.entries(output).forEach(([key, value]) => { if (values[key]) values[key].textContent = display(value); });
  };

  const log = (event, detail = "") => {
    lastAction = detail ? `${event}: ${detail}` : event;
    events.unshift({ time: stamp(), event: lastAction }); events.length = Math.min(events.length, MAX_EVENTS);
    logNode.replaceChildren(...events.map(entry => { const item = document.createElement("li"); item.textContent = `${entry.time}  ${entry.event}`; return item; }));
    write();
  };
  const error = (event, reason) => { lastError = `${event}: ${reason || "unknown error"}`; log(event, reason || "unknown error"); };
  const transition = event => {
    transitionInfo = event;
    if (event.error) lastError = `transition #${event.id}: ${event.error}`;
    const target = Number.isInteger(event.targetIndex) ? `target ${event.targetIndex}` : "";
    log(`TRANSITION #${event.id}`, [event.stage, target].filter(Boolean).join(" · "));
  };

  audio.play = (...args) => {
    log("play()");
    try {
      const result = originalPlay(...args);
      Promise.resolve(result).catch(reason => error("audio.play rejected", reason?.message || String(reason)));
      return result;
    } catch (reason) { error("audio.play rejected", reason?.message || String(reason)); throw reason; }
  };
  audio.load = (...args) => { log("load()"); return originalLoad(...args); };

  ["loadedmetadata", "canplay", "play", "playing", "pause", "ended"].forEach(type => audio.addEventListener(type, () => log(type)));
  audio.addEventListener("error", () => error("error", audio.error ? `media code ${audio.error.code}` : "media error"));
  window.addEventListener("error", event => error("error", event.message || "JavaScript error"));
  window.addEventListener("unhandledrejection", event => error("unhandled rejection", event.reason?.message || String(event.reason)));

  const originalNext = nextButton.onclick;
  if (typeof originalNext !== "function") throw new Error("NEXT transport handler is unavailable.");
  nextButton.onclick = function nextDebugClick(event) {
    log("CLICK NEXT");
    log("playlist.next()");
    const result = originalNext.call(this, event);
    queueMicrotask(() => update(lastFrame));
    return result;
  };

  const update = frame => {
    lastFrame = frame || lastFrame;
    const state = playlist.state();
    const index = state.tracks.findIndex(track => track.id === state.currentId);
    const src = audio.currentSrc || audio.src || "";
    if (lastIndex !== index) { if (typeof lastIndex !== "symbol") log("index changed", index >= 0 ? `${lastIndex} → ${index}` : "cleared"); lastIndex = index; }
    if (lastSrc !== src) { if (typeof lastSrc !== "symbol") log("src changed", src || "cleared"); lastSrc = src; }
    write();
  };

  update(null); log("DEBUG NEXT READY");
  return Object.freeze({ update, transition, log, dispose: () => { audio.play = originalPlay; audio.load = originalLoad; nextButton.onclick = originalNext; } });
}
