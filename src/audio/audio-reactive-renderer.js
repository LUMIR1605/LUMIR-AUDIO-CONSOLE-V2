import { createShellMapper } from "../mapping/component-map.js";

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export function createAudioReactiveRenderer(canvas, shell, physics) {
  if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError("An audio reactive canvas is required.");
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("Canvas 2D is unavailable.");
  const mapper = createShellMapper(shell);

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
    woofer: Object.freeze({ travel: .026, recess: .23, edge: .075 }),
    lower: Object.freeze({ travel: .014, recess: .14, edge: .045 }),
    mid: Object.freeze({ travel: .011, recess: .105, edge: .032 }),
    tweeter: Object.freeze({ travel: 0, recess: .042, edge: .014 })
  });

  // The canvas only shades the native, mapped diaphragm mask. It never moves or
  // scales the raster speaker cabinet, bezel, or a global overlay circle.
  const drawDiaphragm = (id, profileName) => {
    const strength = clamp(physics.getVisualExcursion(id), 0, 1.18);
    if (strength <= .002) return;
    const profile = DIAPHRAGM_PROFILES[profileName];
    const display = path(target(id));
    const radius = Math.min(display.radiusX, display.radiusY);
    const displacement = strength * radius * profile.travel;
    const depth = clamp(strength, 0, 1);

    context.save();
    context.clip();

    // A small, neutral shift of the local shading gives the cone a piston-like
    // forward/rearward excursion without colouring or outlining the driver.
    const cone = context.createRadialGradient(
      display.centerX, display.centerY + displacement, radius * .09,
      display.centerX, display.centerY + displacement, radius * .88
    );
    cone.addColorStop(0, `rgba(0, 0, 0, ${profile.recess * (.45 + depth * .55)})`);
    cone.addColorStop(.42, `rgba(0, 0, 0, ${profile.recess * (.14 + depth * .28)})`);
    cone.addColorStop(.74, "rgba(255, 255, 255, 0)");
    cone.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = cone;
    context.fillRect(display.x, display.y, display.width, display.height);

    if (profile.edge > 0) {
      const pressure = context.createLinearGradient(display.centerX, display.y, display.centerX, display.y + display.height);
      pressure.addColorStop(0, `rgba(255, 255, 255, ${profile.edge * depth})`);
      pressure.addColorStop(.34, "rgba(255, 255, 255, 0)");
      pressure.addColorStop(.72, "rgba(0, 0, 0, 0)");
      pressure.addColorStop(1, `rgba(0, 0, 0, ${profile.edge * (1 + depth)})`);
      context.fillStyle = pressure;
      context.fillRect(display.x, display.y, display.width, display.height);
    }
    context.restore();
  };

  const render = frame => {
    clear();
    if (!frame.active) return;
    drawWaveform("LEFT_WAVEFORM_DISPLAY", frame.waveformLeft, frame.leftRms);
    drawWaveform("RIGHT_WAVEFORM_DISPLAY", frame.waveformRight, frame.rightRms);
    drawSpectrum(frame.fftMaster);
    drawChannelMeter("LEFT_CHANNEL_METER", frame.leftRms, frame.peakLeft);
    drawChannelMeter("RIGHT_CHANNEL_METER", frame.rightRms, frame.peakRight);
    drawVu("MASTER_LEFT_VU", frame.leftRms);
    drawVu("MASTER_RIGHT_VU", frame.rightRms);

    drawCenterRing(physics.getExcursion("CENTER_OUTER_RING"), physics.getMaximum("CENTER_OUTER_RING"));
    drawDiaphragm("LEFT_SPEAKER_WOOFER", "woofer");
    drawDiaphragm("RIGHT_SPEAKER_WOOFER", "woofer");
    drawDiaphragm("LEFT_SPEAKER_LOWER", "lower");
    drawDiaphragm("RIGHT_SPEAKER_LOWER", "lower");
    drawDiaphragm("LEFT_SPEAKER_MID", "mid");
    drawDiaphragm("RIGHT_SPEAKER_MID", "mid");
    drawDiaphragm("LEFT_SPEAKER_TWEETER", "tweeter");
    drawDiaphragm("RIGHT_SPEAKER_TWEETER", "tweeter");
  };

  return Object.freeze({ render, dispose: () => { observer.disconnect(); clear(); } });
}
