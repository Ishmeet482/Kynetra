import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnimationLoop } from '../src/animation.js';

test('frame cap, visibility pause/resume, and disposal keep only one scheduled callback', () => {
  const saved = Object.fromEntries(['document', 'requestAnimationFrame', 'cancelAnimationFrame'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const pending = new Map();
  let id = 0;
  let visibility;
  const updates = [];
  const document = { hidden: false, addEventListener(_type, callback) { visibility = callback; }, removeEventListener() { visibility = null; } };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  Object.defineProperty(globalThis, 'requestAnimationFrame', { configurable: true, value: (callback) => { pending.set(++id, callback); return id; } });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: (frame) => pending.delete(frame) });
  const tick = (now) => { const [frame, callback] = pending.entries().next().value; pending.delete(frame); callback(now); };
  try {
    const stop = createAnimationLoop((dt) => updates.push(dt), () => 1000 / 30);
    tick(0); tick(16.7); tick(33.4);
    assert.equal(updates.length, 2);
    assert.equal(pending.size, 1);
    document.hidden = true;
    visibility();
    assert.equal(pending.size, 0);
    document.hidden = false;
    visibility();
    tick(10000);
    assert.equal(updates.at(-1), 0);
    stop();
    assert.equal(pending.size, 0);
    assert.equal(visibility, null);
  } finally {
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
