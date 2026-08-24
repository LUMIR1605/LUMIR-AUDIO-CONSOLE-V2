import { createShellMapper } from "../mapping/component-map.js";

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export function createAudioReactiveRenderer(canvas, shell, physics) {
  if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError("An audio reactive canvas is required.");
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("Canvas 2D is unavailable.");
  const mapper = createShellMapper(shell);
  const hardwareImage = shell.querySelector(".console-shell__hardware");
  if (!(hardwareImage instanceof HTMLImageElement)) throw new Error("The console hardware raster is required.");
  const speakerQuery = new URLSearchParams(window.location.search);
  const speakerDebug = speakerQuery.has("debug-speaker");
  const speakerLiveProbe = !speakerDebug && speakerQuery.has("debug-speaker-live");
  const speakerV3 = speakerQuery.get("speaker-v3") === "1";
  const speakerV3Debug = speakerV3 && speakerQuery.get("speaker-v3-debug") === "1";
  const speakerLiveMaxima = { leftBass: 0, rightBass: 0, leftVisual: 0, rightVisual: 0 };
  const leftV3 = speakerV3 ? { position: 0, lastTime: performance.now(), lowPass: 0, previousSample: 0 } : null;

  const resize = () => {
    const { renderedWidth, renderedHeight, devicePixelRatio } = mapper.metrics();
    canvas.width = Math.max(1, Math.round(renderedWidth * devicePixelRatio));
    canvas.height = Math.max(1, Math.round(renderedHeight * devicePixelRatio));
    canvas.style.width = `${renderedWidth}px`;
    canvas.style.height = `${renderedHeight}px`;
    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(shell);
  resize();

  const path = component => {
    const display = mapper.rectFor(component);
    context.beginPath();
    if (component.mask === "circle") context.arc(display.centerX, display.centerY, display.radiusX, 0, Math.PI * 2);
    else if (component.mask === "ellipse") context.ellipse(display.centerX, display.centerY, display.radiusX, display.radiusY, 0, 0, Math.PI * 2);
    else if (component.mask === "polygon") component.points.forEach(([x, y], index) => {
      const point = mapper.toDisplayed(x, y);
      if (index === 0) context.moveTo(point.x, point.y); else context.lineTo(point.x, point.y);
    });
    else context.rect(display.x, display.y, display.width, display.height);
    if (component.mask === "polygon") context.closePath();
    return display;
  };

  const target = id => mapper.target(id);
  const clear = () => {
    const { renderedWidth, renderedHeight } = mapper.metrics();
    context.clearRect(0, 0, renderedWidth, renderedHeight);
  };
  const darken = (display, alpha) => {
    context.fillStyle = `rgba(1, 1, 1, ${alpha})`;
    context.fillRect(display.x, display.y, display.width, display.height);
  };

  const drawWaveform = (id, samples, energy) => {
    const display = path(target(id));
    context.save();
    context.clip();
    darken(display, .69);
    context.strokeStyle = `rgba(255, 190, 58, ${.54 + energy * .46})`;
    context.shadowColor = "rgba(232, 159, 37, .72)";
    context.shadowBlur = Math.max(2, display.width * .012);
    context.lineWidth = Math.max(1.1, display.width * .005);
    context.beginPath();
    const step = samples.length / Math.max(1, display.width);
    for (let x = 0; x <= display.width; x += 1) {
      const sample = samples[Math.min(samples.length - 1, Math.floor(x * step))] || 0;
      const y = display.y + display.height * .5 + sample * display.height * .40;
      if (x === 0) context.moveTo(display.x + x, y); else context.lineTo(display.x + x, y);
    }
    context.stroke();
    context.restore();
  };

  const bandAmount = (fft, min, max) => {
    const from = Math.max(0, Math.floor(min * fft.length));
    const to = Math.min(fft.length - 1, Math.max(from + 1, Math.floor(max * fft.length)));
    let total = 0;
    for (let index = from; index <= to; index += 1) total += clamp((fft[index] + 96) / 78);
    return total / (to - from + 1);
  };

  const drawSpectrum = fft => {
    const display = path(target("SPECTRUM_DISPLAY"));
    context.save();
    context.clip();
    darken(display, .63);
    const bars = 52;
    const gap = Math.max(1, display.width * .006);
    const width = (display.width - gap * (bars - 1)) / bars;
    for (let index = 0; index < bars; index += 1) {
      const from = Math.pow(index / bars, 2.15) * .78;
      const to = Math.pow((index + 1) / bars, 2.15) * .78 + .018;
      const amount = bandAmount(fft, from, to);
      const height = Math.max(1, amount * display.height * .92);
      const x = display.x + index * (width + gap);
      const y = display.y + display.height - height;
      context.fillStyle = `rgba(255, ${Math.round(151 + amount * 84)}, 43, ${.38 + amount * .62})`;
      if (amount > .42) { context.shadowColor = "rgba(233, 158, 32, .62)"; context.shadowBlur = 4; }
      context.fillRect(x, y, width, height);
      context.shadowBlur = 0;
    }
    context.restore();
  };

  const drawChannelMeter = (id, level, peak) => {
    const display = path(target(id));
    context.save();
    context.clip();
    darken(display, .44);
    const segments = 24;
    const width = display.width * .47;
    const x = display.x + (display.width - width) * .5;
    const segmentHeight = display.height / (segments * 1.42);
    for (let index = 0; index < segments; index += 1) {
      const threshold = (index + 1) / segments;
      const y = display.y + display.height - (index + 1) * (segmentHeight * 1.42) - display.height * .06;
      const hot = index > 19;
      context.fillStyle = level >= threshold ? (hot ? "rgba(255, 80, 23, .96)" : "rgba(255, 188, 44, .94)") : "rgba(104, 72, 19, .23)";
      context.fillRect(x, y, width, segmentHeight);
    }
    const peakY = display.y + display.height - clamp(peak) * display.height * .85 - display.height * .06;
    context.fillStyle = "rgba(255, 232, 128, .92)";
    context.fillRect(x - display.width * .045, peakY, width + display.width * .09, Math.max(1, segmentHeight * .32));
    context.restore();
  };

  const drawVu = (id, level) => {
    const display = path(target(id));
    context.save();
    context.clip();
    darken(display, .28);
    const centerX = display.x + display.width * .5;
    const centerY = display.y + display.height * .84;
    const radius = display.width * .42;
    context.strokeStyle = "rgba(242, 188, 75, .36)";
    context.lineWidth = Math.max(1, display.width * .012);
    context.beginPath();
    context.arc(centerX, centerY, radius, Math.PI * 1.15, Math.PI * 1.85);
    context.stroke();
    const angle = Math.PI * (1.15 + clamp(level) * .70);
    context.strokeStyle = "rgba(255, 219, 119, .95)";
    context.shadowColor = "rgba(234, 169, 46, .72)";
    context.shadowBlur = 4;
    context.lineWidth = Math.max(1, display.width * .017);
    context.beginPath();
    context.moveTo(centerX, centerY);
    context.lineTo(centerX + Math.cos(angle) * radius * .9, centerY + Math.sin(angle) * radius * .9);
    context.stroke();
    context.shadowBlur = 0;
    context.fillStyle = "rgba(255, 203, 88, .92)";
    context.beginPath(); context.arc(centerX, centerY, Math.max(1.2, display.width * .025), 0, Math.PI * 2); context.fill();
    context.restore();
  };

  const drawCenterRing = (excursion, maximum) => {
    const display = mapper.rectFor(target("CENTER_OUTER_RING"));
    const thickness = display.radiusX * .075;
    const strength = clamp(excursion / Math.max(.001, maximum));
    context.save();
    context.beginPath();
    context.arc(display.centerX, display.centerY, display.radiusX - thickness * .5, 0, Math.PI * 2);
    context.strokeStyle = `rgba(238, 178, 63, ${.07 + strength * .27})`;
    context.lineWidth = Math.max(1.2, thickness * (.10 + strength * .13));
    context.stroke();
    context.restore();
  };

  const DIAPHRAGM_PROFILES = Object.freeze({
    woofer: Object.freeze({ innerCone: .76, scale: .095, offsetNativePx: 3.5, relief: .075 }),
    lower: Object.freeze({ innerCone: .77, scale: .060, offsetNativePx: 2.2, relief: .050 }),
    mid: Object.freeze({ innerCone: .72, scale: .032, offsetNativePx: 1.2, relief: .030 }),
    tweeter: Object.freeze({ innerCone: .70, scale: .010, offsetNativePx: .35, relief: .012 })
  });

  // Only the inner cone is redrawn from the existing hardware raster. The
  // mapped surround, bezel and cabinet stay in the underlying static image.
  const drawDiaphragm = (id, profileName) => {
    const rawStrength = clamp(physics.getVisualExcursion(id), 0, 1);
    if (rawStrength <= .002 || !hardwareImage.complete || hardwareImage.naturalWidth === 0) return;
    const profile = DIAPHRAGM_PROFILES[profileName];
    const motion = Math.pow(rawStrength, .65);
    const component = target(id);
    const display = mapper.rectFor(component);
    const sourceScaleX = hardwareImage.naturalWidth / mapper.native.width;
    const sourceScaleY = hardwareImage.naturalHeight / mapper.native.height;
    const sourceRadiusX = component.radius * profile.innerCone * sourceScaleX;
    const sourceRadiusY = component.radius * profile.innerCone * sourceScaleY;
    const sourceCenterX = component.centerX * sourceScaleX;
    const sourceCenterY = component.centerY * sourceScaleY;
    const innerRadiusX = display.radiusX * profile.innerCone;
    const innerRadiusY = display.radiusY * profile.innerCone;
    // The slightly smaller clip hides the transition between the redrawn cone
    // and the static surround even at the maximum production excursion.
    const clipRadiusX = innerRadiusX * .985;
    const clipRadiusY = innerRadiusY * .985;
    const scale = 1 + motion * profile.scale;
    const offsetY = motion * profile.offsetNativePx * display.metrics.scaleY;
    const destinationWidth = innerRadiusX * 2 * scale;
    const destinationHeight = innerRadiusY * 2 * scale;
    const relief = profile.relief * motion;

    context.save();
    context.beginPath();
    context.ellipse(display.centerX, display.centerY, clipRadiusX, clipRadiusY, 0, 0, Math.PI * 2);
    context.clip();
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(
      hardwareImage,
      sourceCenterX - sourceRadiusX, sourceCenterY - sourceRadiusY, sourceRadiusX * 2, sourceRadiusY * 2,
      display.centerX - destinationWidth * .5, display.centerY + offsetY - destinationHeight * .5, destinationWidth, destinationHeight
    );

    // Neutral relief reinforces the raster movement without introducing any
    // decorative colour, glow or extra speaker ring.
    const reliefGradient = context.createLinearGradient(display.centerX, display.y, display.centerX, display.y + display.height);
    reliefGradient.addColorStop(0, `rgba(255, 255, 255, ${relief})`);
    reliefGradient.addColorStop(.34, "rgba(255, 255, 255, 0)");
    reliefGradient.addColorStop(.67, "rgba(0, 0, 0, 0)");
    reliefGradient.addColorStop(1, `rgba(0, 0, 0, ${relief * 1.45})`);
    context.fillStyle = reliefGradient;
    context.fillRect(display.x, display.y, display.width, display.height);
    context.restore();
  };

  const drawLeftWooferV3Debug = ({ signedLow, target: motionTarget, position, leftBass }) => {
    if (!speakerV3Debug) return;
    context.save();
    context.fillStyle = "rgba(205, 228, 233, .96)";
    context.font = "700 11px ui-monospace, Consolas, monospace";
    const lines = [
      "LEFT WOOFER V3",
      `SIGNED LOW: ${signedLow.toFixed(3)}`,
      `TARGET: ${motionTarget.toFixed(3)}`,
      `POSITION: ${position.toFixed(3)}`,
      `LEFT BASS: ${leftBass.toFixed(3)}`
    ];
    lines.forEach((line, index) => context.fillText(line, 12, 20 + index * 14));
    context.restore();
  };

  // V3 intentionally derives only this driver from signed PCM motion. Its
  // clip is entirely inside the static surround, bezel and speaker cabinet.
  const drawLeftWooferV3 = frame => {
    const now = performance.now();
    const dt = clamp((now - leftV3.lastTime) / 1000, .004, .05);
    let signedLow = 0;
    const samples = frame.waveformLeft;
    if (frame.active && samples?.length) {
      let dcTotal = 0;
      for (let index = 0; index < samples.length; index += 1) dcTotal += samples[index];
      const dcMean = dcTotal / samples.length;
      const rc = 1 / (2 * Math.PI * 110);
      const sampleDt = 1 / 48000;
      const alpha = sampleDt / (rc + sampleDt);
      for (let index = 0; index < samples.length; index += 1) {
        const sample = samples[index];
        const centered = sample - dcMean;
        leftV3.lowPass += alpha * (centered - leftV3.lowPass);
        leftV3.previousSample = sample;
      }
      signedLow = leftV3.lowPass;
    }
    const bassGate = .25 + .75 * Math.sqrt(clamp(frame.leftBass || 0));
    const motionTarget = frame.active ? clamp(signedLow * 9.0 * bassGate, -1, 1) : 0;
    const follow = 1 - Math.exp(-dt * 30);
    leftV3.position += (motionTarget - leftV3.position) * follow;
    leftV3.position = clamp(leftV3.position, -1, 1);
    leftV3.lastTime = now;

    const component = target("LEFT_SPEAKER_WOOFER");
    const display = mapper.rectFor(component);
    const outerConeRatio = .74;
    const dynamicConeRatio = .64;
    const dustCapRatio = .27;
    const sourceScaleX = hardwareImage.naturalWidth / mapper.native.width;
    const sourceScaleY = hardwareImage.naturalHeight / mapper.native.height;
    const sourceCenterX = component.centerX * sourceScaleX;
    const sourceCenterY = component.centerY * sourceScaleY;
    const outerRadiusX = display.radiusX * outerConeRatio;
    const outerRadiusY = display.radiusY * outerConeRatio;
    const dynamicRadiusX = display.radiusX * dynamicConeRatio;
    const dynamicRadiusY = display.radiusY * dynamicConeRatio;
    const dustRadiusX = display.radiusX * dustCapRatio;
    const dustRadiusY = display.radiusY * dustCapRatio;
    const dynamicScale = 1.030 + leftV3.position * .025;
    const dustScale = 1.035 + leftV3.position * .035;
    const depth = Math.abs(leftV3.position);
    const clipCone = (radiusX, radiusY) => {
      context.beginPath();
      context.ellipse(display.centerX, display.centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
      context.clip();
    };
    const drawConeRaster = (ratio, scale) => {
      const sourceRadiusX = component.radius * ratio * sourceScaleX;
      const sourceRadiusY = component.radius * ratio * sourceScaleY;
      const destinationRadiusX = display.radiusX * ratio * scale;
      const destinationRadiusY = display.radiusY * ratio * scale;
      context.drawImage(
        hardwareImage,
        sourceCenterX - sourceRadiusX, sourceCenterY - sourceRadiusY, sourceRadiusX * 2, sourceRadiusY * 2,
        display.centerX - destinationRadiusX, display.centerY - destinationRadiusY, destinationRadiusX * 2, destinationRadiusY * 2
      );
    };

    context.save();
    if (hardwareImage.complete && hardwareImage.naturalWidth > 0) {
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      // This unmoving base covers the entire V3 cone, so inward signed motion
      // can never reveal the original raster or an empty background strip.
      context.save();
      clipCone(outerRadiusX, outerRadiusY);
      drawConeRaster(outerConeRatio, 1.025);
      context.restore();

      // Only the protected centre is allowed to breathe. Its scale is always
      // above 1, retaining the cone texture and its circular structure.
      context.save();
      clipCone(dynamicRadiusX, dynamicRadiusY);
      drawConeRaster(dynamicConeRatio, dynamicScale);
      context.restore();

      // The dust cap supplies a small, signed depth cue without translating
      // or deforming any part of the speaker cabinet or outer surround.
      context.save();
      clipCone(dustRadiusX, dustRadiusY);
      drawConeRaster(dustCapRatio, dustScale);
      context.restore();
    }

    context.save();
    clipCone(outerRadiusX, outerRadiusY);
    const edgeBlend = context.createRadialGradient(
      display.centerX, display.centerY, dynamicRadiusX * .84,
      display.centerX, display.centerY, dynamicRadiusX
    );
    edgeBlend.addColorStop(0, "rgba(3, 4, 5, 0)");
    edgeBlend.addColorStop(.82, "rgba(3, 4, 5, 0)");
    edgeBlend.addColorStop(1, "rgba(3, 4, 5, .035)");
    context.fillStyle = edgeBlend;
    context.fillRect(display.x, display.y, display.width, display.height);

    const relief = context.createLinearGradient(display.centerX, display.y, display.centerX, display.y + display.height);
    if (leftV3.position >= 0) {
      relief.addColorStop(0, `rgba(255, 255, 255, ${depth * .075})`);
      relief.addColorStop(.42, "rgba(255, 255, 255, 0)");
      relief.addColorStop(.60, "rgba(0, 0, 0, 0)");
      relief.addColorStop(1, `rgba(0, 0, 0, ${depth * .12})`);
    } else {
      relief.addColorStop(0, `rgba(0, 0, 0, ${depth * .12})`);
      relief.addColorStop(.42, "rgba(0, 0, 0, 0)");
      relief.addColorStop(.60, "rgba(255, 255, 255, 0)");
      relief.addColorStop(1, `rgba(255, 255, 255, ${depth * .075})`);
    }
    context.fillStyle = relief;
    context.fillRect(display.x, display.y, display.width, display.height);
    const centerDepth = context.createRadialGradient(
      display.centerX, display.centerY, 0,
      display.centerX, display.centerY, dustRadiusX * 1.8
    );
    const centerColor = leftV3.position >= 0 ? "255, 255, 255" : "0, 0, 0";
    centerDepth.addColorStop(0, `rgba(${centerColor}, ${depth * .045})`);
    centerDepth.addColorStop(1, `rgba(${centerColor}, 0)`);
    context.fillStyle = centerDepth;
    context.fillRect(display.x, display.y, display.width, display.height);
    context.restore();

    drawLeftWooferV3Debug({
      signedLow,
      target: motionTarget,
      position: leftV3.position,
      leftBass: clamp(frame.leftBass)
    });
  };

  // Diagnostic-only raster proof. It executes before the inactive-frame gate,
  // so no AudioFrame, playback or production physics input is required.
  const drawForcedWooferDiagnostic = (id, forced, color) => {
    const component = target(id);
    const display = mapper.rectFor(component);
    const coneRatio = .75;
    const innerRadiusX = display.radiusX * coneRatio;
    const innerRadiusY = display.radiusY * coneRatio;
    const sourceScaleX = hardwareImage.naturalWidth / mapper.native.width;
    const sourceScaleY = hardwareImage.naturalHeight / mapper.native.height;
    const sourceRadiusX = component.radius * coneRatio * sourceScaleX;
    const sourceRadiusY = component.radius * coneRatio * sourceScaleY;
    const sourceCenterX = component.centerX * sourceScaleX;
    const sourceCenterY = component.centerY * sourceScaleY;
    const scale = 1 + forced * .25;
    const offsetY = (-6 + forced * 12) * display.metrics.scaleY;
    const width = innerRadiusX * 2 * scale;
    const height = innerRadiusY * 2 * scale;

    context.save();
    context.beginPath();
    context.ellipse(display.centerX, display.centerY, innerRadiusX, innerRadiusY, 0, 0, Math.PI * 2);
    context.clip();
    if (hardwareImage.complete && hardwareImage.naturalWidth > 0) {
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(
        hardwareImage,
        sourceCenterX - sourceRadiusX, sourceCenterY - sourceRadiusY, sourceRadiusX * 2, sourceRadiusY * 2,
        display.centerX - width * .5, display.centerY + offsetY - height * .5, width, height
      );
    }
    context.fillStyle = color.replace("ALPHA", ".22");
    context.beginPath(); context.ellipse(display.centerX, display.centerY, innerRadiusX * .35, innerRadiusY * .35, 0, 0, Math.PI * 2); context.fill();
    context.strokeStyle = color.replace("ALPHA", ".95");
    context.lineWidth = Math.max(1.5, Math.min(innerRadiusX, innerRadiusY) * .035);
    context.beginPath();
    context.moveTo(display.centerX - innerRadiusX * .58, display.centerY);
    context.lineTo(display.centerX + innerRadiusX * .58, display.centerY);
    context.moveTo(display.centerX, display.centerY - innerRadiusY * .58);
    context.lineTo(display.centerX, display.centerY + innerRadiusY * .58);
    context.stroke();
    context.restore();
  };

  const drawSpeakerDebugReadout = forced => {
    canvas.dataset.speakerDebug = "active";
    canvas.dataset.forced = forced.toFixed(3);
    context.save();
    context.fillStyle = "rgba(103, 231, 255, .98)";
    context.font = "700 12px ui-monospace, Consolas, monospace";
    context.fillText("SPEAKER DEBUG ACTIVE", 12, 20);
    context.fillText(`FORCED: ${forced.toFixed(2)}`, 12, 36);
    context.restore();
  };

  const drawSpeakerLiveProbe = frame => {
    const leftBass = clamp(frame.leftBass || 0);
    const rightBass = clamp(frame.rightBass || 0);
    const sub = clamp(frame.sub || 0);
    const kick = clamp(frame.kickEnergy || 0);
    const leftEnvelope = clamp(physics.getEnvelope("LEFT_SPEAKER_WOOFER"));
    const rightEnvelope = clamp(physics.getEnvelope("RIGHT_SPEAKER_WOOFER"));
    const leftExcursion = Math.max(0, physics.getExcursion("LEFT_SPEAKER_WOOFER"));
    const rightExcursion = Math.max(0, physics.getExcursion("RIGHT_SPEAKER_WOOFER"));
    const leftVisual = clamp(physics.getVisualExcursion("LEFT_SPEAKER_WOOFER"));
    const rightVisual = clamp(physics.getVisualExcursion("RIGHT_SPEAKER_WOOFER"));
    speakerLiveMaxima.leftBass = Math.max(speakerLiveMaxima.leftBass, leftBass);
    speakerLiveMaxima.rightBass = Math.max(speakerLiveMaxima.rightBass, rightBass);
    speakerLiveMaxima.leftVisual = Math.max(speakerLiveMaxima.leftVisual, leftVisual);
    speakerLiveMaxima.rightVisual = Math.max(speakerLiveMaxima.rightVisual, rightVisual);

    const status = !frame.active ? "NO AUDIO FRAME"
      : Math.max(leftBass, rightBass) < .05 ? "AUDIO INPUT TOO LOW"
        : Math.max(leftVisual, rightVisual) < .05 ? "PHYSICS OUTPUT TOO LOW"
          : "PHYSICS LIVE";
    const display = mapper.rectFor(target("LEFT_TOP_SPECTRUM"));
    const x = display.x + 6;
    const y = Math.max(14, display.y + 13);
    const lineHeight = Math.max(9, display.height * .078);
    const width = Math.min(display.width - 12, 220);
    const value = number => Number(number).toFixed(3);
    const lines = [
      "SPEAKER LIVE",
      `FRAME ACTIVE: ${frame.active ? "YES" : "NO"}`,
      `LEFT BASS: ${value(leftBass)}`,
      `RIGHT BASS: ${value(rightBass)}`,
      `SUB: ${value(sub)}`,
      `KICK: ${value(kick)}`,
      `LEFT WOOFER ENVELOPE: ${value(leftEnvelope)}`,
      `RIGHT WOOFER ENVELOPE: ${value(rightEnvelope)}`,
      `LEFT WOOFER EXCURSION: ${value(leftExcursion)}`,
      `RIGHT WOOFER EXCURSION: ${value(rightExcursion)}`,
      `LEFT VISUAL: ${value(leftVisual)}`,
      `RIGHT VISUAL: ${value(rightVisual)}`,
      `STATUS: ${status}`
    ];
    context.save();
    context.fillStyle = "rgba(3, 7, 11, .82)";
    context.fillRect(x - 4, y - lineHeight, width + 8, lines.length * lineHeight + lineHeight * 4.9);
    context.fillStyle = "rgba(110, 234, 255, .98)";
    context.font = `${Math.max(8, lineHeight * .82)}px ui-monospace, Consolas, monospace`;
    lines.forEach((line, index) => context.fillText(line, x, y + index * lineHeight));

    const bars = [["LEFT BASS", leftBass], ["RIGHT BASS", rightBass], ["LEFT VISUAL", leftVisual], ["RIGHT VISUAL", rightVisual]];
    const barY = y + lines.length * lineHeight + lineHeight * .45;
    const barWidth = width * .46;
    bars.forEach(([label, amount], index) => {
      const currentY = barY + index * lineHeight;
      context.fillStyle = "rgba(130, 152, 162, .75)";
      context.fillText(label, x, currentY);
      context.fillStyle = "rgba(44, 63, 71, .85)";
      context.fillRect(x + width * .52, currentY - lineHeight * .74, barWidth, lineHeight * .56);
      context.fillStyle = index > 1 ? "rgba(202, 229, 241, .96)" : "rgba(56, 219, 255, .96)";
      context.fillRect(x + width * .52, currentY - lineHeight * .74, barWidth * clamp(amount), lineHeight * .56);
    });
    context.restore();

    canvas.dataset.speakerLive = "active";
    canvas.dataset.speakerLiveStatus = status;
    canvas.dataset.leftBass = value(leftBass);
    canvas.dataset.rightBass = value(rightBass);
    canvas.dataset.leftVisual = value(leftVisual);
    canvas.dataset.rightVisual = value(rightVisual);
    canvas.dataset.maxLeftBass = value(speakerLiveMaxima.leftBass);
    canvas.dataset.maxRightBass = value(speakerLiveMaxima.rightBass);
    canvas.dataset.maxLeftVisual = value(speakerLiveMaxima.leftVisual);
    canvas.dataset.maxRightVisual = value(speakerLiveMaxima.rightVisual);
  };

  const render = frame => {
    clear();
    if (speakerDebug) {
      const forced = (Math.sin(performance.now() / 350) + 1) * .5;
      drawSpeakerDebugReadout(forced);
      drawForcedWooferDiagnostic("LEFT_SPEAKER_WOOFER", forced, "rgba(0, 238, 255, ALPHA)");
      drawForcedWooferDiagnostic("RIGHT_SPEAKER_WOOFER", 1 - forced, "rgba(255, 52, 220, ALPHA)");
      return;
    }
    if (!frame.active) {
      if (speakerV3) drawLeftWooferV3(frame);
      if (speakerLiveProbe) drawSpeakerLiveProbe(frame);
      return;
    }
    drawWaveform("LEFT_WAVEFORM_DISPLAY", frame.waveformLeft, frame.leftRms);
    drawWaveform("RIGHT_WAVEFORM_DISPLAY", frame.waveformRight, frame.rightRms);
    drawSpectrum(frame.fftMaster);
    drawChannelMeter("LEFT_CHANNEL_METER", frame.leftRms, frame.peakLeft);
    drawChannelMeter("RIGHT_CHANNEL_METER", frame.rightRms, frame.peakRight);
    drawVu("MASTER_LEFT_VU", frame.leftRms);
    drawVu("MASTER_RIGHT_VU", frame.rightRms);

    drawCenterRing(physics.getExcursion("CENTER_OUTER_RING"), physics.getMaximum("CENTER_OUTER_RING"));
    if (speakerV3) drawLeftWooferV3(frame);
    else drawDiaphragm("LEFT_SPEAKER_WOOFER", "woofer");
    drawDiaphragm("RIGHT_SPEAKER_WOOFER", "woofer");
    drawDiaphragm("LEFT_SPEAKER_LOWER", "lower");
    drawDiaphragm("RIGHT_SPEAKER_LOWER", "lower");
    drawDiaphragm("LEFT_SPEAKER_MID", "mid");
    drawDiaphragm("RIGHT_SPEAKER_MID", "mid");
    drawDiaphragm("LEFT_SPEAKER_TWEETER", "tweeter");
    drawDiaphragm("RIGHT_SPEAKER_TWEETER", "tweeter");
    if (speakerLiveProbe) drawSpeakerLiveProbe(frame);
  };

  return Object.freeze({ render, dispose: () => { observer.disconnect(); clear(); } });
}
