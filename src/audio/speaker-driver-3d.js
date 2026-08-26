import * as THREE from "/node_modules/three/build/three.module.js";
import { createShellMapper } from "../mapping/component-map.js";

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

const PROFILE_POINTS = Object.freeze([
  Object.freeze([0.00,  0.10]),
  Object.freeze([0.20,  0.07]),
  Object.freeze([0.28,  0.02]),
  Object.freeze([0.55, -0.07]),
  Object.freeze([0.80, -0.15]),
  Object.freeze([1.00, -0.19])
]);

const smooth = value => value * value * (3 - 2 * value);

const baseProfile = radius => {
  for (let index = 0; index < PROFILE_POINTS.length - 1; index += 1) {
    const [fromR, fromZ] = PROFILE_POINTS[index];
    const [toR, toZ] = PROFILE_POINTS[index + 1];
    if (radius <= toR) {
      const t = smooth(clamp((radius - fromR) / Math.max(0.0001, toR - fromR)));
      return THREE.MathUtils.lerp(fromZ, toZ, t);
    }
  }
  return PROFILE_POINTS.at(-1)[1];
};

const createConeTexture = renderer => {
  const size = 512;
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = size;
  textureCanvas.height = size;
  const context = textureCanvas.getContext("2d");
  if (!context) throw new Error("Speaker cone texture canvas is unavailable.");

  const center = size * 0.5;
  const base = context.createRadialGradient(center, center, size * 0.04, center, center, size * 0.52);
  base.addColorStop(0, "#292d2f");
  base.addColorStop(0.32, "#202426");
  base.addColorStop(0.74, "#171a1c");
  base.addColorStop(1, "#101214");
  context.fillStyle = base;
  context.fillRect(0, 0, size, size);

  for (let radius = size * 0.13; radius < size * 0.51; radius += 5.5) {
    context.beginPath();
    context.arc(center, center, radius, 0, Math.PI * 2);
    context.strokeStyle = `rgba(220, 224, 219, ${0.014 + (radius % 11) * 0.002})`;
    context.lineWidth = 1;
    context.stroke();
  }

  for (let index = 0; index < 2600; index += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const tone = 105 + Math.floor(Math.random() * 42);
    context.fillStyle = `rgba(${tone}, ${tone + 2}, ${tone + 3}, ${0.018 + Math.random() * 0.032})`;
    context.fillRect(x, y, 1, 1);
  }

  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return texture;
};

