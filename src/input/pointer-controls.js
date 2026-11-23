export function createPointerControls(element, world, interaction, state, onActivity) {
  const abort = new AbortController();
  const options = { signal: abort.signal };
  let activePointer = null;
  let orbiting = false;
  let previous = null;
  const coordinates = (event) => {
    const rect = element.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
  };
  const aim = (event) => { const point = coordinates(event); interaction.aim(point.x, point.y); return point; };
  const finish = (cancel = false) => {
    if (activePointer === null) return;
    interaction.end({ cancel });
    if (element.hasPointerCapture(activePointer)) element.releasePointerCapture(activePointer);
    activePointer = null;
    orbiting = false;
  };
  element.addEventListener('pointerdown', (event) => {
    if (activePointer !== null || ![0, 2].includes(event.button)) return;
    onActivity();
    element.focus();
    previous = aim(event);
    activePointer = event.pointerId;
    element.setPointerCapture(event.pointerId);
    if (state.mode === 'simulation' && event.button === 0) {
      interaction.shoot(performance.now());
    } else orbiting = event.button === 2 || !interaction.begin();
  }, options);
  element.addEventListener('pointermove', (event) => {
    if (activePointer !== null && event.pointerId !== activePointer) return;
    onActivity();
    const point = aim(event);
    if (activePointer !== null && orbiting) world.orbit(point.x - previous.x, point.y - previous.y);
    previous = point;
  }, options);
  element.addEventListener('pointerup', (event) => { if (event.pointerId === activePointer) finish(); }, options);
  element.addEventListener('pointercancel', () => finish(true), options);
  element.addEventListener('lostpointercapture', () => finish(true), options);
  element.addEventListener('pointerleave', () => { if (activePointer === null) interaction.clear(); }, options);
  element.addEventListener('contextmenu', (event) => event.preventDefault(), options);
  element.addEventListener('wheel', (event) => {
    event.preventDefault();
    onActivity();
    const delta = Math.sign(event.deltaY) * Math.min(Math.abs(event.deltaY) * (event.deltaMode === 1 ? 16 : 1), 100);
    if (interaction.dragging) interaction.adjustDepth(delta * 0.001);
    else world.zoom(delta * 0.015);
  }, { ...options, passive: false });
  element.addEventListener('keydown', (event) => {
    const actions = {
      ArrowLeft: () => world.orbit(-0.055, 0), ArrowRight: () => world.orbit(0.055, 0),
      ArrowUp: () => world.orbit(0, -0.055), ArrowDown: () => world.orbit(0, 0.055),
      '+': () => world.zoom(-0.8), '=': () => world.zoom(-0.8), '-': () => world.zoom(0.8),
      Home: () => world.resetView(), Escape: () => finish(true),
    };
    if (actions[event.key]) { event.preventDefault(); onActivity(); actions[event.key](); }
  }, options);
  const blur = () => finish(true);
  window.addEventListener('blur', blur, options);
  return { cancel: () => finish(true), get active() { return activePointer !== null; }, dispose() { finish(true); abort.abort(); } };
}
