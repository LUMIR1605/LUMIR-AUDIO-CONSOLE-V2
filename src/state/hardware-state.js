const STORAGE_KEY = "lumir-v2-hardware-controls";

export const PROFESSIONAL_DEFAULTS = Object.freeze({
  mixer: Object.freeze({ master: .88, left: .92, right: .92, crossfader: 0, low: 0, mid: 0, high: 0, mute: false }),
  physics: Object.freeze({ subForce: 1, wooferForce: 1, midForce: .72, attack: 1, release: 1, spring: 1, damping: 1, maxExcursion: 1 })
});

const clone = value => JSON.parse(JSON.stringify(value));

export function createHardwareState() {
  let state = clone(PROFESSIONAL_DEFAULTS);
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (stored) state = { mixer: { ...state.mixer, ...stored.mixer }, physics: { ...state.physics, ...stored.physics } };
  } catch {}
  const listeners = new Set();
  const emit = () => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
    listeners.forEach(listener => listener(clone(state)));
  };
  return Object.freeze({
    get: () => clone(state),
    updateMixer: patch => { state = { ...state, mixer: { ...state.mixer, ...patch } }; emit(); },
    updatePhysics: patch => { state = { ...state, physics: { ...state.physics, ...patch } }; emit(); },
    reset: () => { state = clone(PROFESSIONAL_DEFAULTS); emit(); },
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); }
  });
}
