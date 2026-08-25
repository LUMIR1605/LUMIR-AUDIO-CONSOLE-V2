import * as THREE from "/node_modules/three/build/three.module.js";
import { createShellMapper } from "../mapping/component-map.js";

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const CONE_PROFILE = Object.freeze([
  Object.freeze([0, .10]),
  Object.freeze([.20, .07]),
  Object.freeze([.28, .02]),
  Object.freeze([.55, -.07]),
  Object.freeze([.80, -.15]),
  Object.freeze([1, -.19])
]);

const profileZ = radius => {
  for (let index = 1; index < CONE_PROFILE.length; index += 1) {
    const [nextRadius, nextZ] = CONE_PROFILE[index];
    if (radius <= nextRadius) {
      const [previousRadius, previousZ] = CONE_PROFILE[index - 1];
      const amount = clamp((radius - previousRadius) / (nextRadius - previousRadius));
      const smooth = amount * amount * (3 - 2 * amount);
      return previousZ + (nextZ - previousZ) * smooth;
    }
  }
  return CONE_PROFILE.at(-1)[1];
};

const createPaperTexture = () => {
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = 384;
  textureCanvas.height = 384;
  const context = textureCanvas.getContext("2d");
  if (!context) throw new Error("Speaker paper texture canvas is unavailable.");

  const center = textureCanvas.width * .5;
  const field = context.createRadialGradient(center * .76, center * .68, 5, center, center, center);
  field.addColorStop(0, "#777a78");
  field.addColorStop(.38, "#4a4d4c");
  field.addColorStop(.78, "#252827");
  field.addColorStop(1, "#111312");
  context.fillStyle = field;
  context.fillRect(0, 0, textureCanvas.width, textureCanvas.height);

  context.save();
  context.translate(center, center);
  for (let radius = 24; radius < center; radius += 3.25) {
    const alpha = .014 + (radius / center) * .026;
    context.strokeStyle = `rgba(209, 214, 207, ${alpha})`;
    context.lineWidth = radius % 13 < 3 ? .7 : .34;
    context.beginPath();
    context.arc(0, 0, radius, 0, Math.PI * 2);
    context.stroke();
  }
  context.restore();

  for (let index = 0; index < 2300; index += 1) {
    const x = Math.random() * textureCanvas.width;
    const y = Math.random() * textureCanvas.height;
    const distance = Math.hypot(x - center, y - center) / center;
    if (distance > 1) continue;
    const alpha = .018 + Math.random() * .040;
    context.fillStyle = Math.random() > .5
      ? `rgba(218, 222, 215, ${alpha})`
      : `rgba(0, 0, 0, ${alpha})`;
    context.fillRect(x, y, 1, 1);
  }

  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
};

