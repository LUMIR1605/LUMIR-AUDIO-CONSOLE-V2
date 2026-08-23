import { createShellMapper } from "../mapping/component-map.js";

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

const CUSTOM_CONTROLS = Object.freeze([
  { id: "LEFT_CHANNEL_FADER", kind: "fader", x: 676, y: 740, width: 31, height: 112, property: "left", min: 0, max: 1, label: "LEFT CHANNEL" },
  { id: "MASTER_FADER", kind: "fader", x: 824, y: 740, width: 31, height: 112, property: "master", min: 0, max: 1.2, label: "MASTER VOLUME" },
  { id: "RIGHT_CHANNEL_FADER", kind: "fader", x: 968, y: 740, width: 31, height: 112, property: "right", min: 0, max: 1, label: "RIGHT CHANNEL" },
  { id: "MASTER_GAIN", kind: "knob", x: 838, y: 723, radius: 16, property: "master", min: 0, max: 1.2, sensitivity: .008, label: "MASTER GAIN" },
  { id: "LOW_EQ", kind: "knob", x: 717, y: 723, radius: 14, property: "low", min: -12, max: 12, sensitivity: .18, label: "LOW / BASS" },
  { id: "MID_EQ", kind: "knob", x: 778, y: 723, radius: 14, property: "mid", min: -12, max: 12, sensitivity: .18, label: "MID" },
  { id: "HIGH_EQ", kind: "knob", x: 955, y: 723, radius: 14, property: "high", min: -12, max: 12, sensitivity: .18, label: "HIGH" }
]);

const COMPONENT_CONTROLS = Object.freeze([
  { id: "CROSSFADER", kind: "crossfader", target: "CROSSFADE", property: "crossfader", min: -1, max: 1, label: "CROSSFADER" },
  { id: "LEFT_JOG", kind: "jog", target: "LEFT_JOG", label: "LEFT JOG" },
  { id: "RIGHT_JOG", kind: "jog", target: "RIGHT_JOG", label: "RIGHT JOG" },
  { id: "LEFT_PAD_01", kind: "button", target: "LEFT_PAD_01", action: "playPause", label: "PLAY / PAUSE" },
  { id: "LEFT_PAD_02", kind: "button", target: "LEFT_PAD_02", action: "cue", label: "LEFT CUE" },
  { id: "LEFT_PAD_03", kind: "disabled", target: "LEFT_PAD_03", label: "SYNC · DISABLED" },
  { id: "LEFT_PAD_04", kind: "button", target: "LEFT_PAD_04", action: "prev", label: "PREVIOUS" },
  { id: "RIGHT_PAD_01", kind: "button", target: "RIGHT_PAD_01", action: "next", label: "NEXT" },
  { id: "RIGHT_PAD_02", kind: "button", target: "RIGHT_PAD_02", action: "cue", label: "RIGHT CUE" },
  { id: "RIGHT_PAD_03", kind: "disabled", target: "RIGHT_PAD_03", label: "SYNC · DISABLED" },
  { id: "RIGHT_PAD_04", kind: "button", target: "RIGHT_PAD_04", action: "mute", label: "MASTER MUTE" },
  { id: "MIXER_PAD_LEFT", kind: "button", target: "MIXER_PAD_LEFT", action: "mute", label: "MASTER MUTE" },
  { id: "MIXER_PAD_RIGHT", kind: "button", target: "MIXER_PAD_RIGHT", action: "center", label: "CENTER SELECT" }
]);

