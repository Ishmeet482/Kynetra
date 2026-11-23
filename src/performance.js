const CAPACITY = 1200;

function samples() {
  const values = new Float64Array(CAPACITY);
  let count = 0;
  let cursor = 0;
  return {
    add(value) { values[cursor] = value; cursor = (cursor + 1) % CAPACITY; count = Math.min(count + 1, CAPACITY); },
    clear() { count = cursor = 0; },
    summary(limit = CAPACITY) {
      if (!count) return { mean: 0, p95: 0, count: 0 };
      const length = Math.min(count, limit);
      const sorted = Array.from({ length }, (_, index) => values[(cursor - length + index + CAPACITY) % CAPACITY]).sort((a, b) => a - b);
      return { mean: sorted.reduce((sum, value) => sum + value, 0) / length, p95: sorted[Math.min(length - 1, Math.floor(length * 0.95))], count: length };
    },
  };
}

export function createPerformanceMonitor() {
  const frameTimes = samples();
  const renderTimes = samples();
  const updateTimes = samples();
  const inferenceTimes = samples();
  const resultAges = samples();
  let lastFrame = null;
  let lastDisplay = 0;
  let started = performance.now();
  let inferenceCount = 0;
  let drawCalls = 0;
  let triangles = 0;
  let backend = 'off';
  let renderCount = 0;
  let pixelRatio = 1;
  let displayedInferences = 0;
  let displayedRenders = 0;
  const panel = document.createElement('details');
  panel.className = 'performance-monitor';
  panel.setAttribute('aria-label', 'Development performance monitor');
  panel.hidden = new URLSearchParams(location.search).get('perf') !== '1';
  panel.open = true;
  const summary = document.createElement('summary');
  summary.textContent = 'Diagnostics';
  const output = document.createElement('pre');
  const close = document.createElement('button');
  close.textContent = 'Hide monitor';
  close.onclick = () => { panel.hidden = true; };
  panel.append(summary, output, close);
  document.body.append(panel);
  const report = (limit = CAPACITY) => {
    const frame = frameTimes.summary(limit);
    return {
      fps: frame.mean ? 1000 / frame.mean : 0,
      frameMs: frame.mean, frameP95: frame.p95,
      render: renderTimes.summary(limit), update: updateTimes.summary(limit), inference: inferenceTimes.summary(limit),
      inferenceHz: inferenceCount / Math.max((performance.now() - started) / 1000, 0.001),
      drawCalls, triangles, backend,
      renderHz: renderCount / Math.max((performance.now() - started) / 1000, 0.001),
      resultAge: resultAges.summary(), pixelRatio,
    };
  };
  const api = {
    frame(now, renderMs, updateMs, calls, triangleCount, rendered = true, ratio = devicePixelRatio) {
      if (lastFrame !== null) frameTimes.add(now - lastFrame);
      lastFrame = now;
      if (rendered) renderTimes.add(renderMs);
      updateTimes.add(updateMs);
      drawCalls = calls;
      triangles = triangleCount;
      if (rendered) renderCount++;
      pixelRatio = ratio;
      if (!panel.hidden && panel.open && now - lastDisplay > 1000) {
        const seconds = Math.max((now - lastDisplay) / 1000, 0.001);
        const inferenceHz = (inferenceCount - displayedInferences) / seconds;
        const renderHz = (renderCount - displayedRenders) / seconds;
        displayedInferences = inferenceCount;
        displayedRenders = renderCount;
        lastDisplay = now;
        const data = report(120);
        output.textContent = `FPS (loop) ${data.fps.toFixed(1)} · Draw ${renderHz.toFixed(1)} Hz\nFrame ${data.frameMs.toFixed(1)} ms · p95 ${data.frameP95.toFixed(1)}\nRender CPU ${data.render.mean.toFixed(2)} ms\nUpdate CPU ${data.update.mean.toFixed(2)} ms\nInference ${data.inference.mean.toFixed(1)} ms · ${inferenceHz.toFixed(1)} Hz\nResult age ${data.resultAge.mean.toFixed(1)} ms\nDraw calls ${drawCalls} · Triangles ${triangles}\nTracking ${backend} · DPR ${pixelRatio.toFixed(2)}`;
      }
    },
    inference(ms, source = 'main', latency = ms) { inferenceTimes.add(ms); resultAges.add(latency); inferenceCount++; backend = source; },
    reset() {
      for (const series of [frameTimes, renderTimes, updateTimes, inferenceTimes, resultAges]) series.clear();
      lastFrame = null;
      inferenceCount = 0;
      renderCount = 0;
      displayedInferences = displayedRenders = 0;
      lastDisplay = performance.now();
      started = performance.now();
    },
    report,
    tracking(status) { if (status !== 'active') backend = 'off'; },
    pause() { lastFrame = null; },
    dispose() { panel.remove(); delete window.__kynetraPerf; },
  };
  window.__kynetraPerf = api;
  return api;
}
