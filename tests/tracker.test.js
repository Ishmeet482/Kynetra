import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraErrorMessage, createHandTracker } from '../src/input/hand-tracker.js';

test('camera failures give actionable fallback messages', () => {
  assert.match(cameraErrorMessage({ name: 'NotAllowedError' }), /permission denied/);
  assert.match(cameraErrorMessage({ name: 'NotFoundError' }), /No webcam/);
  assert.match(cameraErrorMessage({ name: 'NotReadableError' }), /Close other apps/);
  assert.match(cameraErrorMessage({ name: 'UnknownError' }), /Mouse controls remain available/);
});

test('camera granted after startup cancellation is immediately released', async () => {
  let resolvePermission;
  let stopped = 0;
  const statuses = [];
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { isSecureContext: true } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {
    mediaDevices: { getUserMedia: () => new Promise((resolve) => { resolvePermission = resolve; }) },
  } });
  try {
    const video = { pause() {}, srcObject: null };
    const tracker = createHandTracker(video, () => {}, (status) => statuses.push(status));
    const startup = tracker.start();
    assert.equal(tracker.running, true);
    tracker.stop();
    resolvePermission({ getTracks: () => [{ stop: () => stopped++ }] });
    await startup;
    assert.equal(stopped, 1);
    assert.equal(tracker.running, false);
    assert.deepEqual(statuses, ['permission', 'off']);
    assert.equal(video.srcObject, null);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else delete globalThis.window;
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
    else delete globalThis.navigator;
  }
});

test('video scheduling keeps one inference in flight and ignores results after stop', async () => {
  const saved = Object.fromEntries(['window', 'navigator', 'document'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let scheduled;
  let cancelled = 0;
  let stopped = 0;
  let disposed = 0;
  let calls = 0;
  let resolveInference;
  const results = [];
  const stream = {
    getTracks: () => [{ stop: () => stopped++ }],
    getVideoTracks: () => [{ addEventListener() {} }],
  };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { isSecureContext: true } });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { hidden: false } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => stream } } });
  try {
    const video = {
      readyState: 2, currentTime: 1, srcObject: null, async play() {}, pause() {},
      requestVideoFrameCallback(callback) { scheduled = callback; return 1; },
      cancelVideoFrameCallback() { cancelled++; },
    };
    const tracker = createHandTracker(video, (...args) => results.push(args), () => {}, () => {}, {
      createEngine: async () => ({
        backend: 'worker',
        process() { calls++; return new Promise((resolve) => { resolveInference = resolve; }); },
        dispose() { disposed++; },
      }),
    });
    await tracker.start();
    scheduled(performance.now());
    video.currentTime++;
    scheduled(performance.now() + 60);
    scheduled(performance.now() + 120);
    assert.equal(calls, 1);
    resolveInference({ landmarks: [], inferenceMs: 12 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(results.length, 1);
    video.currentTime++;
    scheduled(performance.now() + 200);
    assert.equal(calls, 2);
    tracker.stop();
    resolveInference({ landmarks: [], inferenceMs: 12 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(results.length, 1);
    assert.equal(cancelled, 1);
    assert.equal(stopped, 1);
    assert.equal(disposed, 1);
    assert.equal(video.srcObject, null);
  } finally {
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
