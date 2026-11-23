import { COMPONENTS, isComplete } from './core/assembly.js';

const byId = (id) => document.getElementById(id);
const setText = (element, text) => { if (element.textContent !== text) element.textContent = text; };

export function createUI() {
  const elements = Object.fromEntries(['component-list', 'progress-label', 'assembly-progress', 'assembly-count', 'simulation-mode', 'simulation-description', 'assembly-mode', 'mode-lock', 'completion', 'score-panel', 'score', 'wave', 'scene-label', 'notice', 'action-label', 'gesture-label', 'camera-button', 'camera-button-label', 'input-label', 'input-dot', 'input-hint', 'scene-loading', 'hand-cursor'].map((id) => [id, byId(id)]));
  const componentButtons = new Map();
  const progressSegments = new Map();
  const scene = byId('scene');
  const cursor = elements['hand-cursor'];
  const cursorBounds = { x: 0, y: 0, width: 0, height: 0 };
  let cursorSample = null;
  let cursorDirty = false;
  let lastCursorUpdate = -Infinity;
  let cursorVisible = false;
  let cursorGrabbing = false;
  let actionText = '';
  let snapReady = false;
  let previousState = '';
  const observer = new ResizeObserver(() => {
    cursorBounds.x = scene.offsetLeft;
    cursorBounds.y = scene.offsetTop;
    cursorBounds.width = scene.clientWidth;
    cursorBounds.height = scene.clientHeight;
    cursorDirty = true;
  });
  observer.observe(scene);
  for (const component of COMPONENTS) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.dataset.component = component.id;
    button.innerHTML = `<span class="piece-thumbnail" aria-hidden="true"><span class="piece-symbol ${component.shape}"></span></span><span class="piece-name">${component.label}</span><span class="piece-status">Locate</span>`;
    item.append(button);
    elements['component-list'].append(item);
    componentButtons.set(component.id, button);
    const segment = document.createElement('span');
    segment.setAttribute('aria-hidden', 'true');
    elements['assembly-progress'].append(segment);
    progressSegments.set(component.id, segment);
  }
  return {
    render(state) {
      setText(elements.score, String(state.score));
      setText(elements.wave, `Wave ${state.wave}`);
      const stateKey = `${state.mode}:${state.installed.size}:${state.selected}`;
      if (previousState === stateKey) return;
      previousState = stateKey;
      const count = state.installed.size;
      const complete = isComplete(state.installed);
      const simulation = state.mode === 'simulation';
      setText(elements['progress-label'], `${count} of 6 placed`);
      setText(elements['assembly-count'], `${count} / 6`);
      elements['assembly-progress'].setAttribute('aria-valuenow', String(count));
      elements['simulation-mode'].disabled = !complete;
      setText(elements['mode-lock'], complete ? 'Ready' : 'Locked');
      setText(elements['simulation-description'], complete ? 'Aim, fire, and explore' : 'Complete assembly to unlock');
      for (const mode of ['assembly', 'simulation']) {
        const button = elements[`${mode}-mode`];
        button.classList.toggle('active', state.mode === mode);
        button.setAttribute('aria-pressed', String(state.mode === mode));
      }
      for (const [id, button] of componentButtons) {
        const placed = state.installed.has(id);
        button.classList.toggle('placed', placed);
        button.classList.toggle('selected', state.selected === id && !placed);
        button.setAttribute('aria-pressed', String(state.selected === id && !placed));
        button.setAttribute('aria-label', `${COMPONENTS.find((component) => component.id === id).label}, ${placed ? 'placed' : state.selected === id ? 'selected' : 'locate component'}`);
        progressSegments.get(id).classList.toggle('filled', placed);
        button.disabled = placed || simulation;
        setText(button.querySelector('.piece-status'), placed ? 'Placed ✓' : state.selected === id ? 'Selected' : 'Locate');
      }
      elements.completion.hidden = !complete || simulation;
      elements['score-panel'].hidden = !simulation;
      setText(elements['scene-label'], simulation ? 'Target practice' : 'Kinetic assembly');
      if (simulation) this.action('Aim at a coral target. Click or make a fist to fire.');
    },
    action(text, ready = false) {
      if (text !== actionText) { actionText = text; setText(elements['action-label'], text); }
      if (snapReady !== ready) { snapReady = ready; elements['action-label'].classList.toggle('snap-ready', ready); }
    },
    gesture(text) { setText(elements['gesture-label'], text); },
    notify(text) { setText(elements.notice, text); },
    ready() { elements['scene-loading'].hidden = true; },
    error(text) {
      elements['scene-loading'].hidden = false;
      elements['scene-loading'].classList.add('error');
      setText(elements['scene-loading'], text);
    },
    cameraStatus(status, message) {
      const busy = ['permission', 'loading'].includes(status);
      const active = status === 'active';
      elements['camera-button'].dataset.status = status;
      setText(elements['camera-button-label'], busy ? 'Cancel camera startup' : active ? 'Disable hand tracking' : status === 'error' ? 'Retry hand tracking' : 'Enable hand tracking');
      elements['camera-button'].setAttribute('aria-pressed', String(active));
      elements['input-dot'].classList.toggle('tracking', active);
      setText(elements['input-label'], active ? 'Camera enabled' : busy ? 'Camera starting' : 'Mouse control');
      setText(elements['input-hint'], active ? 'Palm: orbit · Point: cursor · Fist: grab / fire · Two hands: zoom' : 'Drag piece: move · Drag space: orbit · Scroll: zoom');
      this.notify(message);
    },
    handCursor(sample) {
      if (!sample && !cursorSample && !cursorVisible) return;
      cursorSample = sample;
      cursorDirty = true;
    },
    flush(now) {
      if (!cursorDirty || (cursorSample && now - lastCursorUpdate < 1000 / 30)) return;
      cursorDirty = false;
      lastCursorUpdate = now;
      const visible = Boolean(cursorSample);
      if (visible !== cursorVisible) { cursor.hidden = !visible; cursorVisible = visible; }
      if (!visible) return;
      const x = cursorBounds.x + cursorSample.x * cursorBounds.width - 12;
      const y = cursorBounds.y + cursorSample.y * cursorBounds.height - 12;
      cursor.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      const grabbing = cursorSample.gesture === 'fist';
      if (grabbing !== cursorGrabbing) { cursorGrabbing = grabbing; cursor.classList.toggle('grabbing', grabbing); }
    },
    dispose() { observer.disconnect(); },
  };
}
