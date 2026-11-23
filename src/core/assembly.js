export const SNAP_DISTANCE = 0.72;

export const COMPONENTS = [
  { id: 'nucleus', label: 'Nucleus', shape: 'nucleus', socket: [0, 2.6, 0], start: [-3.7, 2.8, 0.7] },
  { id: 'halo', label: 'Upper halo', shape: 'halo', socket: [0, 3.7, 0], start: [3.25, 4.2, 0] },
  { id: 'collar', label: 'Lower collar', shape: 'collar', socket: [0, 1.45, 0], start: [-3.4, 0.9, 0.3] },
  { id: 'west', label: 'West fin', shape: 'fin', socket: [-1.25, 2.6, 0], start: [-4.2, 4.6, -0.2], rotation: -Math.PI / 2 },
  { id: 'east', label: 'East fin', shape: 'fin', socket: [1.25, 2.6, 0], start: [3.9, 2.5, 0.3], rotation: Math.PI / 2 },
  { id: 'plinth', label: 'Foundation', shape: 'plinth', socket: [0, 0.62, 0], start: [3.1, 0.7, 1] },
];

export function canSnap(component, position, installed, tolerance = SNAP_DISTANCE) {
  if (!component || installed.has(component.id) || !Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite)) return false;
  return Math.hypot(...position.map((value, axis) => value - component.socket[axis])) <= tolerance;
}

export function installComponent(installed, id) {
  if (!COMPONENTS.some((component) => component.id === id) || installed.has(id)) return false;
  installed.add(id);
  return true;
}

export function isComplete(installed) {
  return COMPONENTS.every((component) => installed.has(component.id));
}
