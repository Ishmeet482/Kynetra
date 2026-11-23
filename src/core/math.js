export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const damping = (speed, dt) => 1 - Math.exp(-speed * dt);
