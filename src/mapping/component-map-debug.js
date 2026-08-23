import { createShellMapper } from "./component-map.js";

const COLORS = Object.freeze({
  ring: "#ffe06c", "visual-surface": "#7ed8ff", "speaker-driver": "#f58b4c",
  spectrum: "#8df2bd", waveform: "#7ed8ff", "channel-display": "#c58cff",
  vu: "#ffb34f", "driver-display": "#f58b4c", "analog-vu": "#ffdb77",
  jog: "#5fe1df", "logical-region": "#c4ff75", fader: "#d7a8ff",
  "activity-pad": "#ff766e"
});

export function createComponentMapDebug(canvas, shell) {
  if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError("A debug canvas is required.");
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("Canvas 2D is unavailable.");
  const mapper = createShellMapper(shell);
  let enabled = false;

  const resize = () => {
    const { renderedWidth, renderedHeight, devicePixelRatio } = mapper.metrics();
    canvas.width = Math.max(1, Math.round(renderedWidth * devicePixelRatio));
    canvas.height = Math.max(1, Math.round(renderedHeight * devicePixelRatio));
    canvas.style.width = `${renderedWidth}px`;
    canvas.style.height = `${renderedHeight}px`;
    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    draw();
  };

  const label = (text, x, y, color, { compact = false, centered = false } = {}) => {
    const size = compact ? Math.max(6, Math.min(8, mapper.metrics().renderedWidth / 220)) : Math.max(7, Math.min(10, mapper.metrics().renderedWidth / 165));
    context.font = `700 ${size}px ui-monospace, Consolas, monospace`;
    const width = context.measureText(text).width + 6;
    const left = centered ? x - width / 2 : x;
    context.fillStyle = "rgba(0, 0, 0, .74)";
    context.fillRect(left, y - size - 4, width, size + 5);
    context.fillStyle = color;
    context.fillText(text, left + 3, y - 3);
  };

  const padLabel = id => {
    if (id === "MIXER_PAD_LEFT") return "ML";
    if (id === "MIXER_PAD_RIGHT") return "MR";
    const match = id.match(/^(LEFT|RIGHT)_PAD_(\d{2})$/);
    return match ? `${match[1] === "LEFT" ? "L" : "R"}${Number(match[2])}` : id;
  };

  const outline = component => {
    const display = mapper.rectFor(component);
    const color = COLORS[component.type] || "#ffffff";
    context.save();
    context.strokeStyle = color;
    context.fillStyle = color;
    context.globalAlpha = component.type === "activity-pad" ? .94 : .84;
    context.lineWidth = component.type === "activity-pad" ? 1 : 1.2;
    context.setLineDash(component.type === "activity-pad" ? [2, 2] : []);
    context.beginPath();
    if (component.mask === "circle") context.arc(display.centerX, display.centerY, display.radiusX, 0, Math.PI * 2);
    else if (component.mask === "ellipse") context.ellipse(display.centerX, display.centerY, display.radiusX, display.radiusY, 0, 0, Math.PI * 2);
    else if (component.mask === "polygon") {
      component.points.forEach(([x, y], index) => {
        const point = mapper.toDisplayed(x, y);
        if (index === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      });
      context.closePath();
    } else context.rect(display.x, display.y, display.width, display.height);
    context.stroke();
    context.setLineDash([]);
    if (component.type === "activity-pad") {
      const below = /PAD_0[34]$/.test(component.id);
      label(padLabel(component.id), display.x + display.width / 2, below ? display.y + display.height + 10 : display.y - 2, color, { compact: true, centered: true });
    } else label(component.id, display.x + 2, display.y + 12, color);
    context.restore();
  };

  const proof = () => {
    const woofer = mapper.rectFor("LEFT_SPEAKER_WOOFER");
    context.save();
    context.globalCompositeOperation = "screen";
    context.strokeStyle = "rgba(255, 196, 71, .92)";
    context.shadowColor = "rgba(255, 170, 40, .96)";
    context.shadowBlur = Math.max(4, woofer.radiusX * .14);
    context.lineWidth = Math.max(1.1, woofer.radiusX * .024);
    context.beginPath();
    context.arc(woofer.centerX, woofer.centerY, woofer.radiusX * .92, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  };

  function draw() {
    const { renderedWidth, renderedHeight } = mapper.metrics();
    context.clearRect(0, 0, renderedWidth, renderedHeight);
    if (!enabled) return;
    mapper.targets.forEach(outline);
    proof();
  }

  const observer = new ResizeObserver(resize);
  observer.observe(shell);
  resize();

  return Object.freeze({
    mapper,
    setEnabled: value => { enabled = Boolean(value); canvas.hidden = !enabled; draw(); },
    toggle: () => { enabled = !enabled; canvas.hidden = !enabled; draw(); return enabled; },
    isEnabled: () => enabled,
    redraw: draw,
    dispose: () => observer.disconnect()
  });
}
