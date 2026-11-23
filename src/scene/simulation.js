import * as THREE from 'three';

export function createSimulation(scene, state, onChange) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);
  const geometry = new THREE.IcosahedronGeometry(0.43, 1);
  const material = new THREE.MeshStandardMaterial({ color: 0xf3a28c, emissive: 0xcc573b, emissiveIntensity: 0.4, metalness: 0.35, roughness: 0.35, wireframe: true });
  const targets = [];
  const beams = [];
  const hits = [];
  const start = new THREE.Vector3();
  const end = new THREE.Vector3();
  let dirty = true;
  function createBeam() {
    const beamGeometry = new THREE.BufferGeometry();
    beamGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(beamGeometry, new THREE.LineBasicMaterial({ color: 0xffba9e, transparent: true }));
    line.frustumCulled = false;
    line.visible = false;
    scene.add(line);
    const beam = { line, life: 0 };
    beams.push(beam);
    return beam;
  }
  createBeam();
  let active = false;
  let waveDelay = 0;
  let lastShot = -Infinity;

  function spawnWave() {
    state.wave++;
    // Keep targets in a bounded volume around the sculpture, above the floor.
    for (let index = 0; index < 5; index++) {
      const angle = index / 5 * Math.PI * 2 + Math.random() * 0.2;
      const target = new THREE.Mesh(geometry, material);
      target.userData.origin = new THREE.Vector3(Math.cos(angle) * 3.3, 2.5 + Math.sin(angle) * 1.9, 1.7 + Math.random() * 0.8);
      target.position.copy(target.userData.origin);
      target.userData.phase = Math.random() * Math.PI * 2;
      targets.push(target);
      group.add(target);
    }
    onChange();
  }

  function clear() {
    targets.length = 0;
    group.clear();
    for (const beam of beams) { beam.life = 0; beam.line.visible = false; }
    dirty = true;
    waveDelay = 0;
  }

  return {
    enter() { clear(); active = true; group.visible = true; lastShot = -Infinity; spawnWave(); },
    leave() { active = false; group.visible = false; clear(); },
    shoot(raycaster, now) {
      if (!active || now - lastShot < 300) return;
      lastShot = now;
      group.updateMatrixWorld(true);
      hits.length = 0;
      const hit = raycaster.intersectObjects(targets, false, hits)[0];
      if (hit) end.copy(hit.point);
      else raycaster.ray.at(24, end);
      if (hit) {
        group.remove(hit.object);
        targets.splice(targets.indexOf(hit.object), 1);
        state.score++;
        if (!targets.length) waveDelay = 1.2;
        onChange();
      }
      raycaster.ray.at(0.8, start);
      start.y -= 0.15;
      const beam = beams.find((candidate) => candidate.life <= 0) ?? createBeam();
      const position = beam.line.geometry.attributes.position;
      position.setXYZ(0, start.x, start.y, start.z);
      position.setXYZ(1, end.x, end.y, end.z);
      position.needsUpdate = true;
      beam.line.visible = true;
      beam.line.material.opacity = 1;
      beam.life = 0.14;
    },
    update(dt, elapsed, reducedMotion) {
      let changed = dirty || active;
      dirty = false;
      if (active) {
        for (const target of targets) {
          target.position.copy(target.userData.origin);
          if (!reducedMotion) {
            target.position.y += Math.sin(elapsed * 0.6 + target.userData.phase) * 0.25;
            target.rotation.y += dt * 0.35;
          }
        }
        if (waveDelay > 0) {
          waveDelay -= dt;
          if (waveDelay <= 0) spawnWave();
        }
      }
      for (const beam of beams) {
        if (beam.life <= 0) continue;
        changed = true;
        beam.life -= dt;
        beam.line.material.opacity = Math.max(0, beam.life / 0.14);
        if (beam.life <= 0) beam.line.visible = false;
      }
      return changed;
    },
    dispose() {
      clear();
      for (const beam of beams) {
        scene.remove(beam.line);
        beam.line.geometry.dispose();
        beam.line.material.dispose();
      }
      geometry.dispose();
      material.dispose();
    },
  };
}
