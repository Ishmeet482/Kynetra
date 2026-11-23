import test from 'node:test';
import assert from 'node:assert/strict';
import { createQualityController } from '../src/core/quality.js';

function frames(quality, count, frameMs, blocked = false) {
  for (let frame = 0; frame < count; frame++) quality.sample(frameMs, blocked);
}

test('adaptive quality ignores single spikes and main-thread inference contention', () => {
  const quality = createQualityController(2);
  assert.equal(quality.pixelRatio, 1.5);
  quality.sample(180);
  frames(quality, 500, 16.67);
  assert.equal(quality.pixelRatio, 1.5);
  frames(quality, 200, 65, true);
  assert.equal(quality.pixelRatio, 1.5);
});

test('sustained load reduces resolution before a 30 FPS cap; recovery probes restore 60', () => {
  const quality = createQualityController(1);
  frames(quality, 130, 34);
  assert.equal(quality.pixelRatio, 0.75);
  assert.equal(quality.frameInterval, 0);
  frames(quality, 130, 34);
  assert.ok(quality.frameInterval > 33);
  frames(quality, 310, 34);
  assert.equal(quality.frameInterval, 0);
  frames(quality, 650, 16.67);
  assert.equal(quality.pixelRatio, 1);
});

test('fixed quality stays fixed; reset discards a partial slow window', () => {
  const fixed = createQualityController(2, { enabled: false });
  frames(fixed, 500, 60);
  assert.equal(fixed.pixelRatio, 1.5);
  assert.equal(fixed.frameInterval, 0);
  const adaptive = createQualityController(1);
  frames(adaptive, 61, 34);
  adaptive.reset();
  frames(adaptive, 61, 34);
  assert.equal(adaptive.pixelRatio, 1);
});
