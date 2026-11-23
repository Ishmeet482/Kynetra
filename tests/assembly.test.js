import test from 'node:test';
import assert from 'node:assert/strict';
import { COMPONENTS, SNAP_DISTANCE, canSnap, installComponent, isComplete } from '../src/core/assembly.js';
import { createState } from '../src/core/state.js';

test('snapping checks matching socket, depth, bounds, and duplicate installation', () => {
  const component = COMPONENTS[0];
  const installed = new Set();
  assert.equal(canSnap(component, component.socket, installed), true);
  assert.equal(canSnap(component, [component.socket[0], component.socket[1], SNAP_DISTANCE + 0.01], installed), false);
  assert.equal(canSnap(component, COMPONENTS[1].socket, installed), false);
  assert.equal(canSnap(component, [NaN, 0, 0], installed), false);
  assert.equal(canSnap(component, [], installed), false);
  assert.equal(installComponent(installed, component.id), true);
  assert.equal(installComponent(installed, component.id), false);
  assert.equal(canSnap(component, component.socket, installed), false);
  assert.equal(installComponent(installed, 'missing'), false);
  assert.equal(installed.size, 1);
});

test('simulation unlock requires exactly the six known pieces', () => {
  const { state, install, setMode, reset } = createState();
  assert.equal(setMode('simulation'), false);
  for (const component of COMPONENTS.slice(0, 5)) install(component.id);
  assert.equal(setMode('simulation'), false);
  install(COMPONENTS[5].id);
  assert.equal(isComplete(state.installed), true);
  assert.equal(setMode('simulation'), true);
  assert.equal(install(COMPONENTS[0].id), false);
  assert.equal(setMode('unexpected'), false);
  state.score = 5;
  reset();
  assert.equal(state.mode, 'assembly');
  assert.equal(state.installed.size, 0);
  assert.equal(state.score, 0);
  assert.equal(setMode('simulation'), false);
});
