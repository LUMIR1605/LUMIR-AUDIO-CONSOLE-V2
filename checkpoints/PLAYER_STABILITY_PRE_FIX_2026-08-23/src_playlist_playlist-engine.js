const formatTime = seconds => Number.isFinite(seconds) ? `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}` : "--:--";
const valid = file => /^(audio\/(wav|x-wav|mpeg))$/i.test(file.type) || /\.(wav|mp3)$/i.test(file.name);

export function createPlaylistEngine({ audio, onChange, beforePlay = async () => {} }) {
  let tracks = [], currentId = null, repeat = "off", shuffle = false, queuedId = null;
  const emit = () => onChange({ tracks: tracks.map(track => ({ ...track })), currentId, repeat, shuffle, queuedId, playing: !audio.paused, currentTime: audio.currentTime, duration: audio.duration });
  const get = id => tracks.find(track => track.id === id);
  const current = () => get(currentId);
  // Clearing src and loading immediately tears down the old media; an explicit pause here cancels a pending play() request.
  const stopCurrent = () => { audio.removeAttribute("src"); audio.load(); };
  const start = async () => {
    try { await beforePlay(); await audio.play(); }
    catch { emit(); }
  };
  const select = (id, autoplay = false) => {
    const track = get(id); if (!track) return;
    if (currentId !== id) { stopCurrent(); currentId = id; audio.src = track.url; audio.load(); }
    if (autoplay) return start();
    emit();
  };
  const orderedNext = direction => {
    if (!tracks.length) return null;
    if (queuedId && direction > 0) { const result = queuedId; queuedId = null; return result; }
    const index = tracks.findIndex(track => track.id === currentId);
    if (shuffle && direction > 0 && tracks.length > 1) { const candidates = tracks.filter(track => track.id !== currentId); return candidates[Math.floor(Math.random() * candidates.length)].id; }
    const next = index + direction;
    if (next >= 0 && next < tracks.length) return tracks[next].id;
    return repeat === "all" ? tracks[direction > 0 ? 0 : tracks.length - 1].id : null;
  };
  const next = (autoplay = true) => { const id = orderedNext(1); if (id) select(id, autoplay); else { stopCurrent(); emit(); } };
  audio.addEventListener("loadedmetadata", () => { const item = current(); if (item) { item.duration = audio.duration; emit(); } });
  audio.addEventListener("timeupdate", emit); audio.addEventListener("play", emit); audio.addEventListener("pause", emit);
  audio.addEventListener("ended", () => { if (repeat === "one") { audio.currentTime = 0; start(); return; } next(true); });
  return Object.freeze({
    addFiles: files => { [...files].filter(valid).forEach(file => tracks.push({ id: crypto.randomUUID(), name: file.name.replace(/\.(wav|mp3)$/i, ""), file, url: URL.createObjectURL(file), duration: NaN })); emit(); },
    playPause: () => { if (!currentId && tracks[0]) select(tracks[0].id, true); else if (audio.paused) start(); else audio.pause(); },
    select, next: () => next(true), prev: () => { const id = orderedNext(-1); if (id) select(id, true); },
    toggleRepeat: () => { repeat = repeat === "off" ? "one" : repeat === "one" ? "all" : "off"; emit(); }, toggleShuffle: () => { shuffle = !shuffle; emit(); },
    queue: id => { if (get(id) && id !== currentId) { queuedId = id; emit(); } },
    remove: id => { const index = tracks.findIndex(track => track.id === id); if (index < 0) return; const [removed] = tracks.splice(index, 1); URL.revokeObjectURL(removed.url); if (queuedId === id) queuedId = null; if (currentId === id) { currentId = null; stopCurrent(); if (tracks.length) select(tracks[Math.min(index, tracks.length - 1)].id, false); else emit(); } else emit(); },
    clear: () => { stopCurrent(); tracks.forEach(track => URL.revokeObjectURL(track.url)); tracks = []; currentId = null; queuedId = null; emit(); },
    move: (id, direction) => { const index = tracks.findIndex(track => track.id === id), target = index + direction; if (index < 0 || target < 0 || target >= tracks.length) return; [tracks[index], tracks[target]] = [tracks[target], tracks[index]]; emit(); },
    state: () => ({ tracks, currentId, repeat, shuffle, queuedId })
  });
}
