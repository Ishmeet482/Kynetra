export function createAnimationLoop(update, getFrameInterval = () => 0) {
  let frame = 0;
  let previous = null;
  let elapsed = 0;
  const tick = (now) => {
    frame = requestAnimationFrame(tick);
    const interval = getFrameInterval();
    if (previous !== null && now - previous < interval - 1) return;
    const dt = previous === null ? 0 : Math.min((now - previous) / 1000, 0.05);
    previous = now;
    elapsed += dt;
    update(dt, elapsed, now);
  };
  const start = () => { if (!frame) frame = requestAnimationFrame(tick); };
  const stop = () => { cancelAnimationFrame(frame); frame = 0; previous = null; };
  const visibility = () => { if (document.hidden) stop(); else start(); };
  document.addEventListener('visibilitychange', visibility);
  start();
  return () => { stop(); document.removeEventListener('visibilitychange', visibility); };
}