const pointInPolygon = (x, y, points) => {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i], [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

export function createHardwareControls({ inputSurface, feedbackCanvas, shell, playlist, audio, getMixer, setMixer, onCenter }) {
  const mapper = createShellMapper(shell);
  const context = feedbackCanvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("Hardware feedback Canvas 2D is unavailable.");
  let active = null;
  let activePointerId = null;
  let lastX = 0;
  let lastY = 0;
  let pressed = null;
  let pressedUntil = 0;
  let cuePoint = 0;
  let message = "";
  let messageUntil = 0;

  const resize = () => {
    const { renderedWidth, renderedHeight, devicePixelRatio } = mapper.metrics();
    feedbackCanvas.width = Math.max(1, Math.round(renderedWidth * devicePixelRatio));
    feedbackCanvas.height = Math.max(1, Math.round(renderedHeight * devicePixelRatio));
    feedbackCanvas.style.width = `${renderedWidth}px`;
    feedbackCanvas.style.height = `${renderedHeight}px`;
    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(shell);
  resize();

  const toNative = event => {
    const metrics = mapper.metrics();
    return { x: (event.clientX - metrics.offsetX) / metrics.scaleX, y: (event.clientY - metrics.offsetY) / metrics.scaleY };
  };
  const customContains = (control, point) => control.kind === "knob"
    ? Math.hypot(point.x - control.x, point.y - control.y) <= control.radius
    : point.x >= control.x && point.x <= control.x + control.width && point.y >= control.y && point.y <= control.y + control.height;
  const componentContains = (control, point) => {
    const target = mapper.target(control.target);
    if (target.mask === "circle") return Math.hypot(point.x - target.centerX, point.y - target.centerY) <= target.radius;
    if (target.mask === "ellipse") return ((point.x - target.centerX) / target.radiusX) ** 2 + ((point.y - target.centerY) / target.radiusY) ** 2 <= 1;
    if (target.mask === "polygon") return pointInPolygon(point.x, point.y, target.points);
    return point.x >= target.x && point.x <= target.x + target.width && point.y >= target.y && point.y <= target.y + target.height;
  };
  const hitTest = point => COMPONENT_CONTROLS.find(control => componentContains(control, point)) || CUSTOM_CONTROLS.find(control => customContains(control, point));
  const announce = (text, now = performance.now()) => { message = text; messageUntil = now + 1350; };
  const press = (control, now) => { pressed = control; pressedUntil = now + 150; };
  const format = (property, value) => property === "crossfader" ? `${Math.round(value * 100)}` : property === "low" || property === "mid" || property === "high" ? `${value >= 0 ? "+" : ""}${value.toFixed(1)} dB` : `${Math.round(value * 100)}%`;

  const setControl = (control, value, now) => {
    const next = clamp(value, control.min, control.max);
    setMixer({ [control.property]: next });
    announce(`${control.label}: ${format(control.property, next)}`, now);
  };
  const invoke = (control, now) => {
    press(control, now);
    if (control.kind === "disabled") { announce(control.label, now); return; }
    if (control.action === "playPause") { playlist.playPause(); announce("PLAY / PAUSE", now); }
    else if (control.action === "prev") { playlist.prev(); announce("PREVIOUS", now); }
    else if (control.action === "next") { playlist.next(); announce("NEXT", now); }
    else if (control.action === "mute") { const muted = !getMixer().mute; setMixer({ mute: muted }); announce(muted ? "MASTER MUTE: ON" : "MASTER MUTE: OFF", now); }
    else if (control.action === "center") { onCenter(); announce("CENTER SELECT", now); }
    else if (control.action === "cue") {
      if (audio.paused) { audio.currentTime = cuePoint; announce(`${control.label}: ${cuePoint.toFixed(1)}s`, now); }
      else { cuePoint = audio.currentTime; audio.pause(); announce(`${control.label} SET: ${cuePoint.toFixed(1)}s`, now); }
    }
  };
  const moveControl = (control, point, event, now) => {
    if (control.kind === "fader") setControl(control, control.max - (point.y - control.y) / control.height * (control.max - control.min), now);
    else if (control.kind === "crossfader") {
      const target = mapper.target(control.target);
      setControl(control, control.min + (point.x - target.x) / target.width * (control.max - control.min), now);
    } else if (control.kind === "knob") {
      const current = getMixer()[control.property];
      setControl(control, current + (lastY - event.clientY) * control.sensitivity, now);
    } else if (control.kind === "jog") {
      if (Number.isFinite(audio.duration)) audio.currentTime = clamp(audio.currentTime + (event.clientX - lastX) * .022, 0, Math.max(0, audio.duration - .03));
      announce(`${control.label}: ${audio.currentTime.toFixed(1)}s`, now);
    }
  };

  const onPointerDown = event => {
    const point = toNative(event), control = hitTest(point), now = performance.now();
    if (!control) return;
    event.preventDefault();
    active = control; activePointerId = event.pointerId; lastX = event.clientX; lastY = event.clientY;
    inputSurface.setPointerCapture(event.pointerId);
    if (control.kind === "button" || control.kind === "disabled") invoke(control, now);
    else { press(control, now); moveControl(control, point, event, now); }
  };
  const onPointerMove = event => {
    if (!active || event.pointerId !== activePointerId) {
      const control = hitTest(toNative(event));
      inputSurface.style.cursor = control ? (control.kind === "fader" ? "ns-resize" : control.kind === "crossfader" || control.kind === "jog" ? "ew-resize" : "pointer") : "default";
      return;
    }
    event.preventDefault(); moveControl(active, toNative(event), event, performance.now()); lastX = event.clientX; lastY = event.clientY;
  };
  const endPointer = event => {
    if (event.pointerId !== activePointerId) return;
    if (inputSurface.hasPointerCapture(event.pointerId)) inputSurface.releasePointerCapture(event.pointerId);
    active = null; activePointerId = null; inputSurface.style.cursor = "default";
  };
  const onWheel = event => {
    const control = hitTest(toNative(event));
    if (!control || control.kind !== "knob") return;
    event.preventDefault(); press(control, performance.now()); setControl(control, getMixer()[control.property] - event.deltaY * control.sensitivity * .18, performance.now());
  };
  inputSurface.addEventListener("pointerdown", onPointerDown);
  inputSurface.addEventListener("pointermove", onPointerMove);
  inputSurface.addEventListener("pointerup", endPointer);
  inputSurface.addEventListener("pointercancel", endPointer);
  inputSurface.addEventListener("wheel", onWheel, { passive: false });

  const pathTarget = component => {
    const display = mapper.rectFor(component);
    context.beginPath();
    if (component.mask === "circle") context.arc(display.centerX, display.centerY, display.radiusX, 0, Math.PI * 2);
    else if (component.mask === "polygon") component.points.forEach(([x, y], index) => {
      const point = mapper.toDisplayed(x, y);
      if (index === 0) context.moveTo(point.x, point.y); else context.lineTo(point.x, point.y);
    });
    else context.rect(display.x, display.y, display.width, display.height);
    if (component.mask === "polygon") context.closePath();
    return display;
  };
  const displayedCustom = control => ({ x: control.x * mapper.metrics().scaleX, y: control.y * mapper.metrics().scaleY, width: (control.width || control.radius * 2) * mapper.metrics().scaleX, height: (control.height || control.radius * 2) * mapper.metrics().scaleY, radius: control.radius * mapper.metrics().scaleX });
  const drawFader = (control, value) => {
    const display = displayedCustom(control);
    const t = (value - control.min) / (control.max - control.min);
    const y = display.y + display.height * (1 - t);
    context.fillStyle = "rgba(245, 190, 76, .18)"; context.fillRect(display.x + display.width * .42, display.y, display.width * .16, display.height);
    context.fillStyle = "rgba(255, 215, 116, .78)"; context.fillRect(display.x + display.width * .14, y - Math.max(2, display.height * .025), display.width * .72, Math.max(4, display.height * .05));
  };
  const drawKnob = (control, value) => {
    const display = displayedCustom(control);
    const centerX = display.x, centerY = display.y, angle = Math.PI * (.75 + (value - control.min) / (control.max - control.min) * 1.5);
    context.strokeStyle = "rgba(245, 190, 76, .50)"; context.lineWidth = Math.max(1, display.radius * .12);
    context.beginPath(); context.arc(centerX, centerY, display.radius * .74, Math.PI * .75, Math.PI * 2.25); context.stroke();
    context.strokeStyle = "rgba(255, 226, 145, .88)"; context.lineWidth = Math.max(1, display.radius * .15);
    context.beginPath(); context.moveTo(centerX, centerY); context.lineTo(centerX + Math.cos(angle) * display.radius * .58, centerY + Math.sin(angle) * display.radius * .58); context.stroke();
  };
  const drawCrossfader = value => {
    const display = mapper.rectFor(mapper.target("CROSSFADE"));
    const x = display.x + (value + 1) * .5 * display.width;
    context.fillStyle = "rgba(255, 215, 116, .72)"; context.fillRect(x - Math.max(2, display.width * .018), display.y + display.height * .13, Math.max(4, display.width * .036), display.height * .72);
  };
  const drawPressed = control => {
    context.save(); context.fillStyle = "rgba(255, 189, 53, .36)"; context.strokeStyle = "rgba(255, 232, 145, .95)"; context.lineWidth = 1.3;
    if (control.target) { pathTarget(mapper.target(control.target)); context.fill(); context.stroke(); }
    else if (control.kind === "knob") { const display = displayedCustom(control); context.beginPath(); context.arc(display.x, display.y, display.radius, 0, Math.PI * 2); context.fill(); context.stroke(); }
    else { const display = displayedCustom(control); context.fillRect(display.x, display.y, display.width, display.height); context.strokeRect(display.x, display.y, display.width, display.height); }
    context.restore();
  };

  const render = now => {
    const { renderedWidth, renderedHeight } = mapper.metrics(); context.clearRect(0, 0, renderedWidth, renderedHeight);
    const mixer = getMixer();
    CUSTOM_CONTROLS.filter(control => control.kind === "fader").forEach(control => drawFader(control, mixer[control.property]));
    CUSTOM_CONTROLS.filter(control => control.kind === "knob").forEach(control => drawKnob(control, mixer[control.property]));
    drawCrossfader(mixer.crossfader);
    if (pressed && now < pressedUntil) drawPressed(pressed); else if (now >= pressedUntil) pressed = null;
    return now < messageUntil ? message : "";
  };

  return Object.freeze({
    render,
    dispose: () => { observer.disconnect(); inputSurface.removeEventListener("pointerdown", onPointerDown); inputSurface.removeEventListener("pointermove", onPointerMove); inputSurface.removeEventListener("pointerup", endPointer); inputSurface.removeEventListener("pointercancel", endPointer); inputSurface.removeEventListener("wheel", onWheel); }
  });
}