const createConeGeometry = () => {
  const radialRings = 64;
  const angularSegments = 128;
  const verticesPerRing = angularSegments + 1;
  const vertexCount = verticesPerRing * (radialRings + 1);
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const baseZ = new Float32Array(vertexCount);
  const motion = new Float32Array(vertexCount);
  const indices = [];

  for (let ring = 0; ring <= radialRings; ring += 1) {
    const radius = ring / radialRings;
    const curve = profileZ(radius);
    const motionProfile = Math.pow(Math.max(0, 1 - radius), 1.55);
    const centerProfile = Math.exp(-radius * radius * 10);
    const combined = motionProfile * .72 + motionProfile * centerProfile * .28;
    for (let segment = 0; segment <= angularSegments; segment += 1) {
      const angle = segment / angularSegments * Math.PI * 2;
      const vertex = ring * verticesPerRing + segment;
      positions[vertex * 3] = Math.cos(angle) * radius;
      positions[vertex * 3 + 1] = Math.sin(angle) * radius;
      positions[vertex * 3 + 2] = curve;
      uvs[vertex * 2] = .5 + Math.cos(angle) * radius * .5;
      uvs[vertex * 2 + 1] = .5 + Math.sin(angle) * radius * .5;
      baseZ[vertex] = curve;
      motion[vertex] = combined;
    }
  }

  for (let ring = 0; ring < radialRings; ring += 1) {
    for (let segment = 0; segment < angularSegments; segment += 1) {
      const a = ring * verticesPerRing + segment;
      const b = a + 1;
      const c = a + verticesPerRing;
      const d = c + 1;
      // Screen-space Y increases downward, so this order keeps the cone front
      // facing the frontal orthographic camera.
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.userData.baseZ = baseZ;
  geometry.userData.motion = motion;
  return geometry;
};

const createWoofer = (paperTexture, radiusRatio) => {
  const group = new THREE.Group();
  const coneGeometry = createConeGeometry();
  const coneMaterial = new THREE.MeshStandardMaterial({
    map: paperTexture,
    color: 0x727674,
    roughness: .83,
    metalness: .035
  });
  const cone = new THREE.Mesh(coneGeometry, coneMaterial);
  cone.renderOrder = 2;
  group.add(cone);

  const surroundGeometry = new THREE.TorusGeometry(1.025, .075, 12, 128);
  const surroundMaterial = new THREE.MeshStandardMaterial({
    color: 0x101211,
    roughness: .98,
    metalness: 0
  });
  const surround = new THREE.Mesh(surroundGeometry, surroundMaterial);
  surround.position.z = -.18;
  surround.renderOrder = 3;
  group.add(surround);

  return { group, coneGeometry, cone, surround, radiusRatio, radius: 1 };
};

const updateConeGeometry = (woofer, position) => {
  const positions = woofer.coneGeometry.attributes.position;
  const baseZ = woofer.coneGeometry.userData.baseZ;
  const motion = woofer.coneGeometry.userData.motion;
  for (let index = 0; index < baseZ.length; index += 1) {
    positions.setZ(index, baseZ[index] + position * .13 * motion[index]);
  }
  positions.needsUpdate = true;
  woofer.coneGeometry.computeVertexNormals();
};

const consumeSignedLowPass = (samples, state) => {
  if (!samples?.length) return 0;
  let dcTotal = 0;
  for (let index = 0; index < samples.length; index += 1) dcTotal += samples[index];
  const dcMean = dcTotal / samples.length;
  const rc = 1 / (2 * Math.PI * 110);
  const sampleDt = 1 / 48000;
  const alpha = sampleDt / (rc + sampleDt);
  for (let index = 0; index < samples.length; index += 1) {
    const centered = samples[index] - dcMean;
    state.lowPass += alpha * (centered - state.lowPass);
  }
  return state.lowPass;
};

export class SpeakerDriver3DManager {
  constructor(shell, { debug = false } = {}) {
    if (!(shell instanceof HTMLElement)) throw new TypeError("A console shell is required for 3D speaker drivers.");
    this.shell = shell;
    this.mapper = createShellMapper(shell);
    this.debug = debug;
    this.disposed = false;
    this.lastTime = performance.now();
    this.leftSignal = { lowPass: 0, position: 0 };
    this.rightSignal = { lowPass: 0, position: 0 };

    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.domElement.className = "speaker-driver-3d-surface";
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    Object.assign(this.renderer.domElement.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      zIndex: "2",
      pointerEvents: "none",
      background: "transparent"
    });
    shell.append(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(0, 1, 0, 1, -1000, 1000);
    this.camera.position.z = 420;
    this.scene.add(this.camera);

    this.scene.add(new THREE.HemisphereLight(0xbec9cb, 0x151716, .72));
    const key = new THREE.DirectionalLight(0xf3f1e7, 2.4);
    key.position.set(-260, -320, 380);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x8f9aa1, .52);
    fill.position.set(310, 160, 240);
    this.scene.add(fill);

    this.paperTexture = createPaperTexture();
    this.leftWoofer = createWoofer(this.paperTexture, .72);
    this.rightWoofer = createWoofer(this.paperTexture, .72);
    this.scene.add(this.leftWoofer.group, this.rightWoofer.group);

    if (debug) this.createDebugReadout();
    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(shell);
  }

  createDebugReadout() {
    this.readout = document.createElement("div");
    this.readout.setAttribute("aria-hidden", "true");
    Object.assign(this.readout.style, {
      position: "absolute",
      left: "8px",
      top: "8px",
      zIndex: "4",
      padding: "4px 6px",
      border: "1px solid rgba(150, 188, 192, .7)",
      background: "rgba(4, 9, 10, .82)",
      color: "#c5e4e6",
      font: "700 10px ui-monospace, Consolas, monospace",
      lineHeight: "1.35",
      letterSpacing: ".04em",
      pointerEvents: "none",
      whiteSpace: "pre"
    });
    this.shell.append(this.readout);
  }

  resize() {
    if (this.disposed) return;
    const { renderedWidth, renderedHeight } = this.mapper.metrics();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(Math.max(1, renderedWidth), Math.max(1, renderedHeight), false);
    this.camera.left = 0;
    this.camera.right = renderedWidth;
    this.camera.top = 0;
    this.camera.bottom = renderedHeight;
    this.camera.updateProjectionMatrix();
    this.placeWoofer(this.leftWoofer, "LEFT_SPEAKER_WOOFER");
    this.placeWoofer(this.rightWoofer, "RIGHT_SPEAKER_WOOFER");
  }

  placeWoofer(woofer, id) {
    const display = this.mapper.rectFor(id);
    const radiusX = display.radiusX * woofer.radiusRatio;
    const radiusY = display.radiusY * woofer.radiusRatio;
    woofer.radius = Math.min(radiusX, radiusY);
    woofer.group.position.set(display.centerX, display.centerY, 0);
    woofer.group.scale.set(radiusX, radiusY, woofer.radius);
  }

  updateSignal(frame, state, waveform, bass, dt) {
    const signedLow = frame.active ? consumeSignedLowPass(waveform, state) : 0;
    const bassGate = .25 + .75 * Math.sqrt(clamp(bass || 0));
    const target = frame.active ? clamp(signedLow * 9 * bassGate, -1, 1) : 0;
    const follow = 1 - Math.exp(-dt * 30);
    state.position = clamp(state.position + (target - state.position) * follow, -1, 1);
    return state.position;
  }

  render(frame) {
    if (this.disposed) return;
    const now = performance.now();
    const dt = clamp((now - this.lastTime) / 1000, .004, .05);
    this.lastTime = now;
    const leftPosition = this.updateSignal(frame, this.leftSignal, frame.waveformLeft, frame.leftBass, dt);
    const rightPosition = this.updateSignal(frame, this.rightSignal, frame.waveformRight, frame.rightBass, dt);
    updateConeGeometry(this.leftWoofer, leftPosition);
    updateConeGeometry(this.rightWoofer, rightPosition);
    this.renderer.render(this.scene, this.camera);
    if (this.readout) {
      this.readout.textContent = `V5 TRUE 3D\nLEFT POSITION: ${leftPosition.toFixed(3)}\nRIGHT POSITION: ${rightPosition.toFixed(3)}\nWEBGL: YES`;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver?.disconnect();
    [this.leftWoofer, this.rightWoofer].forEach(woofer => {
      woofer.coneGeometry.dispose();
      woofer.cone.material.dispose();
      woofer.surround.geometry.dispose();
      woofer.surround.material.dispose();
    });
    this.paperTexture.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.readout?.remove();
  }
}

export const createSpeakerDriver3DManager = (shell, options) => new SpeakerDriver3DManager(shell, options);
