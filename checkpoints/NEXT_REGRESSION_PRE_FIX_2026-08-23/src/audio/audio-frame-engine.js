const BAND_RANGES = Object.freeze({
  sub: [20, 60], bass: [60, 150], lowMid: [150, 500], mid: [500, 2000], highMid: [2000, 6000], high: [6000, 18000]
});
const MIXER_DEFAULTS = Object.freeze({ master: .88, left: .92, right: .92, crossfader: 0, low: 0, mid: 0, high: 0, mute: false });
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const decay = (value, milliseconds, deltaMs) => value * Math.exp(-deltaMs / milliseconds);

const createAnalyser = context => {
  const node = context.createAnalyser();
  node.fftSize = 4096;
  node.minDecibels = -96;
  node.maxDecibels = -18;
  node.smoothingTimeConstant = .72;
  return node;
};

export function createAudioFrameEngine(audio) {
  if (!(audio instanceof HTMLAudioElement)) throw new TypeError("The playlist HTMLAudioElement is required.");
  let context = null, source = null, masterAnalyser = null, leftAnalyser = null, rightAnalyser = null;
  let splitter = null, merger = null, masterGain = null, leftGain = null, rightGain = null;
  let lowEq = null, midEq = null, highEq = null, postSplitter = null, silentLeft = null, silentRight = null;
  let fftMaster = null, fftLeft = null, fftRight = null, waveformLeft = null, waveformRight = null, previousSpectrum = null;
  let previousKick = 0, kickBaseline = .0001, fluxBaseline = .0001, beatUntil = 0, peakLeft = 0, peakRight = 0;
  let mixer = { ...MIXER_DEFAULTS };
  const bandPeaks = Object.fromEntries(Object.keys(BAND_RANGES).map(name => [name, .0001]));
  const silentWave = new Float32Array(4096);
  const silentFft = new Float32Array(2048).fill(-96);
  const emptyFrame = () => Object.freeze({
    time: 0, active: false, waveformLeft: silentWave, waveformRight: silentWave, fftLeft: silentFft, fftRight: silentFft, fftMaster: silentFft,
    sub: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, high: 0, leftBass: 0, rightBass: 0, leftMid: 0, rightMid: 0, leftHigh: 0, rightHigh: 0,
    leftRms: 0, rightRms: 0, masterRms: 0, peakLeft: 0, peakRight: 0, kickEnergy: 0, bassEnergy: 0, transient: 0, beat: false
  });
  let lastFrame = emptyFrame();

  const resetDynamics = () => {
    previousKick = 0; kickBaseline = .0001; fluxBaseline = .0001; beatUntil = 0; peakLeft = 0; peakRight = 0;
    Object.keys(bandPeaks).forEach(name => { bandPeaks[name] = .0001; }); previousSpectrum?.fill(0);
  };
  const rms = data => { let sum = 0; for (let i = 0; i < data.length; i += 1) sum += data[i] * data[i]; return Math.sqrt(sum / Math.max(1, data.length)); };
  const binFor = hertz => clamp(Math.round(hertz / (context.sampleRate / masterAnalyser.fftSize)), 0, masterAnalyser.frequencyBinCount - 1);
  const rawBand = (data, [minHz, maxHz]) => {
    const from = binFor(minHz), to = Math.max(from + 1, binFor(Math.min(maxHz, context.sampleRate / 2 - 1)));
    let power = 0;
    for (let i = from; i <= to; i += 1) { const amplitude = Math.pow(10, data[i] / 20); power += amplitude * amplitude; }
    return Math.sqrt(power / (to - from + 1));
  };
  const normalizedBand = (name, raw, deltaMs) => {
    bandPeaks[name] = Math.max(raw, decay(bandPeaks[name], 1750, deltaMs), .0001);
    return clamp(raw / Math.max(.0001, bandPeaks[name]));
  };

  const applyMixer = () => {
    if (!context) return;
    const at = context.currentTime;
    const cross = clamp(mixer.crossfader, -1, 1);
    const leftCross = cross > 0 ? 1 - cross : 1;
    const rightCross = cross < 0 ? 1 + cross : 1;
    leftGain.gain.setTargetAtTime(mixer.left * leftCross, at, .012);
    rightGain.gain.setTargetAtTime(mixer.right * rightCross, at, .012);
    masterGain.gain.setTargetAtTime(mixer.mute ? 0 : mixer.master, at, .012);
    lowEq.gain.setTargetAtTime(mixer.low, at, .015);
    midEq.gain.setTargetAtTime(mixer.mid, at, .015);
    highEq.gain.setTargetAtTime(mixer.high, at, .015);
  };

  const ensureGraph = () => {
    if (context) return;
    context = new (window.AudioContext || window.webkitAudioContext)();
    source = context.createMediaElementSource(audio);
    lowEq = context.createBiquadFilter(); lowEq.type = "lowshelf"; lowEq.frequency.value = 95;
    midEq = context.createBiquadFilter(); midEq.type = "peaking"; midEq.frequency.value = 1050; midEq.Q.value = .9;
    highEq = context.createBiquadFilter(); highEq.type = "highshelf"; highEq.frequency.value = 7800;
    splitter = context.createChannelSplitter(2); merger = context.createChannelMerger(2);
    leftGain = context.createGain(); rightGain = context.createGain(); masterGain = context.createGain();
    masterAnalyser = createAnalyser(context); leftAnalyser = createAnalyser(context); rightAnalyser = createAnalyser(context);
    postSplitter = context.createChannelSplitter(2); silentLeft = context.createGain(); silentRight = context.createGain();
    silentLeft.gain.value = 0; silentRight.gain.value = 0;

    // One source and one audible route. Analysers observe the post-control signal via silent taps.
    source.connect(lowEq); lowEq.connect(midEq); midEq.connect(highEq); highEq.connect(splitter);
    splitter.connect(leftGain, 0); splitter.connect(rightGain, 1);
    leftGain.connect(merger, 0, 0); rightGain.connect(merger, 0, 1);
    merger.connect(masterGain); masterGain.connect(masterAnalyser); masterAnalyser.connect(context.destination);
    masterAnalyser.connect(postSplitter); postSplitter.connect(leftAnalyser, 0); postSplitter.connect(rightAnalyser, 1);
    leftAnalyser.connect(silentLeft); rightAnalyser.connect(silentRight); silentLeft.connect(context.destination); silentRight.connect(context.destination);

    fftMaster = new Float32Array(masterAnalyser.frequencyBinCount); fftLeft = new Float32Array(leftAnalyser.frequencyBinCount); fftRight = new Float32Array(rightAnalyser.frequencyBinCount);
    waveformLeft = new Float32Array(leftAnalyser.fftSize); waveformRight = new Float32Array(rightAnalyser.fftSize); previousSpectrum = new Float32Array(masterAnalyser.frequencyBinCount);
    resetDynamics(); applyMixer();
  };

  const idle = deltaMs => {
    peakLeft = decay(peakLeft, 260, deltaMs); peakRight = decay(peakRight, 260, deltaMs);
    lastFrame = Object.freeze({ ...emptyFrame(), time: performance.now(), peakLeft, peakRight });
    return lastFrame;
  };

  const sample = (now, deltaMs) => {
    if (!context || audio.paused || audio.ended || !audio.currentSrc) return idle(deltaMs);
    masterAnalyser.getFloatFrequencyData(fftMaster); leftAnalyser.getFloatFrequencyData(fftLeft); rightAnalyser.getFloatFrequencyData(fftRight);
    leftAnalyser.getFloatTimeDomainData(waveformLeft); rightAnalyser.getFloatTimeDomainData(waveformRight);
    const raw = Object.fromEntries(Object.entries(BAND_RANGES).map(([name, range]) => [name, rawBand(fftMaster, range)]));
    const bands = Object.fromEntries(Object.entries(raw).map(([name, value]) => [name, normalizedBand(name, value, deltaMs)]));
    const leftBass = clamp(rawBand(fftLeft, BAND_RANGES.bass) / Math.max(.0001, bandPeaks.bass));
    const rightBass = clamp(rawBand(fftRight, BAND_RANGES.bass) / Math.max(.0001, bandPeaks.bass));
    const leftMid = clamp(rawBand(fftLeft, BAND_RANGES.lowMid) / Math.max(.0001, bandPeaks.lowMid));
    const rightMid = clamp(rawBand(fftRight, BAND_RANGES.lowMid) / Math.max(.0001, bandPeaks.lowMid));
    const leftHigh = clamp(rawBand(fftLeft, BAND_RANGES.high) / Math.max(.0001, bandPeaks.high));
    const rightHigh = clamp(rawBand(fftRight, BAND_RANGES.high) / Math.max(.0001, bandPeaks.high));
    const leftRms = clamp(rms(waveformLeft) * 2.7), rightRms = clamp(rms(waveformRight) * 2.7), masterRms = (leftRms + rightRms) * .5;
    peakLeft = Math.max(leftRms, decay(peakLeft, 620, deltaMs)); peakRight = Math.max(rightRms, decay(peakRight, 620, deltaMs));
    const kickRaw = raw.sub * .68 + raw.bass * .32;
    kickBaseline += (kickRaw - kickBaseline) * Math.min(.12, deltaMs / 560);
    const kickRise = Math.max(0, kickRaw - previousKick); previousKick = kickRaw;
    const kickEnergy = clamp(bands.sub * .68 + bands.bass * .22 + kickRise / Math.max(.0008, kickBaseline * 1.45));
    let flux = 0;
    for (let i = 0; i < fftMaster.length; i += 4) { const amplitude = Math.pow(10, fftMaster[i] / 20); flux += Math.max(0, amplitude - previousSpectrum[i]); previousSpectrum[i] = amplitude; }
    flux /= Math.max(1, fftMaster.length / 4); fluxBaseline += (flux - fluxBaseline) * Math.min(.08, deltaMs / 1200);
    const transient = clamp((flux - fluxBaseline * 1.18) / Math.max(.00008, fluxBaseline * 2.5));
    if (transient > .28 && now > beatUntil) beatUntil = now + 120;
    lastFrame = Object.freeze({
      time: audio.currentTime, active: true, waveformLeft, waveformRight, fftLeft, fftRight, fftMaster, ...bands,
      leftBass, rightBass, leftMid, rightMid, leftHigh, rightHigh, leftRms, rightRms, masterRms, peakLeft, peakRight,
      kickEnergy, bassEnergy: clamp(bands.sub * .34 + bands.bass * .66), transient, beat: now < beatUntil
    });
    return lastFrame;
  };

  const setMixer = patch => {
    mixer = {
      ...mixer, ...patch,
      master: clamp(Number(patch.master ?? mixer.master), 0, 1.2), left: clamp(Number(patch.left ?? mixer.left)), right: clamp(Number(patch.right ?? mixer.right)),
      crossfader: clamp(Number(patch.crossfader ?? mixer.crossfader), -1, 1), low: clamp(Number(patch.low ?? mixer.low), -12, 12),
      mid: clamp(Number(patch.mid ?? mixer.mid), -12, 12), high: clamp(Number(patch.high ?? mixer.high), -12, 12), mute: Boolean(patch.mute ?? mixer.mute)
    };
    applyMixer(); return { ...mixer };
  };

  return Object.freeze({
    ensureGraph,
    resume: async () => { ensureGraph(); if (context.state === "suspended") await context.resume(); },
    sample, reset: resetDynamics, setMixer, getMixer: () => ({ ...mixer }), resetMixer: () => setMixer(MIXER_DEFAULTS), getFrame: () => lastFrame,
    diagnostics: () => Object.freeze({ ready: Boolean(context), state: context?.state || "uninitialized", fftSize: masterAnalyser?.fftSize || 0, sourceCount: source ? 1 : 0, mixer: { ...mixer } }),
    dispose: async () => { if (context) await context.close(); context = null; source = null; }
  });
}
