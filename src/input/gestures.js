import { clamp, damping } from '../core/math.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
const fingers = [[5, 6, 8], [9, 10, 12], [13, 14, 16], [17, 18, 20]];

export function describeHand(landmarks) {
  if (landmarks?.length !== 21 || landmarks.some((point) => !Number.isFinite(point?.x) || !Number.isFinite(point?.y) || !Number.isFinite(point.z ?? 0))) return null;
  const wrist = landmarks[0];
  const scale = distance(wrist, landmarks[9]);
  if (scale < 0.025) return null;
  // Ratios and joint angles survive wrist rotation; image-space Y comparisons do not.
  const extended = fingers.map(([base, joint, tip]) => {
    const a = landmarks[base];
    const b = landmarks[joint];
    const c = landmarks[tip];
    const ab = { x: a.x - b.x, y: a.y - b.y, z: (a.z ?? 0) - (b.z ?? 0) };
    const cb = { x: c.x - b.x, y: c.y - b.y, z: (c.z ?? 0) - (b.z ?? 0) };
    const cosine = (ab.x * cb.x + ab.y * cb.y + ab.z * cb.z) / Math.max(0.00001, distance(a, b) * distance(c, b));
    return cosine < -0.45 && distance(c, wrist) > distance(b, wrist) * 1.12;
  });
  const count = extended.filter(Boolean).length;
  const folded = fingers.filter(([, joint, tip]) => distance(landmarks[tip], wrist) < distance(landmarks[joint], wrist) * 1.15).length;
  const gesture = count === 4 ? 'palm' : extended[0] && count === 1 ? 'point' : count === 0 && folded >= 3 ? 'fist' : 'unknown';
  const palm = { x: (landmarks[0].x + landmarks[9].x) / 2, y: (landmarks[0].y + landmarks[9].y) / 2 };
  return { gesture, scale, palm, tip: landmarks[8] };
}

export class GestureFilter {
  constructor({ dwell = 70, lostAfter = 220 } = {}) {
    this.dwell = dwell;
    this.lostAfter = lostAfter;
    this.reset();
  }

  reset() {
    this.current = 'none';
    this.candidate = 'none';
    this.since = 0;
    this.lastSeen = -Infinity;
    this.lastTime = null;
    this.position = null;
    this.handAnchor = null;
    this.cursorAnchor = null;
    this.zoomDistance = null;
    this.previousPalm = null;
    this.smoothedScale = null;
  }

  update(hands, now) {
    const descriptions = hands.map(describeHand).filter(Boolean);
    if (this.lastTime !== null && now <= this.lastTime) return { gesture: this.current, visible: false, lost: false };
    const dt = this.lastTime === null ? 1 / 30 : clamp((now - this.lastTime) / 1000, 0, 0.25);
    this.lastTime = now;
    if (!descriptions.length) {
      if (now - this.lastSeen >= this.lostAfter) this.reset();
      return { gesture: this.current, visible: false, lost: this.current === 'none' };
    }
    this.lastSeen = now;
    const primary = descriptions.length === 1 || !this.previousPalm ? descriptions[0] : descriptions.reduce((nearest, hand) => distance(hand.palm, this.previousPalm) < distance(nearest.palm, this.previousPalm) ? hand : nearest);
    this.previousPalm = primary.palm;
    const proposed = descriptions.length > 1 ? 'zoom' : primary.gesture;
    if (proposed !== this.candidate) {
      this.candidate = proposed;
      this.since = now;
    }
    const previous = this.current;
    if (now - this.since >= this.dwell) this.current = proposed;
    const changed = previous !== this.current;
    // Closing a finger moves its tip. Anchor fist motion to the palm at transition.
    if (changed && this.current === 'fist') {
      this.handAnchor = { ...primary.palm };
      this.cursorAnchor = this.position ? { ...this.position } : { x: 1 - primary.tip.x, y: primary.tip.y };
    }
    let target = { x: 1 - primary.tip.x, y: primary.tip.y };
    if (this.current === 'point' && primary.gesture !== 'point' && this.position) target = { ...this.position };
    if (this.current === 'palm') target = { x: 1 - primary.palm.x, y: primary.palm.y };
    if (this.current === 'fist' && this.handAnchor) target = {
      x: this.cursorAnchor.x - primary.palm.x + this.handAnchor.x,
      y: this.cursorAnchor.y + primary.palm.y - this.handAnchor.y,
    };
    target.x = clamp(target.x, 0.01, 0.99);
    target.y = clamp(target.y, 0.01, 0.99);
    const before = this.position ? { ...this.position } : target;
    if (!this.position) this.position = { ...target };
    if (changed && this.current === 'palm') this.position = { ...target };
    const alpha = damping(28, dt);
    this.position.x += (target.x - this.position.x) * alpha;
    this.position.y += (target.y - this.position.y) * alpha;
    const gap = descriptions.length > 1 ? distance(descriptions[0].palm, descriptions[1].palm) : null;
    const zoom = this.current === 'zoom' && !changed && this.zoomDistance !== null && gap !== null ? clamp(gap - this.zoomDistance, -0.08, 0.08) : 0;
    this.zoomDistance = gap;
    this.smoothedScale ??= primary.scale;
    this.smoothedScale += (primary.scale - this.smoothedScale) * damping(10, dt);
    return {
      gesture: this.current, changed, visible: true, lost: false,
      x: this.position.x, y: this.position.y, scale: this.smoothedScale,
      dx: changed ? 0 : this.position.x - before.x,
      dy: changed ? 0 : this.position.y - before.y,
      zoom,
    };
  }
}
