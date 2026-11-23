import { clamp } from './math.js';

// Long windows and asymmetric recovery avoid changing resolution during single-frame spikes.
export function createQualityController(pixelRatio, { enabled = true } = {}) {
  const maximum = Math.min(pixelRatio, 1.5);
  const minimum = Math.min(maximum, 0.75);
  let ratio = maximum;
  let frameInterval = 0;
  let sum = 0;
  let count = 0;
  let slowWindows = 0;
  let fastWindows = 0;
  let limitedFor = 0;
  return {
    get pixelRatio() { return ratio; },
    get frameInterval() { return frameInterval; },
    reset() { sum = count = slowWindows = fastWindows = limitedFor = 0; },
    sample(frameMs, cpuBlocked = false) {
      if (!enabled || !Number.isFinite(frameMs) || frameMs <= 0 || frameMs > 250) return;
      if (frameInterval) {
        limitedFor += frameMs;
        if (limitedFor >= 10000) { frameInterval = limitedFor = sum = count = 0; }
        return;
      }
      sum += frameMs;
      count++;
      if (sum < 2000) return;
      const average = sum / count;
      sum = count = 0;
      if (cpuBlocked) { slowWindows = fastWindows = 0; return; }
      slowWindows = average > 24 ? slowWindows + 1 : 0;
      fastWindows = average < 18 ? fastWindows + 1 : 0;
      if (slowWindows >= 2) {
        if (ratio > minimum) ratio = clamp(ratio - 0.25, minimum, maximum);
        else frameInterval = 1000 / 30;
        slowWindows = fastWindows = 0;
      } else if (fastWindows >= 4 && ratio < maximum) {
        ratio = clamp(ratio + 0.25, minimum, maximum);
        fastWindows = 0;
      }
    },
  };
}