const createConeGeometry = () => {
  const radialRings = 80;
  const angularSegments = 160;
  const rowWidth = angularSegments + 1;
  const vertexCount = (radialRings + 1) * rowWidth;

  const positions = new Float32Array(vertexCount * 3);
  const basePositions = new Float32Array(vertexCount * 3);
  const normalizedRadius = new Float32Array(vertexCount);
  const uvs = new Float32Array(vertexCount * 2);

  let vertex = 0;
  for (let ring = 0; ring <= radialRings; ring += 1) {
    const r = ring / radialRings;
    for (let segment = 0; segment <= angularSegments; segment += 1) {
      const angle = segment / angularSegments * Math.PI * 2;
      const x = Math.cos(angle) * r * 0.93;
      const y = Math.sin(angle) * r * 0.93;
      const z = baseProfile(r);

      positions[vertex * 3] = x;
      positions[vertex * 3 + 1] = y;
      positions[vertex * 3 + 2] = z;

      basePositions[vertex * 3] = x;
      basePositions[vertex * 3 + 1] = y;
      basePositions[vertex * 3 + 2] = z;

      normalizedRadius[vertex] = r;
      uvs[vertex * 2] = x / 1.86 + 0.5;
      uvs[vertex * 2 + 1] = y / 1.86 + 0.5;
      vertex += 1;
    }
  }

  const indices = [];
  for (let ring = 0; ring < radialRings; ring += 1) {
    for (let segment = 0; segment < angularSegments; segment += 1) {
      const a = ring * rowWidth + segment;
      const b = a + rowWidth;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  geometry.userData.basePositions = basePositions;
  geometry.userData.normalizedRadius = normalizedRadius;
  geometry.userData.vertexCount = vertexCount;

  return geometry;
};

const updateCone = (geometry, excursion) => {
  const position = geometry.attributes.position;
  const basePositions = geometry.userData.basePositions;
  const normalizedRadius = geometry.userData.normalizedRadius;
  const vertexCount = geometry.userData.vertexCount;

  for (let index = 0; index < vertexCount; index += 1) {
    const r = normalizedRadius[index];
    const motionProfile = Math.pow(Math.max(0, 1 - r), 1.55);
    const centerProfile = Math.exp(-r * r * 10);
    const combined = motionProfile * 0.72 + motionProfile * centerProfile * 0.28;

    position.array[index * 3] = basePositions[index * 3];
    position.array[index * 3 + 1] = basePositions[index * 3 + 1];
    position.array[index * 3 + 2] = basePositions[index * 3 + 2] + excursion * 0.22 * combined;
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();
};

class DriverView {
  constructor(shell, mapper, componentId) {
    this.shell = shell;
    this.mapper = mapper;
    this.componentId = componentId;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance"
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);

    const canvas = this.renderer.domElement;
    canvas.className = `speaker-driver-3d-surface speaker-driver-3d-surface--${componentId.toLowerCase()}`;
    canvas.setAttribute("aria-hidden", "true");
    Object.assign(canvas.style, {
      position: "absolute",
      zIndex: "4",
      pointerEvents: "none",
      background: "transparent"
    });
    shell.append(canvas);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 20);
    this.camera.position.set(0.48, 0.13, 4.85);
    this.camera.lookAt(0, 0, -0.08);

    this.scene.add(new THREE.HemisphereLight(0xd9dddd, 0x090a0b, 0.58));

    const key = new THREE.DirectionalLight(0xffffff, 3.15);
    key.position.set(-2.1, 2.6, 4.0);
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0xd3d8d8, 0.45);
    fill.position.set(2.6, -0.6, 2.2);
    this.scene.add(fill);

    this.texture = createConeTexture(this.renderer);
    this.geometry = createConeGeometry();
    this.material = new THREE.MeshPhysicalMaterial({
      map: this.texture,
      color: 0xb8bec0,
      metalness: 0.015,
      roughness: 0.87,
      clearcoat: 0.02,
      clearcoatRoughness: 0.94,
      side: THREE.FrontSide
    });

    this.cone = new THREE.Mesh(this.geometry, this.material);
    this.scene.add(this.cone);

    const rubberMaterial = new THREE.MeshStandardMaterial({
      color: 0x080a0b,
      roughness: 0.94,
      metalness: 0
    });
    this.surround = new THREE.Mesh(
      new THREE.TorusGeometry(1.01, 0.13, 28, 160),
      rubberMaterial
    );
    this.surround.position.z = -0.17;
    this.scene.add(this.surround);

    const cavityMaterial = new THREE.MeshStandardMaterial({
      color: 0x050607,
      roughness: 1,
      metalness: 0
    });
    this.cavity = new THREE.Mesh(
      new THREE.CircleGeometry(1.22, 160),
      cavityMaterial
    );
    this.cavity.position.z = -0.34;
    this.scene.add(this.cavity);

    this.resize();
  }

  resize() {
    const display = this.mapper.rectFor(this.componentId);
    const left = display.x;
    const top = display.y;
    const width = Math.max(1, display.width);
    const height = Math.max(1, display.height);

    Object.assign(this.renderer.domElement.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`
    });

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  render(excursion) {
    updateCone(this.geometry, excursion);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
    this.surround.geometry.dispose();
    this.surround.material.dispose();
    this.cavity.geometry.dispose();
    this.cavity.material.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

const createMotionState = phase => ({
  envelope: 0,
  phase,
  position: 0
});

const updateVisualMotion = (frame, state, side, dt) => {
  if (!frame.active) {
    state.envelope += (0 - state.envelope) * (1 - Math.exp(-dt * 6));
    state.position += (0 - state.position) * (1 - Math.exp(-dt * 9));
    return state.position;
  }

  const bass = clamp(side === "left" ? frame.leftBass : frame.rightBass);
  const rms = clamp(side === "left" ? frame.leftRms : frame.rightRms);
  const sub = clamp(frame.sub || 0);
  const kick = clamp(frame.kickEnergy || 0);

  const drive = clamp(
    bass * 0.50 +
    sub * 0.24 +
    kick * 0.18 +
    rms * 0.08
  );

  const attack = 1 - Math.exp(-dt * 18);
  const release = 1 - Math.exp(-dt * 5.5);
  const envelopeFollow = drive > state.envelope ? attack : release;
  state.envelope += (drive - state.envelope) * envelopeFollow;

  // Deliberately visible mechanical rate. Raw 60–110 Hz cone motion aliases
  // on a 60 FPS display and can look frozen/random.
  const speedHz = 2.15 + 1.65 * sub + 1.20 * kick;
  state.phase += dt * speedHz * Math.PI * 2;

  if (frame.beat && kick > 0.35) {
    const desired = Math.PI * 0.5;
    let delta = desired - (state.phase % (Math.PI * 2));
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    state.phase += delta * 0.22;
  }

  const oscillation = Math.sin(state.phase);
  const target = oscillation * Math.pow(clamp(state.envelope), 0.72) * 0.92;
  const follow = 1 - Math.exp(-dt * 22);
  state.position += (target - state.position) * follow;

  return clamp(state.position, -1, 1);
};

export class SpeakerDriver3DManager {
  constructor(shell, { debug = false } = {}) {
    if (!(shell instanceof HTMLElement)) {
      throw new TypeError("A console shell is required for 3D speaker drivers.");
    }

    this.shell = shell;
    this.mapper = createShellMapper(shell);
    this.debug = debug;
    this.disposed = false;
    this.lastTime = performance.now();

    this.leftMotion = createMotionState(0);
    this.rightMotion = createMotionState(0.16);

    this.leftView = new DriverView(shell, this.mapper, "LEFT_SPEAKER_WOOFER");
    this.rightView = new DriverView(shell, this.mapper, "RIGHT_SPEAKER_WOOFER");

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(shell);

    if (debug) this.createDebugReadout();
  }

  createDebugReadout() {
    this.readout = document.createElement("div");
    this.readout.setAttribute("aria-hidden", "true");
    Object.assign(this.readout.style, {
      position: "absolute",
      left: "8px",
      top: "8px",
      zIndex: "6",
      padding: "5px 7px",
      border: "1px solid rgba(150, 188, 192, .7)",
      background: "rgba(4, 9, 10, .86)",
      color: "#c5e4e6",
      font: "700 10px ui-monospace, Consolas, monospace",
      lineHeight: "1.4",
      pointerEvents: "none",
      whiteSpace: "pre"
    });
    this.shell.append(this.readout);
  }

  resize() {
    if (this.disposed) return;
    this.leftView.resize();
    this.rightView.resize();
  }

  render(frame) {
    if (this.disposed) return;

    const now = performance.now();
    const dt = clamp((now - this.lastTime) / 1000, 0.004, 0.05);
    this.lastTime = now;

    const leftPosition = updateVisualMotion(frame, this.leftMotion, "left", dt);
    const rightPosition = updateVisualMotion(frame, this.rightMotion, "right", dt);

    this.leftView.render(leftPosition);
    this.rightView.render(rightPosition);

    if (this.readout) {
      this.readout.textContent =
        `V5 LUMÍR FIX\n` +
        `LEFT: ${leftPosition.toFixed(3)}\n` +
        `RIGHT: ${rightPosition.toFixed(3)}\n` +
        `LEFT ENV: ${this.leftMotion.envelope.toFixed(3)}\n` +
        `RIGHT ENV: ${this.rightMotion.envelope.toFixed(3)}\n` +
        `PERSPECTIVE: YES`;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver?.disconnect();
    this.leftView.dispose();
    this.rightView.dispose();
    this.readout?.remove();
  }
}

export const createSpeakerDriver3DManager = (shell, options) =>
  new SpeakerDriver3DManager(shell, options);
