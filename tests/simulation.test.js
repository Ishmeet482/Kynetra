import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSimulation } from '../src/scene/simulation.js';

test('repeated shots reuse beam buffers and leave/dispose clears effects', () => {
  const scene = new THREE.Scene();
  const state = { score: 0, wave: 0 };
  const simulation = createSimulation(scene, state, () => {});
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 2, 20), new THREE.Vector3(0, 0, 1));
  simulation.enter();
  const line = scene.children.find((object) => object.isLine);
  const geometry = line.geometry;
  for (let shot = 0; shot < 20; shot++) {
    simulation.shoot(ray, shot * 500);
    assert.equal(line.visible, true);
    simulation.update(0.2, shot * 0.5, false);
    assert.equal(line.visible, false);
  }
  assert.equal(scene.children.filter((object) => object.isLine).length, 1);
  assert.equal(line.geometry, geometry);
  assert.equal(state.score, 0);
  simulation.leave();
  assert.equal(line.visible, false);
  simulation.dispose();
  assert.equal(scene.children.some((object) => object.isLine), false);
});
