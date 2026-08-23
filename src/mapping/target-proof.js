import { createShellMapper } from "./component-map.js";

export const TARGET_PROOF_IDS = Object.freeze([
  "CENTER_OUTER_RING", "CENTER_INNER_VISUAL_SURFACE",
  "LEFT_SPEAKER_TWEETER", "LEFT_SPEAKER_MID", "LEFT_SPEAKER_WOOFER", "LEFT_SPEAKER_LOWER",
  "RIGHT_SPEAKER_TWEETER", "RIGHT_SPEAKER_MID", "RIGHT_SPEAKER_WOOFER", "RIGHT_SPEAKER_LOWER",
  "LEFT_WAVEFORM_DISPLAY", "RIGHT_WAVEFORM_DISPLAY", "LEFT_CHANNEL_METER", "RIGHT_CHANNEL_METER",
  "SPECTRUM_DISPLAY", "MASTER_LEFT_VU", "MASTER_RIGHT_VU", "LEFT_JOG", "RIGHT_JOG",
  "LEFT_PAD_01", "LEFT_PAD_02", "LEFT_PAD_03", "LEFT_PAD_04",
  "RIGHT_PAD_01", "RIGHT_PAD_02", "RIGHT_PAD_03", "RIGHT_PAD_04", "MIXER_PAD_LEFT", "MIXER_PAD_RIGHT"
]);

const PROOF_LABELS = Object.freeze({
  LEFT_PAD_01: "L1 · LEFT_PAD_01", LEFT_PAD_02: "L2 · LEFT_PAD_02",
  LEFT_PAD_03: "L3 · LEFT_PAD_03", LEFT_PAD_04: "L4 · LEFT_PAD_04",
  RIGHT_PAD_01: "R1 · RIGHT_PAD_01", RIGHT_PAD_02: "R2 · RIGHT_PAD_02",
  RIGHT_PAD_03: "R3 · RIGHT_PAD_03", RIGHT_PAD_04: "R4 · RIGHT_PAD_04",
  MIXER_PAD_LEFT: "ML · MIXER_PAD_LEFT", MIXER_PAD_RIGHT: "MR · MIXER_PAD_RIGHT"
});

const ACTIVE_MS = 700;
const GAP_MS = 250;
const STEP_MS = ACTIVE_MS + GAP_MS;

export function createTargetProof(canvas, shell, readout) {
  if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError("A target-proof canvas is required.");
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("Canvas 2D is unavailable.");
  const mapper = createShellMapper(shell);
  let enabled = false;
  let animationId = 0;
  let startedAt = 0;

  const resize = () => {
    const { renderedWidth, renderedHeight, devicePixelRatio } = mapper.metrics();
    canvas.width = Math.max(1, Math.round(renderedWidth * devicePixelRatio));
    canvas.height = Math.max(1, Math.round(renderedHeight * devicePixelRatio));
    canvas.style.width = `${renderedWidth}px`;
    canvas.style.height = `${renderedHeight}px`;
    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  };

  const pathFor = component => {
    const display = mapper.rectFor(component);
    context.beginPath();
    if (component.mask === "circle") context.arc(display.centerX, display.centerY, display.radiusX, 0, Math.PI * 2);
    else if (component.mask === "ellipse") context.ellipse(display.centerX, display.centerY, display.radiusX, display.radiusY, 0, 0, Math.PI * 2);
    else if (component.mask === "polygon") component.points.forEach(([x, y], index) => {
      const point = mapper.toDisplayed(x, y);
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    else context.rect(display.x, display.y, display.width, display.height);
    if (component.mask === "polygon") context.closePath();
    return display;
  };

  const drawRing = component => {
    const display = mapper.rectFor(component);
    const thickness = Math.max(4, display.radiusX * .072);
    context.beginPath();
    context.arc(display.centerX, display.centerY, display.radiusX, 0, Math.PI * 2);
    context.arc(display.centerX, display.centerY, Math.max(0, display.radiusX - thickness), 0, Math.PI * 2, true);
    context.fill("evenodd");
    context.beginPath();
    context.arc(display.centerX, display.centerY, display.radiusX - thickness / 2, 0, Math.PI * 2);
    context.stroke();
  };

  const drawTarget = component => {
    context.save();
    context.globalCompositeOperation = "source-over";
    context.fillStyle = "rgba(255, 190, 52, .27)";
    context.strokeStyle = "rgba(255, 238, 157, .98)";
    context.lineWidth = Math.max(1.25, mapper.metrics().renderedWidth * .00175);
    if (component.type === "ring") drawRing(component);
    else {
      pathFor(component);
      context.fill();
      context.stroke();
    }
    context.restore();
  };

  const clear = () => {
    const { renderedWidth, renderedHeight } = mapper.metrics();
    context.clearRect(0, 0, renderedWidth, renderedHeight);
  };

  const frame = now => {
    if (!enabled) return;
    const elapsed = now - startedAt;
    const slot = Math.floor(elapsed / STEP_MS) % TARGET_PROOF_IDS.length;
    const inGap = elapsed % STEP_MS >= ACTIVE_MS;
    clear();
    const id = TARGET_PROOF_IDS[slot];
    if (inGap) readout.textContent = "TARGET PROOF: —";
    else {
      drawTarget(mapper.target(id));
      readout.textContent = `TARGET PROOF: ${PROOF_LABELS[id] || id}`;
    }
    animationId = requestAnimationFrame(frame);
  };

  const observer = new ResizeObserver(resize);
  observer.observe(shell);
  resize();

  return Object.freeze({
    ids: TARGET_PROOF_IDS,
    start: () => {
      if (enabled) return;
      enabled = true;
      canvas.hidden = false;
      startedAt = performance.now();
      animationId = requestAnimationFrame(frame);
    },
    stop: () => {
      enabled = false;
      cancelAnimationFrame(animationId);
      animationId = 0;
      canvas.hidden = true;
      clear();
      readout.textContent = "TARGET PROOF: OFF";
    },
    isRunning: () => enabled,
    dispose: () => { observer.disconnect(); cancelAnimationFrame(animationId); }
  });
}
