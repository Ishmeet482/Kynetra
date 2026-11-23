import { installComponent, isComplete } from './assembly.js';

export function createState() {
  const state = { mode: 'assembly', installed: new Set(), selected: null, score: 0, wave: 0 };
  return {
    state,
    install(id) { return state.mode === 'assembly' && installComponent(state.installed, id); },
    setMode(mode) {
      if (!['assembly', 'simulation'].includes(mode) || (mode === 'simulation' && !isComplete(state.installed))) return false;
      state.mode = mode;
      state.selected = null;
      return true;
    },
    reset() {
      Object.assign(state, { mode: 'assembly', installed: new Set(), selected: null, score: 0, wave: 0 });
    },
  };
}
