export const CENTER_MODES = Object.freeze([
  "subwoofer", "cosmic-portal", "galaxy", "black-hole", "ai-core", "plasma", "particle-core", "off"
]);
export const ACTIVE_CENTER_MODES = Object.freeze(["subwoofer", "cosmic-portal"]);

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export function createCenterRenderer(canvas) {
  if (!(canvas instanceof HTMLCanvasElement)) throw new TypeError("A canvas center surface is required.");
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) throw new Error("Canvas 2D is unavailable.");
  let mode = "subwoofer";
  let pixelRatio = 1;
  let portalSettings = { depth: .72, bassReaction: .58, particleAmount: .62, glow: .55, rotation: .42, nebulaIntensity: .48 };
  let seed = 1979461;
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const portalStars = Array.from({ length: 280 }, () => ({ x: random() * 1.34 - .67, y: random() * 1.34 - .67, depth: random(), phase: random() * Math.PI * 2, warm: random() > .78 }));
  const portalParticles = Array.from({ length: 132 }, () => ({ angle: random() * Math.PI * 2, depth: random(), speed: .32 + random() * .95, phase: random(), warm: random() > .63 })).sort((a, b) => a.depth - b.depth);

  const resize = () => {
    const bounds = canvas.getBoundingClientRect();
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(bounds.width * pixelRatio));
    canvas.height = Math.max(1, Math.round(bounds.height * pixelRatio));
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  const metrics = () => ({ width: canvas.width / pixelRatio, height: canvas.height / pixelRatio });
  const clear = () => { const { width, height } = metrics(); context.clearRect(0, 0, width, height); };
  const inside = draw => {
    const { width, height } = metrics();
    context.save();
    context.beginPath(); context.ellipse(width / 2, height / 2, width * .5, height * .5, 0, 0, Math.PI * 2); context.clip();
    draw(width, height);
    context.restore();
  };
  const darkBase = (width, height, energy) => {
    const gradient = context.createRadialGradient(width * .5, height * .47, 4, width * .5, height * .5, width * .53);
    gradient.addColorStop(0, `rgba(16, 16, 17, ${.94 - energy * .10})`);
    gradient.addColorStop(.64, "rgba(5, 6, 7, .97)");
    gradient.addColorStop(1, "rgba(0, 0, 0, 1)");
    context.fillStyle = gradient; context.fillRect(0, 0, width, height);
  };
  const gold = alpha => `rgba(245, 188, 69, ${alpha})`;
  const blue = alpha => `rgba(78, 155, 244, ${alpha})`;
  const violet = alpha => `rgba(156, 100, 255, ${alpha})`;

  const drawSubwoofer = (frame, now) => inside((width, height) => {
    const excursion = clamp((frame.centerExcursion || 0) / Math.max(.001, frame.centerMaximum || .066));
    const bass = clamp(frame.sub * .38 + frame.bass * .12 + frame.kickEnergy * .20 + excursion * .55);
    darkBase(width, height, bass);
    const radius = Math.min(width, height) * (.315 + bass * .025);
    const centerY = height * .5 + excursion * height * .032;
    const cone = context.createRadialGradient(width / 2, centerY, radius * .04, width / 2, centerY, radius);
    cone.addColorStop(0, "rgba(0, 0, 0, 1)"); cone.addColorStop(.36, "rgba(10, 10, 11, 1)");
    cone.addColorStop(.72, `rgba(53, 47, 35, ${.40 + bass * .28})`); cone.addColorStop(1, "rgba(1, 1, 1, 1)");
    context.fillStyle = cone; context.beginPath(); context.arc(width / 2, centerY, radius, 0, Math.PI * 2); context.fill();
    const surround = context.createRadialGradient(width / 2, centerY, radius * .67, width / 2, centerY, radius * 1.08);
    surround.addColorStop(0, "rgba(0, 0, 0, 0)"); surround.addColorStop(.55, `rgba(186, 160, 104, ${.08 + bass * .12})`); surround.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = surround; context.beginPath(); context.arc(width / 2, centerY, radius * 1.06, 0, Math.PI * 2); context.fill();
    context.strokeStyle = gold(.16 + bass * .38); context.lineWidth = Math.max(1, width * .010);
    context.beginPath(); context.arc(width / 2, centerY, radius * .88, 0, Math.PI * 2); context.stroke();
    for (let ridge = 0; ridge < 7; ridge += 1) {
      context.strokeStyle = `rgba(213, 198, 167, ${.022 + bass * .025})`; context.lineWidth = Math.max(.45, width * .0022);
      context.beginPath(); context.arc(width / 2, centerY, radius * (.15 + ridge * .085), 0, Math.PI * 2); context.stroke();
    }
    context.strokeStyle = "rgba(231, 221, 199, .14)"; context.lineWidth = Math.max(1, width * .005);
    context.beginPath(); context.arc(width / 2, centerY + bass * radius * .04, radius * .42, 0, Math.PI * 2); context.stroke();
  });

  const drawCosmicPortal = (frame, now) => inside((width, height) => {
    const audio = frame.active ? 1 : 0;
    const master = frame.masterRms * audio;
    const depthPulse = (frame.sub * .72 + frame.kickEnergy * .54) * portalSettings.bassReaction * audio;
    const expansion = portalSettings.depth * (.06 + depthPulse * .10);
    const rotation = now * (.000006 + portalSettings.rotation * .000026) + frame.mid * audio * .08;
    const max = Math.min(width, height) * .5;
    darkBase(width, height, master * .72);

    // Far starfield: slowest plane. Fine points are deliberately dimmer than the hardware amber.
    context.save(); context.globalCompositeOperation = "lighter";
    portalStars.forEach(star => {
      const drift = now * (.000002 + star.depth * .000006);
      const x = width * .5 + (star.x + Math.sin(drift + star.phase) * (.008 + star.depth * .012)) * width;
      const y = height * .5 + (star.y + Math.cos(drift * .83 + star.phase) * (.008 + star.depth * .010)) * height;
      const alpha = (.035 + star.depth * .12 + frame.high * audio * star.depth * .14) * (.46 + master * .54);
      const size = .38 + star.depth * .72 + (star.warm ? .22 : 0);
      context.fillStyle = star.warm ? gold(alpha) : blue(alpha * .72);
      context.fillRect(x, y, size, size);
    });
    context.restore();

    // Three independent nebula planes with low-alpha drift create volume, not a flat background.
    const clouds = [
      { x: .26, y: .36, r: .62, color: [32, 62, 112], speed: .000010 },
      { x: .72, y: .61, r: .54, color: [72, 38, 108], speed: -.000007 },
      { x: .52, y: .23, r: .42, color: [122, 83, 30], speed: .000014 }
    ];
    clouds.forEach((cloud, index) => {
      const flow = now * cloud.speed + frame.lowMid * audio * (index + 1) * .018;
      const x = width * (cloud.x + Math.sin(flow * 1.3 + index) * .07);
      const y = height * (cloud.y + Math.cos(flow + index) * .055);
      const radius = max * cloud.r * (1 + portalSettings.depth * .10 + frame.lowMid * audio * .08);
      const fog = context.createRadialGradient(x, y, 0, x, y, radius);
      fog.addColorStop(0, `rgba(${cloud.color[0]},${cloud.color[1]},${cloud.color[2]},${(.035 + portalSettings.nebulaIntensity * .105 + master * .05).toFixed(3)})`);
      fog.addColorStop(.48, `rgba(${cloud.color[0]},${cloud.color[1]},${cloud.color[2]},${(.014 + portalSettings.nebulaIntensity * .03).toFixed(3)})`);
      fog.addColorStop(1, "rgba(0,0,0,0)");
      context.fillStyle = fog; context.fillRect(0, 0, width, height);
    });

    // Perspective rings: far rings are small/dim, close rings are broader and offset on another plane.
    context.save(); context.globalCompositeOperation = "lighter";
    for (let index = 0; index < 11; index += 1) {
      const z = index / 10;
      const radius = max * (.115 + Math.pow(z, 1.72) * (.92 + expansion));
      const x = width * .5 + Math.sin(rotation * (1.8 - z) + index * .71) * width * (.008 + z * .018);
      const y = height * .5 + Math.cos(rotation * (1.2 - z) + index) * height * (.004 + z * .014);
      const alpha = (.055 + z * .13 + master * .12 + depthPulse * .14) * portalSettings.glow;
      context.strokeStyle = index % 4 === 0 ? gold(alpha * 1.35) : (index % 2 ? blue(alpha * .60) : violet(alpha * .50));
      context.lineWidth = Math.max(.55, width * (.0018 + z * .0038));
      context.shadowColor = index % 4 === 0 ? gold(alpha * .70) : blue(alpha * .34);
      context.shadowBlur = Math.max(1, width * (.006 + z * .010));
      const phase = rotation * (1.3 + z) + index * .57;
      context.beginPath(); context.ellipse(x, y, radius, radius * (.70 + z * .16), phase * .14, phase, phase + Math.PI * (1.40 + frame.mid * audio * .20)); context.stroke();
    }
    context.restore();

    // Mid-plane depth particles: nearer particles move more and are larger; some sink into the core.
    const count = Math.round(42 + portalSettings.particleAmount * 90);
    context.save(); context.globalCompositeOperation = "lighter";
    for (let index = 0; index < count; index += 1) {
      const particle = portalParticles[index];
      const travel = (particle.phase + now * .000022 * particle.speed * (1 + portalSettings.rotation)) % 1;
      const towardViewer = particle.depth > .5 ? travel : 1 - travel;
      const radius = max * (.08 + towardViewer * (.68 + expansion * .35));
      const angle = particle.angle + rotation * (.55 + particle.depth * .9) + Math.sin(now * .000013 + particle.phase) * .08;
      const x = width * .5 + Math.cos(angle) * radius;
      const y = height * .5 + Math.sin(angle) * radius * (.69 + particle.depth * .14);
      const size = .40 + towardViewer * 1.65 + frame.high * audio * 1.65;
      const alpha = (.035 + towardViewer * .18 + frame.high * audio * .20) * portalSettings.glow;
      context.fillStyle = particle.warm ? gold(alpha) : blue(alpha * .76);
      context.fillRect(x, y, size, size);
    }
    context.restore();

    // The core stays dark. Bass opens its rim; a kick is an energy impulse, never a white strobe.
    const coreRadius = max * (.16 + portalSettings.depth * .045 + depthPulse * .052);
    const core = context.createRadialGradient(width * .5, height * .5, coreRadius * .12, width * .5, height * .5, coreRadius * 1.9);
    core.addColorStop(0, "rgba(0,0,0,.98)"); core.addColorStop(.48, "rgba(2,4,9,.94)");
    core.addColorStop(.78, `rgba(33, 24, 40, ${(.18 + portalSettings.glow * .12 + depthPulse * .10).toFixed(3)})`); core.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = core; context.fillRect(0, 0, width, height);
    context.save(); context.globalCompositeOperation = "lighter"; context.strokeStyle = gold((.10 + portalSettings.glow * .22 + depthPulse * .24) * (.55 + master * .45));
    context.lineWidth = Math.max(.65, width * (.0025 + depthPulse * .003)); context.shadowColor = gold(.22 + depthPulse * .22); context.shadowBlur = Math.max(2, width * .022);
    context.beginPath(); context.ellipse(width * .5, height * .5, coreRadius * 1.12, coreRadius * .73, rotation * .30, 0, Math.PI * 2); context.stroke(); context.restore();
  });

  const drawGalaxy = (frame, now) => inside((width, height) => {
    const energy = frame.masterRms;
    darkBase(width, height, energy);
    const max = Math.min(width, height) * .46;
    const cloud = context.createRadialGradient(width / 2, height / 2, 1, width / 2, height / 2, max * .96);
    cloud.addColorStop(0, `rgba(255, 201, 97, ${.18 + frame.bass * .22})`); cloud.addColorStop(.30, `rgba(120, 83, 163, ${.10 + frame.mid * .16})`); cloud.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = cloud; context.fillRect(0, 0, width, height);
    context.save(); context.translate(width / 2, height / 2); context.rotate(now * .000045);
    for (let arm = 0; arm < 3; arm += 1) {
      context.strokeStyle = arm === 1 ? violet(.22 + frame.mid * .26) : gold(.20 + energy * .30);
      context.lineWidth = Math.max(1, width * (.006 + frame.bass * .004)); context.beginPath();
      for (let step = 0; step <= 110; step += 1) {
        const ratio = step / 110, angle = arm * Math.PI * 2 / 3 + ratio * Math.PI * (1.9 + frame.mid * .45);
        const radius = ratio * max * (1 + frame.bass * .10), x = Math.cos(angle) * radius, y = Math.sin(angle) * radius * .58;
        if (step === 0) context.moveTo(x, y); else context.lineTo(x, y);
      }
      context.stroke();
    }
    context.restore();
    for (let index = 0; index < 104; index += 1) {
      const seed = ((index * 29) % 100) / 100, arm = index % 3, angle = arm * Math.PI * 2 / 3 + seed * Math.PI * (1.9 + frame.mid * .45) + now * .000045, radius = max * (.05 + seed * (.92 + frame.bass * .10));
      const drift = Math.sin(index * 1.91 + now * .00007) * max * (.015 + frame.high * .018), size = index % 7 === 0 ? 1.5 + frame.high * 1.6 : .55 + frame.high * .7;
      context.fillStyle = index % 7 === 0 ? gold(.22 + frame.high * .48) : (index % 3 ? blue(.08 + frame.high * .25) : violet(.08 + frame.mid * .22));
      context.fillRect(width / 2 + Math.cos(angle) * radius + drift, height / 2 + Math.sin(angle) * radius * .62, size, size);
    }
  });

  const drawBlackHole = (frame, now) => inside((width, height) => {
    darkBase(width, height, frame.masterRms);
    const radius = Math.min(width, height) * .25;
    context.fillStyle = "rgba(0, 0, 0, .98)"; context.beginPath(); context.arc(width / 2, height / 2, radius, 0, Math.PI * 2); context.fill();
    context.save(); context.translate(width / 2, height / 2); context.rotate(now * .00007 + frame.mid * .12);
    for (let index = 0; index < 4; index += 1) {
      context.strokeStyle = index % 2 ? gold(.18 + frame.bass * .37) : violet(.12 + frame.high * .24);
      context.lineWidth = Math.max(1, width * (.008 + frame.bass * .006));
      context.beginPath(); context.ellipse(0, 0, radius * (1.28 + index * .16 + frame.kickEnergy * .09), radius * (.43 + index * .04), index * .24, .35, Math.PI * 1.82); context.stroke();
    }
    context.restore();
  });

  const drawAiCore = (frame, now) => inside((width, height) => {
    darkBase(width, height, frame.masterRms);
    const max = Math.min(width, height) * .36;
    for (let layer = 0; layer < 4; layer += 1) {
      context.save(); context.translate(width / 2, height / 2); context.rotate((layer % 2 ? -1 : 1) * now * (.00008 + layer * .000025));
      context.strokeStyle = layer === 2 ? blue(.23 + frame.high * .34) : gold(.22 + frame.bass * .38); context.lineWidth = Math.max(1, width * .006); context.beginPath();
      const sides = 6 + layer * 2;
      for (let point = 0; point <= sides; point += 1) {
        const angle = point / sides * Math.PI * 2, radius = max * (1 - layer * .17) * (1 + frame.bass * .055), x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
        if (point === 0) context.moveTo(x, y); else context.lineTo(x, y);
      }
      context.stroke(); context.restore();
    }
    context.fillStyle = gold(.25 + frame.kickEnergy * .48); context.beginPath(); context.arc(width / 2, height / 2, max * (.12 + frame.sub * .035), 0, Math.PI * 2); context.fill();
  });

  const drawPlasma = (frame, now) => inside((width, height) => {
    darkBase(width, height, frame.masterRms);
    const max = Math.min(width, height) * .42;
    for (let layer = 0; layer < 7; layer += 1) {
      context.strokeStyle = layer % 2 ? violet(.14 + frame.mid * .31) : blue(.13 + frame.high * .28); context.lineWidth = Math.max(1, width * (.007 - layer * .00055)); context.beginPath();
      for (let point = 0; point <= 90; point += 1) {
        const angle = point / 90 * Math.PI * 2, wave = Math.sin(angle * (3 + layer) + now * .0012 + layer) * (frame.bass * .10 + frame.mid * .055), radius = max * (.25 + layer * .085 + wave), x = width / 2 + Math.cos(angle) * radius, y = height / 2 + Math.sin(angle) * radius;
        if (point === 0) context.moveTo(x, y); else context.lineTo(x, y);
      }
      context.stroke();
    }
  });

  const drawParticleCore = (frame, now) => inside((width, height) => {
    darkBase(width, height, frame.masterRms);
    const max = Math.min(width, height) * .46, count = Math.round(28 + frame.high * 72);
    for (let index = 0; index < count; index += 1) {
      const phase = index * 2.399963 + now * (.00012 + (index % 7) * .000012), radialSeed = ((index * 43) % 100) / 100, radius = max * (.13 + radialSeed * (.66 + frame.bass * .18)), size = .7 + frame.high * 2 + (index % 3) * .28;
      context.fillStyle = index % 4 === 0 ? gold(.23 + frame.high * .52) : blue(.10 + frame.mid * .34);
      context.fillRect(width / 2 + Math.cos(phase) * radius, height / 2 + Math.sin(phase) * radius, size, size);
    }
  });

  const render = (frame, now) => {
    clear();
    if (mode === "off") return;
    if (mode === "subwoofer") drawSubwoofer(frame, now);
    else if (mode === "cosmic-portal") drawCosmicPortal(frame, now);
    else if (mode === "galaxy") drawGalaxy(frame, now);
    else if (mode === "black-hole") drawBlackHole(frame, now);
    else if (mode === "ai-core") drawAiCore(frame, now);
    else if (mode === "plasma") drawPlasma(frame, now);
    else if (mode === "particle-core") drawParticleCore(frame, now);
  };

  return Object.freeze({
    type: "canvas-2d", modes: CENTER_MODES, activeModes: ACTIVE_CENTER_MODES,
    setMode: next => { if (!CENTER_MODES.includes(next)) throw new Error(`Unknown CENTER renderer: ${next}`); mode = next; },
    getMode: () => mode,
    setPortalSettings: patch => {
      portalSettings = {
        ...portalSettings,
        depth: clamp(Number(patch.depth ?? portalSettings.depth)),
        bassReaction: clamp(Number(patch.bassReaction ?? portalSettings.bassReaction)),
        particleAmount: clamp(Number(patch.particleAmount ?? portalSettings.particleAmount)),
        glow: clamp(Number(patch.glow ?? portalSettings.glow)),
        rotation: clamp(Number(patch.rotation ?? portalSettings.rotation)),
        nebulaIntensity: clamp(Number(patch.nebulaIntensity ?? portalSettings.nebulaIntensity))
      };
      return { ...portalSettings };
    },
    getPortalSettings: () => ({ ...portalSettings }),
    render,
    renderPlaceholder: () => render({ active: false, masterRms: 0, sub: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, high: 0, kickEnergy: 0 }, performance.now()),
    dispose: () => { observer.disconnect(); clear(); }
  });
}
