import { createState } from './core/state.js';
import { createWorld } from './scene/world.js';
import { createSculpture } from './scene/sculpture.js';
import { createSimulation } from './scene/simulation.js';
import { createInteraction } from './input/interaction.js';
import { createPointerControls } from './input/pointer-controls.js';
import { createHandControls } from './input/hand-controls.js';
import { createHandTracker } from './input/hand-tracker.js';
import { createAnimationLoop } from './animation.js';
import { createUI } from './ui.js';

const ui = createUI();
let performanceMonitor = null;
if ((import.meta.env.DEV || import.meta.env.VITE_PERF_MONITOR === 'true') && new URLSearchParams(location.search).get('perf') !== '0') {
  import('./performance.js').then(({ createPerformanceMonitor }) => { performanceMonitor = createPerformanceMonitor(); });
}
const store = createState();
const listeners = new AbortController();
const on = (id, handler) => document.getElementById(id).addEventListener('click', handler, { signal: listeners.signal });
const help = document.getElementById('help-dialog');
let cancelInteraction = () => {};
on('help-button', () => { cancelInteraction(); help.showModal(); });
on('close-help', () => help.close());
help.addEventListener('click', (event) => { if (event.target === help) help.close(); }, { signal: listeners.signal });
ui.render(store.state);

function start() {
  let world;
  try {
    world = createWorld(document.getElementById('scene'), (message) => {
      tracker.stop();
      hands.reset();
      pointers.cancel();
      stopAnimation();
      ui.error(message);
    });
  } catch {
    ui.error('Kynetra needs WebGL2. Enable hardware acceleration or try a current browser, then reload.');
    document.getElementById('camera-button').disabled = true;
    return;
  }
  const sculpture = createSculpture(world.scene);
  const simulation = createSimulation(world.scene, store.state, () => ui.render(store.state));
  const interaction = createInteraction(world, sculpture, store, simulation, ui);
  const pointers = createPointerControls(world.renderer.domElement, world, interaction, store.state, () => hands.suppress(performance.now()));
  const hands = createHandControls(world, interaction, ui, () => pointers.active || help.open);
  let inferenceBlocked = false;
  const tracker = createHandTracker(document.getElementById('camera-video'), (results, now, receivedAt) => hands.results(results, now, receivedAt), (status, message) => {
    if (status !== 'active') hands.reset();
    if (status !== 'active') inferenceBlocked = false;
    performanceMonitor?.tracking(status);
    ui.cameraStatus(status, message);
  }, (ms, backend, latency, delegate) => {
    inferenceBlocked = backend === 'main' && ms > 12;
    performanceMonitor?.inference(ms, delegate ? `${backend}-${delegate.toLowerCase()}` : backend, latency);
  }, {
    workerUrl: `${import.meta.env.BASE_URL}hand-worker.js`,
    forceMain: import.meta.env.DEV && new URLSearchParams(location.search).get('tracking') === 'main',
  });
  cancelInteraction = () => { pointers.cancel(); hands.reset(); };
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let previousFrame = null;
  let lastRender = -Infinity;

  function switchMode(mode) {
    if (store.state.mode === mode) return;
    pointers.cancel();
    hands.reset();
    if (!store.setMode(mode)) return;
    world.resetView();
    if (mode === 'simulation') {
      simulation.enter();
      ui.notify('Hit all five targets to start the next wave.');
    } else {
      simulation.leave();
      ui.notify('Sculpture complete. Orbit to explore, or return to target practice.');
    }
    ui.render(store.state);
  }

  on('assembly-mode', () => switchMode('assembly'));
  on('simulation-mode', () => switchMode('simulation'));
  on('enter-simulation', () => switchMode('simulation'));
  on('camera-button', () => { if (tracker.running) tracker.stop(); else tracker.start(); });
  on('zoom-in', () => world.zoom(-1));
  on('zoom-out', () => world.zoom(1));
  on('reset-view', () => { pointers.cancel(); hands.reset(); world.resetView(); });
  on('restart', () => {
    pointers.cancel();
    hands.reset();
    simulation.leave();
    store.reset();
    sculpture.reset();
    world.resetView();
    ui.render(store.state);
    ui.notify('Fresh start. Drag a piece onto its matching wireframe.');
    ui.gesture('Drag to assemble · Scroll to zoom');
  });
  document.getElementById('component-list').addEventListener('click', (event) => {
    const id = event.target.closest('button')?.dataset.component;
    if (!id || store.state.installed.has(id)) return;
    store.state.selected = id;
    sculpture.select(id);
    ui.render(store.state);
    ui.notify(`${sculpture.pieces.get(id).userData.component.label} highlighted. Drag the solid piece into its brighter outline.`);
  }, { signal: listeners.signal });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { pointers.cancel(); hands.reset(); tracker.stop(); }
    previousFrame = null;
    world.quality.reset();
    performanceMonitor?.pause();
  }, { signal: listeners.signal });
  window.addEventListener('keydown', (event) => { if (event.key === 'Escape') { pointers.cancel(); hands.reset(); } }, { signal: listeners.signal });

  const stopAnimation = createAnimationLoop((dt, elapsed, now) => {
    const updateStart = performanceMonitor ? performance.now() : 0;
    if (previousFrame !== null) world.quality.sample(now - previousFrame, inferenceBlocked);
    previousFrame = now;
    hands.update(now);
    ui.flush(now);
    const cameraChanged = world.update(dt);
    const interactionChanged = interaction.update(dt);
    const sculptureChanged = sculpture.update(dt, elapsed, reducedMotion.matches);
    const simulationChanged = simulation.update(dt, elapsed, reducedMotion.matches);
    const renderStart = performanceMonitor ? performance.now() : 0;
    // Sparse redraws keep the compositor awake without continuously redrawing a static scene.
    const rendered = cameraChanged || interactionChanged || sculptureChanged || simulationChanged || world.needsRender || now - lastRender >= 250;
    if (rendered) { world.render(); lastRender = now; }
    performanceMonitor?.frame(now, rendered ? performance.now() - renderStart : 0, renderStart - updateStart, world.renderer.info.render.calls, world.renderer.info.render.triangles, rendered, world.quality.pixelRatio);
  }, () => world.quality.frameInterval);
  ui.ready();

  let disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    stopAnimation();
    pointers.dispose();
    tracker.stop();
    simulation.dispose();
    world.dispose();
    ui.dispose();
    performanceMonitor?.dispose();
    listeners.abort();
  }
  window.addEventListener('pagehide', (event) => { if (!event.persisted) dispose(); }, { signal: listeners.signal });
  if (import.meta.hot) import.meta.hot.dispose(dispose);
}

start();
