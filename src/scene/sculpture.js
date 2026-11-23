import * as THREE from 'three';
import { COMPONENTS, SNAP_DISTANCE } from '../core/assembly.js';
import { damping } from '../core/math.js';

function geometryFor(shape) {
  switch (shape) {
    case 'nucleus': return new THREE.IcosahedronGeometry(0.77, 0);
    case 'halo': return new THREE.TorusGeometry(1.05, 0.115, 10, 64);
    case 'collar': return new THREE.TorusGeometry(0.72, 0.16, 8, 48);
    case 'fin': return new THREE.ConeGeometry(0.35, 1.25, 4);
    case 'plinth': return new THREE.CylinderGeometry(0.62, 0.85, 0.62, 6);
    default: throw new Error(`Unknown component shape: ${shape}`);
  }
}

export function createSculpture(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const pieces = new Map();
  const sockets = new Map();
  const installed = new Set();
  const available = [];
  const records = [];
  const geometryCache = new Map();
  const snapDistanceSquared = SNAP_DISTANCE * SNAP_DISTANCE;
  let revision = 0;
  let renderedRevision = -1;
  let selected = null;
  let hover = null;
  let grabbed = null;
  const mint = new THREE.Color(0xb5efd3);
  const white = new THREE.Color(0xe5ebe5);
  const blue = new THREE.Color(0x95bfe8);

  for (const [index, component] of COMPONENTS.entries()) {
    let geometry = geometryCache.get(component.shape);
    if (!geometry) {
      geometry = geometryFor(component.shape);
      if (['halo', 'collar'].includes(component.shape)) geometry.rotateX(Math.PI / 2);
      geometryCache.set(component.shape, geometry);
    }
    const material = new THREE.MeshStandardMaterial({
      color: index === 0 ? mint : index === 1 || index === 4 ? blue : white,
      metalness: 0.55, roughness: 0.29, flatShading: true,
      emissive: mint, emissiveIntensity: 0,
    });
    const piece = new THREE.Mesh(geometry, material);
    piece.position.fromArray(component.start);
    piece.rotation.z = component.rotation ?? 0;
    piece.userData.component = component;
    group.add(piece);
    pieces.set(component.id, piece);
    available.push(piece);
    const socket = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: mint, wireframe: true, transparent: true, opacity: 0.16, depthWrite: false }));
    socket.position.fromArray(component.socket);
    socket.rotation.z = component.rotation ?? 0;
    socket.updateMatrix();
    socket.matrixAutoUpdate = false;
    group.add(socket);
    sockets.set(component.id, socket);
    records.push({ component, piece, socket, ready: false });
  }

  return {
    group, pieces, sockets,
    get available() { return available; },
    get revision() { return revision; },
    get grabbed() { return grabbed; },
    select(id) { selected = id; },
    highlight(piece) { hover = piece; },
    grab(piece) { grabbed = piece; selected = piece?.userData.component.id ?? null; },
    release() { grabbed = null; },
    install(id) {
      if (installed.has(id)) return;
      installed.add(id);
      available.splice(available.indexOf(pieces.get(id)), 1);
      revision++;
      sockets.get(id).visible = false;
      selected = null;
    },
    reset() {
      installed.clear();
      revision++;
      available.length = 0;
      selected = hover = grabbed = null;
      group.visible = true;
      for (const component of COMPONENTS) {
        const piece = pieces.get(component.id);
        piece.position.fromArray(component.start);
        piece.rotation.set(0, 0, component.rotation ?? 0);
        available.push(piece);
        sockets.get(component.id).visible = true;
      }
    },
    update(dt, elapsed, reducedMotion) {
      let changed = revision !== renderedRevision;
      renderedRevision = revision;
      const highlightAlpha = damping(16, dt);
      const snapAlpha = damping(18, dt);
      for (const record of records) {
        const { component, piece, socket } = record;
        const active = selected === component.id || hover === piece || grabbed === piece;
        const targetEmission = active ? 0.32 : 0;
        const difference = targetEmission - piece.material.emissiveIntensity;
        if (Math.abs(difference) > 0.001) {
          piece.material.emissiveIntensity += difference * highlightAlpha;
          changed = true;
        } else if (difference !== 0) { piece.material.emissiveIntensity = targetEmission; changed = true; }
        const opacity = selected === component.id ? 0.68 : 0.16;
        if (socket.material.opacity !== opacity) { socket.material.opacity = opacity; changed = true; }
        const ready = grabbed === piece && piece.position.distanceToSquared(socket.position) <= snapDistanceSquared;
        if (record.ready !== ready) {
          record.ready = ready;
          socket.material.color.set(ready ? 0xffffff : mint);
          changed = true;
        }
        if (installed.has(component.id)) {
          if (piece.position.distanceToSquared(socket.position) > 0.000001) {
            piece.position.lerp(socket.position, snapAlpha);
            changed = true;
          } else if (!piece.position.equals(socket.position)) { piece.position.copy(socket.position); changed = true; }
          if (!reducedMotion && component.shape === 'nucleus') { piece.rotation.y = elapsed * 0.18; changed = true; }
        }
      }
      return changed;
    },
  };
}
