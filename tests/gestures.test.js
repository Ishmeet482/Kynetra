import test from 'node:test';
import assert from 'node:assert/strict';
import { describeHand, GestureFilter } from '../src/input/gestures.js';

function hand(gesture, rotation = 0, size = 1, x = 0) {
  const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.75, z: 0 }));
  points[0] = { x: 0.5, y: 0.85, z: 0 };
  for (let finger = 0; finger < 4; finger++) {
    const base = 5 + finger * 4;
    const fingerX = 0.41 + finger * 0.06;
    const open = gesture === 'palm' || (gesture === 'point' && finger === 0);
    points[base] = { x: fingerX, y: 0.62, z: 0 };
    points[base + 1] = { x: fingerX, y: 0.48, z: 0 };
    points[base + 2] = { x: fingerX, y: open ? 0.36 : 0.62, z: 0 };
    points[base + 3] = { x: fingerX, y: open ? 0.23 : 0.73, z: 0 };
  }
  return points.map((point) => {
    const dx = (point.x - 0.5) * size;
    const dy = (point.y - 0.5) * size;
    return { x: 0.5 + dx * Math.cos(rotation) - dy * Math.sin(rotation) + x, y: 0.5 + dx * Math.sin(rotation) + dy * Math.cos(rotation), z: 0 };
  });
}

for (const gesture of ['palm', 'point', 'fist']) {
  test(`${gesture} recognition survives rotation and distance changes`, () => {
    for (const rotation of [0, Math.PI / 2, Math.PI, -Math.PI / 3]) {
      for (const size of [0.4, 1, 1.3]) assert.equal(describeHand(hand(gesture, rotation, size)).gesture, gesture);
    }
  });
}

test('invalid or tiny hands are rejected', () => {
  assert.equal(describeHand([]), null);
  assert.equal(describeHand(hand('palm', 0, 0.001)), null);
  const invalid = hand('palm');
  invalid[8].x = NaN;
  assert.equal(describeHand(invalid), null);
});

test('gesture dwell rejects jitter; camera entry has no jump', () => {
  const filter = new GestureFilter();
  assert.equal(filter.update([hand('point')], 0).gesture, 'none');
  assert.equal(filter.update([hand('point')], 120).gesture, 'point');
  assert.equal(filter.update([hand('fist')], 150).gesture, 'point');
  assert.equal(filter.update([hand('point')], 180).gesture, 'point');
  filter.update([hand('palm')], 220);
  const sample = filter.update([hand('palm', 0, 1, 0.1)], 340);
  assert.equal(sample.gesture, 'palm');
  assert.equal(sample.dx, 0);
  assert.equal(sample.dy, 0);
});

test('tracking loss eventually cancels gesture and clears zoom baseline', () => {
  const filter = new GestureFilter();
  const hands = [hand('palm', 0, 0.4, -0.2), hand('palm', 0, 0.4, 0.2)];
  filter.update(hands, 0);
  assert.equal(filter.update(hands, 120).gesture, 'zoom');
  assert.equal(filter.update([], 200).lost, false);
  assert.equal(filter.update([], 400).lost, true);
  assert.equal(filter.update(hands, 410).zoom, 0);
  const sample = filter.update(hands, 540);
  assert.equal(sample.gesture, 'zoom');
  assert.equal(sample.zoom, 0);
});

test('two-hand zoom is invariant to detection order', () => {
  const filter = new GestureFilter();
  const left = hand('palm', 0, 0.4, -0.2);
  const right = hand('palm', 0, 0.4, 0.2);
  filter.update([left, right], 0);
  filter.update([left, right], 120);
  assert.equal(filter.update([right, left], 180).zoom, 0);
});

test('closing a fist preserves the pointed cursor instead of following the folded tip', () => {
  const filter = new GestureFilter();
  filter.update([hand('point')], 0);
  const pointed = filter.update([hand('point')], 120);
  const pending = filter.update([hand('fist')], 150);
  const grabbed = filter.update([hand('fist')], 280);
  assert.equal(pending.x, pointed.x);
  assert.equal(pending.y, pointed.y);
  assert.equal(grabbed.x, pointed.x);
  assert.equal(grabbed.y, pointed.y);
});

test('stationary palm does not inherit cursor motion from the prior pointing gesture', () => {
  const filter = new GestureFilter();
  filter.update([hand('point')], 0);
  filter.update([hand('point')], 120);
  filter.update([hand('palm')], 150);
  filter.update([hand('palm')], 280);
  const stationary = filter.update([hand('palm')], 320);
  assert.equal(stationary.dx, 0);
  assert.equal(stationary.dy, 0);
});

test('out-of-order tracking timestamps cannot move the cursor or change a gesture', () => {
  const filter = new GestureFilter();
  filter.update([hand('point')], 0);
  const stable = filter.update([hand('point')], 100);
  const stale = filter.update([hand('fist', 0, 1, 0.2)], 90);
  assert.equal(stale.gesture, 'point');
  assert.equal(stale.visible, false);
  const next = filter.update([hand('point')], 160);
  assert.equal(next.x, stable.x);
  assert.equal(next.y, stable.y);
});

test('stable gestures commit after one new sample at 10 Hz', () => {
  const filter = new GestureFilter();
  filter.update([hand('point')], 0);
  assert.equal(filter.update([hand('point')], 100).gesture, 'point');
  filter.update([hand('fist')], 200);
  assert.equal(filter.update([hand('fist')], 300).gesture, 'fist');
});
