import * as THREE from "/node_modules/three/build/three.module.js";

const sceneHost = document.querySelector("#scene");
const autoMotion = document.querySelector("#auto-motion");
const excursionControl = document.querySelector("#excursion");
const amplitudeControl = document.querySelector("#amplitude");
const speedControl = document.querySelector("#speed");
const excursionOutput = document.querySelector("#excursion-output");
const amplitudeOutput = document.querySelector("#amplitude-output");
const speedOutput = document.querySelector("#speed-output");
const frontButton = document.querySelector("#front-view");
const depthButton = document.querySelector("#depth-view");
const wireframeButton = document.querySelector("#wireframe-toggle");

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x030405, 1);
sceneHost.append(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x030405, 5.5, 9.5);
const camera = new THREE.PerspectiveCamera(34, 1, .1, 20);
const cameraTargets = {
  front: new THREE.Vector3(0, 0, 6.0),
  depth: new THREE.Vector3(.75, .20, 6.0)
};
let cameraTarget = cameraTargets.depth.clone();
camera.position.copy(cameraTarget);
camera.lookAt(0, 0, -.08);

scene.add(new THREE.HemisphereLight(0xd9dddd, 0x090a0b, .52));
const key = new THREE.DirectionalLight(0xffffff, 3.15);
key.position.set(-2.1, 2.6, 4.0);
scene.add(key);
const fill = new THREE.DirectionalLight(0xd3d8d8, .42);
fill.position.set(2.6, -.6, 2.2);
scene.add(fill);

const createConeTexture = () => {
  const size = 512;
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = size;
  textureCanvas.height = size;
  const context = textureCanvas.getContext("2d");
  const center = size * .5;
  const base = context.createRadialGradient(center, center, size * .04, center, center, size * .52);
  base.addColorStop(0, "#24282a");
  base.addColorStop(.32, "#1c2022");
  base.addColorStop(.74, "#16191b");
  base.addColorStop(1, "#101214");
  context.fillStyle = base;
  context.fillRect(0, 0, size, size);
  for (let radius = size * .13; radius < size * .51; radius += 5.5) {
    context.beginPath();
    context.arc(center, center, radius, 0, Math.PI * 2);
    context.strokeStyle = `rgba(212, 216, 211, ${.012 + (radius % 11) * .002})`;
    context.lineWidth = 1;
    context.stroke();
  }
  for (let index = 0; index < 3400; index += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const tone = 112 + Math.floor(Math.random() * 38);
    context.fillStyle = `rgba(${tone}, ${tone + 2}, ${tone + 3}, ${.02 + Math.random() * .035})`;
    context.fillRect(x, y, 1, 1);
  }
  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return texture;
};

const profilePoints = [
  [0.00, .10], [0.20, .07], [0.28, .02], [0.55, -.07], [0.80, -.15], [1.00, -.19]
];
const smooth = value => value * value * (3 - 2 * value);
const baseProfile = radius => {
  for (let index = 0; index < profilePoints.length - 1; index += 1) {
    const [fromR, fromZ] = profilePoints[index];
    const [toR, toZ] = profilePoints[index + 1];
    if (radius <= toR) {
      const t = smooth((radius - fromR) / (toR - fromR));
      return THREE.MathUtils.lerp(fromZ, toZ, t);
    }
  }
  return profilePoints.at(-1)[1];
};

