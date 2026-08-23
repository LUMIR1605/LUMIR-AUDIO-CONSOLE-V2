// Port of the proven lumir-v2-stage SpeakerPhysicsController.
// It only consumes analysed energy; it never changes the audio graph.
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

const DRIVER_CONFIG = Object.freeze([
  ["CENTER_OUTER_RING", "center", { attackMs: 32, releaseMs: 176, spring: 164, damping: 18, response: .78, maxExcursion: .066 }],
  ["LEFT_SPEAKER_WOOFER", "leftWoofer", { attackMs: 42, releaseMs: 142, spring: 190, damping: 24, response: .67, maxExcursion: .034 }],
  ["RIGHT_SPEAKER_WOOFER", "rightWoofer", { attackMs: 42, releaseMs: 142, spring: 190, damping: 24, response: .67, maxExcursion: .034 }],
  ["LEFT_SPEAKER_MID", "leftMid", { attackMs: 48, releaseMs: 126, spring: 208, damping: 27, response: .52, maxExcursion: .018 }],
  ["RIGHT_SPEAKER_MID", "rightMid", { attackMs: 48, releaseMs: 126, spring: 208, damping: 27, response: .52, maxExcursion: .018 }],
  ["LEFT_SPEAKER_TWEETER", "leftHigh", { attackMs: 35, releaseMs: 96, spring: 240, damping: 30, response: .45, maxExcursion: .010 }],
  ["RIGHT_SPEAKER_TWEETER", "rightHigh", { attackMs: 35, releaseMs: 96, spring: 240, damping: 30, response: .45, maxExcursion: .010 }]
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
  getEnvelope(id) { return this.states.get(id)?.envelope || 0; }
  getMaximum(id) { return this.states.get(id)?.maxExcursion || 0; }
  snapshot() { return Object.freeze(Object.fromEntries([...this.states.entries()].map(([id, state]) => [id, Object.freeze({ envelope: state.envelope, excursion: state.position, velocity: state.velocity, maxExcursion: state.maxExcursion })]))); }
}
