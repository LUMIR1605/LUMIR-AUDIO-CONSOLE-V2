const formatTime = seconds => Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}` : "--:--";
const valid = file => /^(audio\/(wav|x-wav|mpeg))$/i.test(file.type) || /\.(wav|mp3)$/i.test(file.name);

export function createPlaylistEngine({ audio, onChange, beforePlay = async () => {}, onTransition = () => {} }) {
  let tracks = [], currentId = null, repeat = "off", shuffle = false, queuedId = null;
  let generation = 0, cancelPendingReady = null, transition = null;
  const emit = () => onChange({ tracks: tracks.map(track => ({ ...track })), currentId, repeat, shuffle, queuedId, playing: !audio.paused, currentTime: audio.currentTime, duration: audio.duration });
  const get = id => tracks.find(track => track.id === id);
  const current = () => get(currentId);
  const currentIndex = () => tracks.findIndex(track => track.id === currentId);
  const isCurrentGeneration = token => token === generation;
  const wantsPlayback = () => !audio.paused || Boolean(transition?.autoplay && transition.stage !== "transition complete" && transition.stage !== "failed");
  const report = (token, stage, detail = {}) => {
    if (!transition || transition.id !== token) return;
    transition = { ...transition, stage, ...detail };
    onTransition({ ...transition });
  };
  const cancelTransitionSpecificWork = () => {
    if (transition && transition.stage !== "transition complete" && transition.stage !== "failed") report(transition.id, "superseded");
    if (cancelPendingReady) { cancelPendingReady(); cancelPendingReady = null; }
  };
  // This path intentionally does not unload the element: the transition below owns src + load exactly once.
  const stopForTransition = () => cancelTransitionSpecificWork();
  const fullyUnloadPlayer = () => {
    generation += 1;
    cancelTransitionSpecificWork();
    if (!audio.paused) audio.pause();
    audio.removeAttribute("src");
    audio.load();
  };
  const waitForCanPlay = token => new Promise(resolve => {
    let settled = false;
    const finish = ready => {
      if (settled) return;
      settled = true;
      audio.removeEventListener("loadedmetadata", metadata);
      audio.removeEventListener("canplay", canplay);
      audio.removeEventListener("error", failed);
      if (cancelPendingReady === cancel) cancelPendingReady = null;
      resolve(ready);
    };
    const metadata = () => { if (isCurrentGeneration(token)) report(token, "loadedmetadata"); };
    const canplay = () => { if (isCurrentGeneration(token)) { report(token, "canplay"); finish(true); } else finish(false); };
    const failed = () => { if (isCurrentGeneration(token)) report(token, "failed", { error: `media error ${audio.error?.code || "unknown"}` }); finish(false); };
    const cancel = () => finish(false);
    cancelPendingReady = cancel;
    audio.addEventListener("loadedmetadata", metadata);
    audio.addEventListener("canplay", canplay);
    audio.addEventListener("error", failed);
  });
  const requestPlayback = async token => {
    try {
      await beforePlay();
      if (!isCurrentGeneration(token)) return false;
      if (transition?.id === token && transition.stage !== "transition complete") report(token, "play requested", { playCount: transition.playCount + 1 });
      await audio.play();
      return isCurrentGeneration(token);
    } catch (error) {
      if (isCurrentGeneration(token)) {
        report(token, "failed", { error: error?.message || String(error) });
        console.error("LUMIR player transition failed", error);
        emit();
      }
      return false;
    }
  };
  const transitionToTrack = async (targetId, { autoplay = false, reason = "select" } = {}) => {
    const track = get(targetId); if (!track) return false;
    const token = ++generation;
    stopForTransition();
    const targetIndex = tracks.findIndex(item => item.id === targetId);
    transition = { id: token, stage: "transition start", reason, targetId, targetIndex, autoplay, loadCount: 0, playCount: 0, error: null };
    onTransition({ ...transition });
    currentId = targetId;
    emit();
    if (!isCurrentGeneration(token)) return false;
    const ready = waitForCanPlay(token);
    audio.src = track.url;
    report(token, "src set", { src: track.url });
    if (!isCurrentGeneration(token)) return false;
    report(token, "load #1", { loadCount: 1 });
    audio.load();
    const canPlay = await ready;
    if (!canPlay || !isCurrentGeneration(token)) return false;
    if (autoplay && !await requestPlayback(token)) return false;
    if (!isCurrentGeneration(token)) return false;
    report(token, "transition complete");
    emit();
    return true;
  };
  const select = (id, autoplay = false, reason = "select") => {
    if (!get(id)) return Promise.resolve(false);
    if (currentId === id) {
      if (transition?.targetId === id && transition.stage !== "transition complete" && transition.stage !== "failed") return Promise.resolve(false);
      return autoplay ? requestPlayback(generation) : Promise.resolve(true);
    }
    return transitionToTrack(id, { autoplay, reason });
  };
  const orderedNext = direction => {
    if (!tracks.length) return null;
    if (queuedId && direction > 0) { const result = queuedId; queuedId = null; return result; }
    const index = currentIndex();
    if (shuffle && direction > 0 && tracks.length > 1) { const candidates = tracks.filter(track => track.id !== currentId); return candidates[Math.floor(Math.random() * candidates.length)].id; }
    const next = index + direction;
    if (next >= 0 && next < tracks.length) return tracks[next].id;
    return repeat === "all" ? tracks[direction > 0 ? 0 : tracks.length - 1].id : null;
  };
  const moveTo = (direction, autoplay, reason) => {
    const id = orderedNext(direction);
    if (id) return transitionToTrack(id, { autoplay, reason });
    emit(); return Promise.resolve(false);
  };
  const remove = id => {
    const index = tracks.findIndex(track => track.id === id); if (index < 0) return;
    const [removed] = tracks.splice(index, 1);
    if (queuedId === id) queuedId = null;
    if (currentId !== id) { URL.revokeObjectURL(removed.url); emit(); return; }
    const target = tracks[Math.min(index, tracks.length - 1)];
    if (!target) {
      currentId = null; fullyUnloadPlayer(); URL.revokeObjectURL(removed.url); emit(); return;
    }
    const wasPlaying = !audio.paused;
    currentId = null;
    transitionToTrack(target.id, { autoplay: wasPlaying, reason: "remove" }).finally(() => URL.revokeObjectURL(removed.url));
  };

  audio.addEventListener("loadedmetadata", () => { const item = current(); if (item) { item.duration = audio.duration; emit(); } });
  audio.addEventListener("timeupdate", emit); audio.addEventListener("play", emit); audio.addEventListener("pause", emit);
  audio.addEventListener("ended", () => {
    const id = repeat === "one" ? currentId : orderedNext(1);
    if (id) transitionToTrack(id, { autoplay: true, reason: repeat === "one" ? "repeat one" : "ended" });
    else emit();
  });
  return Object.freeze({
    addFiles: files => { [...files].filter(valid).forEach(file => tracks.push({ id: crypto.randomUUID(), name: file.name.replace(/\.(wav|mp3)$/i, ""), file, url: URL.createObjectURL(file), duration: NaN })); emit(); },
    playPause: () => {
      if (!currentId && tracks[0]) return transitionToTrack(tracks[0].id, { autoplay: true, reason: "play" });
      if (audio.paused) return requestPlayback(generation);
      audio.pause(); return Promise.resolve(true);
    },
    select: (id, autoplay = false) => select(id, autoplay, "select"),
    next: () => moveTo(1, wantsPlayback(), "next"),
    prev: () => moveTo(-1, wantsPlayback(), "prev"),
    toggleRepeat: () => { repeat = repeat === "off" ? "one" : repeat === "one" ? "all" : "off"; emit(); },
    toggleShuffle: () => { shuffle = !shuffle; emit(); },
    queue: id => { if (get(id) && id !== currentId) { queuedId = id; emit(); } },
    remove,
    clear: () => { fullyUnloadPlayer(); tracks.forEach(track => URL.revokeObjectURL(track.url)); tracks = []; currentId = null; queuedId = null; emit(); },
    move: (id, direction) => { const index = tracks.findIndex(track => track.id === id), target = index + direction; if (index < 0 || target < 0 || target >= tracks.length) return; [tracks[index], tracks[target]] = [tracks[target], tracks[index]]; emit(); },
    state: () => ({ tracks, currentId, repeat, shuffle, queuedId }),
    diagnostics: () => ({ generation, transition: transition ? { ...transition } : null })
  });
}
