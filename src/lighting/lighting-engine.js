import { createShellMapper } from "../mapping/component-map.js";

const COLORS = Object.freeze({ gold: [244, 183, 62], amber: [255, 126, 37], violet: [144, 82, 255], blue: [48, 142, 255] });
const SPEAKER_IDS = Object.freeze([
  "LEFT_SPEAKER_TWEETER", "LEFT_SPEAKER_MID", "LEFT_SPEAKER_WOOFER", "LEFT_SPEAKER_LOWER",
  "RIGHT_SPEAKER_TWEETER", "RIGHT_SPEAKER_MID", "RIGHT_SPEAKER_WOOFER", "RIGHT_SPEAKER_LOWER"
]);
const PAD_IDS = Object.freeze([
  "LEFT_PAD_01", "LEFT_PAD_02", "LEFT_PAD_03", "LEFT_PAD_04", "RIGHT_PAD_01", "RIGHT_PAD_02", "RIGHT_PAD_03", "RIGHT_PAD_04", "MIXER_PAD_LEFT", "MIXER_PAD_RIGHT"
]);
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const mix = (left, right, amount) => left.map((value, index) => Math.round(value + (right[index] - value) * amount));
const rgba = (color, alpha) => `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;

export function createLightingEngine(canvas, state) {
  if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError("A lighting canvas is required.");
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("Canvas 2D is unavailable.");
  const shell = canvas.closest(".console-shell");
  const mapper = createShellMapper(shell);
  let settings = state.getLighting();
  let activePad = null;
  let activeUntil = 0;
  let beatWasActive = false;
  state.subscribeLighting(next => { settings = next; });

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

  const clear = () => { const { renderedWidth, renderedHeight } = mapper.metrics(); context.clearRect(0, 0, renderedWidth, renderedHeight); };
  const colorAt = now => {
    if (settings.mode === "static") return COLORS[settings.staticColor] || COLORS.gold;
    const palette = [COLORS.gold, COLORS.amber, COLORS.violet, COLORS.blue];
    const position = (now / 1000 / Math.max(15, settings.cycleSeconds || 45)) * palette.length;
    const index = Math.floor(position) % palette.length;
    return mix(palette[index], palette[(index + 1) % palette.length], position % 1);
  };
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
  const drawSpeakerRing = (id, color, alpha) => {
    const component = mapper.target(id);
    const display = mapper.rectFor(component);
    const radius = Math.min(display.radiusX, display.radiusY) * .83;
    context.save();
    context.strokeStyle = rgba(color, alpha);
    context.lineWidth = Math.max(1.1, radius * .075);
    context.shadowColor = rgba(color, alpha * .85);
    context.shadowBlur = Math.max(2, radius * .13);
    context.beginPath(); context.arc(display.centerX, display.centerY, radius, 0, Math.PI * 2); context.stroke();
    context.restore();
  };
  const drawPad = (id, color, alpha) => {
    const component = mapper.target(id);
    context.save(); path(component); context.clip();
    const display = mapper.rectFor(component);
    context.fillStyle = rgba(color, alpha); context.fillRect(display.x, display.y, display.width, display.height);
    context.restore();
  };
  const drawCenterStandby = now => {
    if (!settings.centerStandby) return;
    const component = mapper.target("CENTER_OUTER_RING");
    const display = mapper.rectFor(component);
    const alpha = .035 + (Math.sin(now * Math.PI / 4000) + 1) * .023;
    context.save(); context.strokeStyle = rgba(COLORS.gold, alpha); context.lineWidth = Math.max(1, display.radiusX * .010);
    context.beginPath(); context.arc(display.centerX, display.centerY, display.radiusX * .95, 0, Math.PI * 2); context.stroke(); context.restore();
  };

  const render = (frame, now) => {
    clear();
    const hasSpeakerLight = settings.speakerEnabled && settings.mode !== "off";
    const color = colorAt(now);
    if (hasSpeakerLight) {
      const bassBoost = settings.bassGlow && frame.active ? frame.bassEnergy * .36 : 0;
      const alpha = clamp(settings.brightness / 100 * .54 + bassBoost, 0, .92);
      SPEAKER_IDS.forEach(id => drawSpeakerRing(id, color, alpha));
    }
    if (!frame.active) drawCenterStandby(now);
    if (frame.active && frame.beat && !beatWasActive && Math.random() < clamp(settings.activityAmount / 100, .1, 1)) {
      activePad = PAD_IDS[Math.floor(Math.random() * PAD_IDS.length)];
      activeUntil = now + 95 + settings.activityAmount * 1.4;
    }
    beatWasActive = Boolean(frame.active && frame.beat);
    if (settings.activityEnabled && activePad && now < activeUntil) drawPad(activePad, color, .48 + settings.activityAmount / 200);
    if (now >= activeUntil) activePad = null;
  };

  return Object.freeze({ render, dispose: () => { observer.disconnect(); clear(); } });
}
