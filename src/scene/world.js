import * as THREE from 'three';
import { clamp, damping } from '../core/math.js';
import { createQualityController } from '../core/quality.js';

export function createWorld(container, onError) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#191d24');
  scene.fog = new THREE.Fog('#191d24', 22, 55);
  const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 80);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  const quality = createQualityController(window.devicePixelRatio || 1, { enabled: new URLSearchParams(location.search).get('quality') !== 'high' });
  renderer.setPixelRatio(quality.pixelRatio);
  const viewport = { width: 1, height: 1 };
  let cameraRevision = 0;
  let needsRender = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  renderer.domElement.setAttribute('aria-label', 'Six-piece kinetic sculpture in a three-dimensional workspace');
  container.append(renderer.domElement);
  scene.add(new THREE.HemisphereLight(0xe4edff, 0x1f2936, 3));
  const key = new THREE.DirectionalLight(0xffffff, 4);
  key.position.set(3, 8, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x91b6df, 3);
  rim.position.set(-6, 4, -5);
  scene.add(rim);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), new THREE.MeshStandardMaterial({ color: 0x1a2028, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.12;
  scene.add(floor);
  const grid = new THREE.GridHelper(64, 64, 0x364451, 0x28323d);
  grid.position.y = -0.1;
  grid.material.transparent = true;
  grid.material.opacity = 0.22;
  scene.add(grid);

  const platform = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.7, 0.12, 80), new THREE.MeshStandardMaterial({ color: 0x2a303a, metalness: 0.65, roughness: 0.6 }));
  platform.position.y = -0.02;
  scene.add(platform);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.5, 0.012, 6, 100), new THREE.MeshBasicMaterial({ color: 0x8daab8 }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.05;
  scene.add(ring);

  const focus = new THREE.Vector3(0, 2.25, 0);
  const home = { theta: 0.12, phi: 1.18, radius: 16.8 };
  const view = { ...home };
  const desired = { ...home };
  const viewKeys = ['radius', 'theta', 'phi'];
  const applyCamera = () => {
    camera.position.setFromSphericalCoords(view.radius, view.phi, view.theta).add(focus);
    camera.lookAt(focus);
    camera.updateMatrixWorld();
  };
  applyCamera();
  const resize = () => {
    const { width, height } = container.getBoundingClientRect();
    if (!width || !height) return;
    viewport.width = width;
    viewport.height = height;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    cameraRevision++;
    needsRender = true;
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  const contextLost = (event) => { event.preventDefault(); onError('Graphics context lost. Reload the page to restore the playground.'); };
  renderer.domElement.addEventListener('webglcontextlost', contextLost);
  resize();

  return {
    scene, camera, renderer, viewport, quality,
    get cameraRevision() { return cameraRevision; },
    get needsRender() { return needsRender; },
    orbit(dx, dy) {
      desired.theta -= clamp(dx, -0.12, 0.12) * 4;
      desired.phi = clamp(desired.phi - clamp(dy, -0.12, 0.12) * 3, 0.35, 1.67);
    },
    zoom(delta) { desired.radius = clamp(desired.radius + delta, 7, 26); },
    resetView() { Object.assign(desired, home); },
    update(dt) {
      const alpha = damping(12, dt);
      let changed = false;
      for (const key of viewKeys) {
        const delta = desired[key] - view[key];
        if (Math.abs(delta) > 0.00001) { view[key] += delta * alpha; changed = true; }
      }
      if (changed) { applyCamera(); cameraRevision++; }
      if (renderer.getPixelRatio() !== quality.pixelRatio) {
        renderer.setPixelRatio(quality.pixelRatio);
        renderer.setSize(viewport.width, viewport.height, false);
        needsRender = true;
      }
      return changed;
    },
    render() { renderer.render(scene, camera); needsRender = false; },
    dispose() {
      observer.disconnect();
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      const geometries = new Set();
      const materials = new Set();
      scene.traverse((object) => {
        if (object.geometry) geometries.add(object.geometry);
        if (object.material) for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      });
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
