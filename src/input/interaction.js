import * as THREE from 'three';
import { canSnap } from '../core/assembly.js';
import { clamp, damping } from '../core/math.js';

export function createInteraction(world, sculpture, store, simulation, ui) {
  const raycaster = new THREE.Raycaster();
  const cursor = new THREE.Vector2();
  const plane = new THREE.Plane();
  const normal = new THREE.Vector3();
  const intersection = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const original = new THREE.Vector3();
  const projected = new THREE.Vector3();
  const hits = [];
  const viewport = world.viewport ?? world.renderer.domElement.getBoundingClientRect();
  const snapPosition = [0, 0, 0];
  let cursorDirty = true;
  let cameraRevision = -1;
  let sculptureRevision = -1;
  let cursorStyle = '';
  let hasCursor = false;
  let dragDistance = 0;
  let startScale = 0;
  let depth = 1;

  function aim(x, y) {
    cursorDirty ||= !hasCursor || cursor.x !== x * 2 - 1 || cursor.y !== 1 - y * 2;
    cursor.set(x * 2 - 1, 1 - y * 2);
    hasCursor = true;
  }

  function pick() {
    sculpture.group.updateMatrixWorld(true);
    const available = sculpture.available;
    hits.length = 0;
    const hit = raycaster.intersectObjects(available, false, hits)[0];
    if (hit) return hit.object;
    // Small screen-space tolerance helps thin rings without selecting distant pieces.
    const { width, height } = viewport;
    let nearest = null;
    let nearestDistance = 26;
    for (const piece of available) {
      projected.copy(piece.position).project(world.camera);
      if (projected.z < -1 || projected.z > 1) continue;
      const distance = Math.hypot((projected.x - cursor.x) * width / 2, (projected.y - cursor.y) * height / 2);
      if (distance < nearestDistance) { nearest = piece; nearestDistance = distance; }
    }
    return nearest;
  }

  function begin(scale = 0) {
    if (store.state.mode !== 'assembly') return false;
    raycaster.setFromCamera(cursor, world.camera);
    const piece = pick();
    if (!piece) return false;
    sculpture.grab(piece);
    original.copy(piece.position);
    desired.copy(piece.position);
    world.camera.getWorldDirection(normal);
    plane.setFromNormalAndCoplanarPoint(normal, piece.position);
    if (raycaster.ray.intersectPlane(plane, intersection)) offset.copy(piece.position).sub(intersection);
    else offset.set(0, 0, 0);
    dragDistance = plane.distanceToPoint(world.camera.position);
    startScale = scale;
    depth = 1;
    store.state.selected = piece.userData.component.id;
    ui.render(store.state);
    return true;
  }

  function end({ cancel = false } = {}) {
    const piece = sculpture.grabbed;
    if (!piece) return;
    const component = piece.userData.component;
    if (cancel) {
      piece.position.copy(original);
      ui.notify('Grab cancelled. Piece returned to its starting position.');
    } else if (canSnap(component, piece.position.toArray(snapPosition), store.state.installed) && store.install(component.id)) {
      sculpture.install(component.id);
      ui.notify(`${component.label} placed.`);
    } else ui.notify('Piece released. Move closer to its matching outline to snap.');
    sculpture.release();
    cursorDirty = true;
    ui.render(store.state);
  }

  return {
    aim,
    begin,
    end,
    get dragging() { return Boolean(sculpture.grabbed); },
    clear() { hasCursor = false; sculpture.highlight(null); },
    adjustDepth(delta) { depth = clamp(depth + delta, 0.45, 1.8); },
    handDepth(scale) { if (startScale > 0 && scale > 0) depth = clamp(startScale / scale, 0.55, 1.6); },
    shoot(now) { raycaster.setFromCamera(cursor, world.camera); simulation.shoot(raycaster, now); },
    update(dt) {
      if (!hasCursor) return false;
      const piece = sculpture.grabbed;
      const dirty = cursorDirty || cameraRevision !== world.cameraRevision || sculptureRevision !== sculpture.revision;
      cursorDirty = false;
      cameraRevision = world.cameraRevision;
      sculptureRevision = sculpture.revision;
      if (piece) {
        raycaster.setFromCamera(cursor, world.camera);
        plane.constant = -normal.dot(world.camera.position) + dragDistance * depth;
        if (raycaster.ray.intersectPlane(plane, intersection)) {
          desired.copy(intersection).add(offset);
          desired.x = clamp(desired.x, -7, 7);
          desired.y = clamp(desired.y, 0.4, 7);
          desired.z = clamp(desired.z, -4, 4);
          piece.position.lerp(desired, damping(24, dt));
          const ready = canSnap(piece.userData.component, piece.position.toArray(snapPosition), store.state.installed);
          ui.action(ready ? 'Release to snap into place.' : `Moving ${piece.userData.component.label.toLowerCase()}`, ready);
          return true;
        }
      } else if (store.state.mode === 'assembly' && dirty) {
        raycaster.setFromCamera(cursor, world.camera);
        const hovered = pick();
        sculpture.highlight(hovered);
        const style = hovered ? 'grab' : 'crosshair';
        if (cursorStyle !== style) { cursorStyle = style; world.renderer.domElement.style.cursor = style; }
        ui.action(hovered ? `Grab ${hovered.userData.component.label.toLowerCase()}` : 'Pick a piece. Find its place.');
      }
      return false;
    },
  };
}
