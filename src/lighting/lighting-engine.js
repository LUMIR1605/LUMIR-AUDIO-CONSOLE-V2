import { createShellMapper } from "../mapping/component-map.js";

const COLORS = Object.freeze({ gold: [244, 183, 62] });
const rgba = (color, alpha) => `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;

export function createLightingEngine(canvas, state) {
  if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError("A lighting canvas is required.");
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("Canvas 2D is unavailable.");
  const shell = canvas.closest(".console-shell");
  const mapper = createShellMapper(shell);
  let settings = state.getLighting();
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
    if (!frame.active) drawCenterStandby(now);
  };

  return Object.freeze({ render, dispose: () => { observer.disconnect(); clear(); } });
}
