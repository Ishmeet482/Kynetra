import { GestureFilter } from './gestures.js';

export function createHandControls(world, interaction, ui, pointerIsActive) {
  const filter = new GestureFilter();
  let previous = 'none';
  let lastResult = -Infinity;
  let suppressedUntil = 0;
  function reset() {
    interaction.end({ cancel: true });
    interaction.clear();
    filter.reset();
    previous = 'none';
    ui.handCursor(null);
  }
  return {
    reset,
    suppress(now) { if (previous !== 'none') reset(); suppressedUntil = now + 800; },
    results(hands, now, receivedAt = now) {
      lastResult = receivedAt;
      if (pointerIsActive() || now < suppressedUntil) return;
      const sample = filter.update(hands, now);
      if (sample.lost) { if (previous !== 'none') reset(); ui.gesture('No hand detected'); return; }
      if (!sample.visible) { ui.handCursor(null); return; }
      const gesture = sample.gesture;
      if (gesture !== 'fist' && previous === 'fist') interaction.end();
      if (gesture === 'zoom') {
        interaction.clear();
        world.zoom(-sample.zoom * 18);
      } else if (gesture === 'palm') {
        interaction.clear();
        if (previous === 'palm') world.orbit(sample.dx, sample.dy);
      } else if (gesture === 'point' || gesture === 'fist') {
        interaction.aim(sample.x, sample.y);
        if (gesture === 'fist') {
          if (previous !== 'fist') interaction.begin(sample.scale);
          interaction.handDepth(sample.scale);
          interaction.shoot(now);
        }
      } else interaction.clear();
      ui.handCursor(['point', 'fist'].includes(gesture) ? sample : null);
      ui.gesture({ palm: 'Open palm · Orbit', point: 'Point · Cursor', fist: 'Fist · Grab / Fire', zoom: 'Two hands · Zoom', unknown: 'Extend your index finger or open your palm', none: 'Hold a gesture briefly' }[gesture]);
      previous = gesture;
    },
    update(now) { if (previous !== 'none' && now - lastResult > 350) { reset(); ui.gesture('Tracking interrupted'); } },
  };
}
