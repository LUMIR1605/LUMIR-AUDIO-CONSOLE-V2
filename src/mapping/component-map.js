export const NATIVE_SHELL = Object.freeze({ width: 1672, height: 941 });

const circle = (id, type, centerX, centerY, radius, extra = {}) => Object.freeze({
  id, type, x: centerX - radius, y: centerY - radius, width: radius * 2, height: radius * 2,
  centerX, centerY, radius, mask: "circle", ...extra
});

const ellipse = (id, type, centerX, centerY, radiusX, radiusY, extra = {}) => Object.freeze({
  id, type, x: centerX - radiusX, y: centerY - radiusY, width: radiusX * 2, height: radiusY * 2,
  centerX, centerY, radius: Math.min(radiusX, radiusY), radiusX, radiusY, mask: "ellipse", ...extra
});

const rect = (id, type, x, y, width, height, extra = {}) => Object.freeze({
  id, type, x, y, width, height, mask: "rect", ...extra
});

const quad = (id, type, points, extra = {}) => {
  const xs = points.map(([x]) => x), ys = points.map(([, y]) => y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return Object.freeze({ id, type, x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y, mask: "polygon", points: Object.freeze(points.map(point => Object.freeze([...point]))), ...extra });
};

// Measurements are in the native 1672 × 941 pixel space of lumir-v2-hardware-shell.png.
// They intentionally describe this shell only; no coordinates from an older console are used.
export const COMPONENT_MAP = Object.freeze([
  circle("CENTER_OUTER_RING", "ring", 836, 274, 254),
  ellipse("CENTER_INNER_VISUAL_SURFACE", "visual-surface", 836, 271, 158, 160),

  circle("LEFT_SPEAKER_TWEETER", "speaker-driver", 118, 59, 30),
  circle("LEFT_SPEAKER_MID", "speaker-driver", 118, 143, 32),
  circle("LEFT_SPEAKER_WOOFER", "speaker-driver", 116, 299, 78),
  circle("LEFT_SPEAKER_LOWER", "speaker-driver", 116, 505, 77),
  circle("RIGHT_SPEAKER_TWEETER", "speaker-driver", 1554, 59, 30),
  circle("RIGHT_SPEAKER_MID", "speaker-driver", 1554, 143, 32),
  circle("RIGHT_SPEAKER_WOOFER", "speaker-driver", 1555, 299, 78),
  circle("RIGHT_SPEAKER_LOWER", "speaker-driver", 1555, 505, 77),

  rect("LEFT_TOP_SPECTRUM", "spectrum", 235, 52, 332, 130),
  rect("RIGHT_TOP_SPECTRUM", "spectrum", 1105, 52, 332, 130),
  rect("LEFT_WAVEFORM_DISPLAY", "waveform", 235, 190, 332, 186),
  rect("RIGHT_WAVEFORM_DISPLAY", "waveform", 1105, 190, 332, 186),
  rect("LEFT_CHANNEL_METER", "channel-display", 236, 384, 170, 235),
  rect("RIGHT_CHANNEL_METER", "channel-display", 1266, 384, 170, 235),
  rect("LEFT_VU", "vu", 272, 418, 112, 174),
  rect("RIGHT_VU", "vu", 1288, 418, 112, 174),
  rect("LEFT_BASS_DRIVER_DISPLAY", "driver-display", 408, 386, 152, 230),
  rect("RIGHT_BASS_DRIVER_DISPLAY", "driver-display", 1112, 386, 152, 230),
  rect("SPECTRUM_DISPLAY", "spectrum", 578, 466, 516, 143),
  rect("MASTER_VU_PANEL", "logical-region", 673, 619, 327, 91, { effectTarget: false }),
  rect("MASTER_LEFT_VU", "analog-vu", 689, 634, 124, 61),
  rect("MASTER_RIGHT_VU", "analog-vu", 854, 634, 124, 61),

  circle("LEFT_JOG", "jog", 336, 782, 78),
  circle("RIGHT_JOG", "jog", 1336, 782, 78),
  rect("LEFT_PAD_BANK", "logical-region", 13, 808, 221, 82, { effectTarget: false }),
  rect("RIGHT_PAD_BANK", "logical-region", 1438, 808, 221, 82, { effectTarget: false }),
  rect("CENTRAL_MIXER", "logical-region", 522, 698, 629, 206, { effectTarget: false }),
  rect("CROSSFADE", "fader", 755, 860, 163, 34),

  // The lit pad faces are trapezoids in the raster because of deck perspective.
  // Polygon masks keep a future glow inside the physical face, not its label or bezel.
  quad("LEFT_PAD_01", "activity-pad", [[48, 820], [87, 820], [75, 838], [37, 838]]),
  quad("LEFT_PAD_02", "activity-pad", [[95, 820], [134, 820], [122, 838], [84, 838]]),
  quad("LEFT_PAD_03", "activity-pad", [[42, 841], [80, 841], [56, 861], [18, 861]]),
  quad("LEFT_PAD_04", "activity-pad", [[88, 841], [126, 841], [104, 861], [65, 861]]),
  quad("RIGHT_PAD_01", "activity-pad", [[1540, 820], [1581, 820], [1591, 838], [1552, 838]]),
  quad("RIGHT_PAD_02", "activity-pad", [[1588, 820], [1629, 820], [1639, 838], [1600, 838]]),
  quad("RIGHT_PAD_03", "activity-pad", [[1561, 841], [1602, 841], [1607, 861], [1570, 861]]),
  quad("RIGHT_PAD_04", "activity-pad", [[1608, 841], [1648, 841], [1653, 861], [1619, 861]]),
  rect("MIXER_PAD_LEFT", "activity-pad", 604, 805, 16, 14),
  rect("MIXER_PAD_RIGHT", "activity-pad", 1047, 805, 16, 14)
]);

export function createShellMapper(shell) {
  if (!(shell instanceof HTMLElement)) throw new TypeError("A console shell element is required.");

  const metrics = () => {
    const bounds = shell.getBoundingClientRect();
    const scaleX = bounds.width / NATIVE_SHELL.width;
    const scaleY = bounds.height / NATIVE_SHELL.height;
    return Object.freeze({
      nativeWidth: NATIVE_SHELL.width,
      nativeHeight: NATIVE_SHELL.height,
      renderedWidth: bounds.width,
      renderedHeight: bounds.height,
      scaleX,
      scaleY,
      offsetX: bounds.left,
      offsetY: bounds.top,
      devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2)
    });
  };

  const target = id => {
    const found = COMPONENT_MAP.find(component => component.id === id);
    if (!found) throw new Error(`Unknown shell target: ${id}`);
    return found;
  };

  const toDisplayed = (nativeX, nativeY) => {
    const current = metrics();
    return Object.freeze({ x: nativeX * current.scaleX, y: nativeY * current.scaleY, metrics: current });
  };

  const toViewport = (nativeX, nativeY) => {
    const local = toDisplayed(nativeX, nativeY);
    return Object.freeze({ x: local.x + local.metrics.offsetX, y: local.y + local.metrics.offsetY, metrics: local.metrics });
  };

  const rectFor = value => {
    const component = typeof value === "string" ? target(value) : value;
    const current = metrics();
    return Object.freeze({
      x: component.x * current.scaleX,
      y: component.y * current.scaleY,
      width: component.width * current.scaleX,
      height: component.height * current.scaleY,
      centerX: component.centerX == null ? undefined : component.centerX * current.scaleX,
      centerY: component.centerY == null ? undefined : component.centerY * current.scaleY,
      radiusX: component.radiusX == null ? component.radius == null ? undefined : component.radius * current.scaleX : component.radiusX * current.scaleX,
      radiusY: component.radiusY == null ? component.radius == null ? undefined : component.radius * current.scaleY : component.radiusY * current.scaleY,
      metrics: current
    });
  };

  return Object.freeze({ native: NATIVE_SHELL, targets: COMPONENT_MAP, metrics, target, toDisplayed, toViewport, rectFor });
}
