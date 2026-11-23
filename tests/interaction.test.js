import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createInteraction } from '../src/input/interaction.js';
import { createSculpture } from '../src/scene/sculpture.js';
import { createState } from '../src/core/state.js';

function setup() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 2.6, 14);
  camera.lookAt(0, 2.6, 0);
  camera.updateMatrixWorld();
  const sculpture = createSculpture(scene);
  const store = createState();
  const world = { camera, renderer: { domElement: { style: {}, getBoundingClientRect: () => ({ width: 800, height: 800 }) } } };
  const ui = { render() {}, notify() {}, action() {} };
  const controls = createInteraction(world, sculpture, store, { shoot() {} }, ui);
  const aimAt = (position) => {
    const projected = new THREE.Vector3(...position).project(camera);
    controls.aim((projected.x + 1) / 2, (1 - projected.y) / 2);
  };
  const dispose = () => scene.traverse((object) => { object.geometry?.dispose(); object.material?.dispose(); });
  return { sculpture, store, controls, aimAt, dispose };
}

test('grab uses current ray; cancelling restores the original position', () => {
  const { sculpture, controls, aimAt, dispose } = setup();
  try {
    aimAt(sculpture.pieces.get('nucleus').position.toArray());
    aimAt(sculpture.pieces.get('east').position.toArray());
    assert.equal(controls.begin(), true);
    assert.equal(sculpture.grabbed.userData.component.id, 'east');
    const start = sculpture.grabbed.position.clone();
    aimAt([0, 3, 0]);
    controls.update(0.5);
    assert.ok(sculpture.grabbed.position.distanceTo(start) > 1);
    controls.end({ cancel: true });
    assert.equal(controls.dragging, false);
    assert.ok(sculpture.pieces.get('east').position.distanceTo(start) < 0.001);
  } finally { dispose(); }
});

test('dragging into a socket installs once; installed components cannot be grabbed', () => {
  const { sculpture, store, controls, aimAt, dispose } = setup();
  try {
    const piece = sculpture.pieces.get('halo');
    aimAt(piece.position.toArray());
    controls.begin();
    aimAt(piece.userData.component.socket);
    for (let frame = 0; frame < 30; frame++) controls.update(1 / 60);
    controls.end();
    assert.equal(store.state.installed.has('halo'), true);
    assert.equal(sculpture.available.includes(piece), false);
    controls.end();
    assert.equal(store.state.installed.size, 1);
    aimAt(piece.position.toArray());
    assert.equal(controls.begin(), false);
  } finally { dispose(); }
});

test('stationary cursor does not raycast again until camera or selectable set changes', () => {
  const { sculpture, controls, aimAt, dispose } = setup();
  const raycast = THREE.Raycaster.prototype.intersectObjects;
  let calls = 0;
  THREE.Raycaster.prototype.intersectObjects = function (...args) { calls++; return raycast.apply(this, args); };
  try {
    const available = sculpture.available;
    assert.equal(sculpture.available, available);
    aimAt(sculpture.pieces.get('nucleus').position.toArray());
    controls.update(1 / 60);
    for (let frame = 0; frame < 60; frame++) controls.update(1 / 60);
    assert.equal(calls, 1);
    sculpture.install('halo');
    assert.equal(available.length, 5);
    controls.update(1 / 60);
    assert.equal(calls, 2);
    sculpture.reset();
    assert.equal(available.length, 6);
    assert.equal(sculpture.pieces.get('west').geometry, sculpture.pieces.get('east').geometry);
  } finally { THREE.Raycaster.prototype.intersectObjects = raycast; dispose(); }
});