const radialRings = 80;
const angularSegments = 160;
const vertexCount = (radialRings + 1) * (angularSegments + 1);
const positions = new Float32Array(vertexCount * 3);
const basePositions = new Float32Array(vertexCount * 3);
const normalizedRadius = new Float32Array(vertexCount);
const uvs = new Float32Array(vertexCount * 2);
let vertex = 0;
for (let ring = 0; ring <= radialRings; ring += 1) {
  const r = ring / radialRings;
  for (let segment = 0; segment <= angularSegments; segment += 1) {
    const angle = segment / angularSegments * Math.PI * 2;
    const x = Math.cos(angle) * r * .93;
    const y = Math.sin(angle) * r * .93;
    const z = baseProfile(r);
    positions[vertex * 3] = x;
    positions[vertex * 3 + 1] = y;
    positions[vertex * 3 + 2] = z;
    basePositions[vertex * 3] = x;
    basePositions[vertex * 3 + 1] = y;
    basePositions[vertex * 3 + 2] = z;
    normalizedRadius[vertex] = r;
    uvs[vertex * 2] = x / 1.86 + .5;
    uvs[vertex * 2 + 1] = y / 1.86 + .5;
    vertex += 1;
  }
}
const indices = [];
const rowWidth = angularSegments + 1;
for (let ring = 0; ring < radialRings; ring += 1) {
  for (let segment = 0; segment < angularSegments; segment += 1) {
    const a = ring * rowWidth + segment;
    const b = a + rowWidth;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
}

const coneGeometry = new THREE.BufferGeometry();
coneGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
coneGeometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
coneGeometry.setIndex(indices);
coneGeometry.computeVertexNormals();
const coneMaterial = new THREE.MeshPhysicalMaterial({
  map: createConeTexture(), color: 0xb8bec0, metalness: .015, roughness: .87, clearcoat: .02, clearcoatRoughness: .94,
  side: THREE.FrontSide
});
const cone = new THREE.Mesh(coneGeometry, coneMaterial);
scene.add(cone);

const rubberMaterial = new THREE.MeshStandardMaterial({ color: 0x080a0b, roughness: .94, metalness: 0 });
const surround = new THREE.Mesh(new THREE.TorusGeometry(1.01, .13, 28, 160), rubberMaterial);
surround.position.z = -.17;
scene.add(surround);

const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x24282a, roughness: .29, metalness: .82 });
const frame = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.37, 160), frameMaterial);
frame.position.z = -.23;
scene.add(frame);
const frameInner = new THREE.Mesh(new THREE.TorusGeometry(1.18, .035, 16, 160), new THREE.MeshStandardMaterial({ color: 0x666b6b, roughness: .42, metalness: .72 }));
frameInner.position.z = -.20;
scene.add(frameInner);
const cavity = new THREE.Mesh(new THREE.CircleGeometry(1.47, 160), new THREE.MeshStandardMaterial({ color: 0x050607, roughness: 1, metalness: 0 }));
cavity.position.z = -.34;
scene.add(cavity);

const setView = view => {
  cameraTarget = cameraTargets[view].clone();
  frontButton.classList.toggle("is-active", view === "front");
  depthButton.classList.toggle("is-active", view === "depth");
};
frontButton.addEventListener("click", () => setView("front"));
depthButton.addEventListener("click", () => setView("depth"));

const debugEnabled = new URLSearchParams(location.search).get("debug") === "1";
if (debugEnabled) {
  wireframeButton.hidden = false;
  wireframeButton.addEventListener("click", () => {
    coneMaterial.wireframe = !coneMaterial.wireframe;
    wireframeButton.textContent = `WIREFRAME: ${coneMaterial.wireframe ? "ON" : "OFF"}`;
  });
}

const syncControls = () => {
  excursionOutput.value = Number(excursionControl.value).toFixed(2);
  amplitudeOutput.value = `${Math.round(Number(amplitudeControl.value) * 100)}%`;
  speedOutput.value = `${Number(speedControl.value).toFixed(1)} Hz`;
  excursionControl.disabled = autoMotion.checked;
};
[autoMotion, excursionControl, amplitudeControl, speedControl].forEach(control => control.addEventListener("input", syncControls));
syncControls();

const updateCone = excursion => {
  const position = coneGeometry.attributes.position;
  for (let index = 0; index < vertexCount; index += 1) {
    const r = normalizedRadius[index];
    const motionProfile = Math.pow(Math.max(0, 1 - r), 1.55);
    const centerProfile = Math.exp(-r * r * 10);
    const combined = motionProfile * .72 + motionProfile * centerProfile * .28;
    position.array[index * 3] = basePositions[index * 3];
    position.array[index * 3 + 1] = basePositions[index * 3 + 1];
    position.array[index * 3 + 2] = basePositions[index * 3 + 2] + excursion * .20 * combined;
  }
  position.needsUpdate = true;
  coneGeometry.computeVertexNormals();
};

const resize = () => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
};
window.addEventListener("resize", resize);
resize();

const clock = new THREE.Clock();
const animate = () => {
  requestAnimationFrame(animate);
  const elapsed = clock.getElapsedTime();
  const amplitude = Number(amplitudeControl.value);
  const speed = Number(speedControl.value);
  const excursion = autoMotion.checked
    ? Math.sin(elapsed * speed * Math.PI * 2) * amplitude
    : Number(excursionControl.value);
  if (autoMotion.checked) {
    excursionControl.value = excursion.toFixed(2);
    excursionOutput.value = excursion.toFixed(2);
  }
  updateCone(excursion);
  camera.position.lerp(cameraTarget, .055);
  camera.lookAt(0, 0, -.08);
  renderer.render(scene, camera);
};
animate();
