// Port of the proven lumir-v2-stage SpeakerPhysicsController.
// It only consumes analysed energy; it never changes the audio graph.
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

const DRIVER_CONFIG = Object.freeze([
  ["CENTER_OUTER_RING", "center", { attackMs: 32, releaseMs: 176, spring: 164, damping: 18, response: .78, maxExcursion: .066 }],
  // Side drivers only. Values are critically damped around their operating range,
  // so a kick produces a short excursion rather than a visual zoom or ringing.
  ["LEFT_SPEAKER_WOOFER", "leftWoofer", { attackMs: 38, releaseMs: 182, spring: 156, damping: 25, response: .74, maxExcursion: .024 }],
  ["RIGHT_SPEAKER_WOOFER", "rightWoofer", { attackMs: 38, releaseMs: 182, spring: 156, damping: 25, response: .74, maxExcursion: .024 }],
  ["LEFT_SPEAKER_LOWER", "leftLower", { attackMs: 56, releaseMs: 176, spring: 166, damping: 26, response: .68, maxExcursion: .012 }],
  ["RIGHT_SPEAKER_LOWER", "rightLower", { attackMs: 56, releaseMs: 176, spring: 166, damping: 26, response: .68, maxExcursion: .012 }],
  ["LEFT_SPEAKER_MID", "leftMid", { attackMs: 52, releaseMs: 132, spring: 200, damping: 29, response: .70, maxExcursion: .010 }],
  ["RIGHT_SPEAKER_MID", "rightMid", { attackMs: 52, releaseMs: 132, spring: 200, damping: 29, response: .70, maxExcursion: .010 }],
  ["LEFT_SPEAKER_TWEETER", "leftHigh", { attackMs: 46, releaseMs: 108, spring: 236, damping: 33, response: .90, maxExcursion: .0026 }],
  ["RIGHT_SPEAKER_TWEETER", "rightHigh", { attackMs: 46, releaseMs: 108, spring: 236, damping: 33, response: .90, maxExcursion: .0026 }]
]);

export class SpeakerPhysicsController {
  constructor() {
    this.states = new Map(DRIVER_CONFIG.map(([id, input, base]) => [id, {
      id, input, base: { ...base }, attackMs: base.attackMs, releaseMs: base.releaseMs, spring: base.spring,
      damping: base.damping, response: base.response, maxExcursion: base.maxExcursion, envelope: 0, position: 0, velocity: 0
    }]));
  }

  static softClip(value) {
    const x = clamp(value, 0, 1.6);
    return x <= 0 ? 0 : (x * 1.34) / (x + .34);
  }

  setTuning({ attack = 1, release = 1, spring = 1, damping = 1, maxExcursion = 1 } = {}) {
    this.states.forEach(state => {
      state.attackMs = state.base.attackMs * clamp(attack, .35, 2.4);
      state.releaseMs = state.base.releaseMs * clamp(release, .35, 2.4);
      state.spring = state.base.spring * clamp(spring, .35, 2.4);
      state.damping = state.base.damping * clamp(damping, .35, 2.4);
      state.maxExcursion = state.base.maxExcursion * clamp(maxExcursion, .35, 2.2);
    });
  }

  update(energy, deltaMs) {
    const dt = clamp(deltaMs / 1000, .004, .05);
    this.states.forEach(state => {
      const raw = clamp(energy[state.input] || 0);
      const target = SpeakerPhysicsController.softClip(Math.pow(raw, state.response));
      const timeConstant = target > state.envelope ? state.attackMs : state.releaseMs;
      state.envelope += (target - state.envelope) * (1 - Math.exp(-(dt * 1000) / timeConstant));
      const targetPosition = state.envelope * state.maxExcursion;
      const acceleration = (targetPosition - state.position) * state.spring - state.velocity * state.damping;
      state.velocity += acceleration * dt;
      state.position = clamp(state.position + state.velocity * dt, 0, state.maxExcursion);
      if (state.position === 0 || state.position === state.maxExcursion) state.velocity *= .42;
    });
  }

  getExcursion(id) { return this.states.get(id)?.position || 0; }
  // The reference maximum deliberately stays at the professional default. This
  // makes the live Max Excursion control visibly affect the masked diaphragm.
  getVisualExcursion(id) {
    const state = this.states.get(id);
    return state ? clamp(state.position / Math.max(.0001, state.base.maxExcursion), 0, 2.2) : 0;
  }
  getEnvelope(id) { return this.states.get(id)?.envelope || 0; }
  getMaximum(id) { return this.states.get(id)?.maxExcursion || 0; }
  snapshot() { return Object.freeze(Object.fromEntries([...this.states.entries()].map(([id, state]) => [id, Object.freeze({ envelope: state.envelope, excursion: state.position, velocity: state.velocity, maxExcursion: state.maxExcursion })]))); }
}
