const g = window.__game;
window.__ivHold = true;
window.__ivTest = true;
g.Game.freeLook = true;
g.Game.captureBlocked = false;
g.Input.locked = true;
g.Settings.showFps = false;

const results = {};
const runtimeErrors = [];
const oldError = console.error;
const oldWarn = console.warn;
console.error = (...args) => { const message = args.map(String).join(' '); runtimeErrors.push(message); oldError(...args); if (!results.summary) output.textContent = 'CONSOLE ERROR: ' + message; };
console.warn = (...args) => { runtimeErrors.push('WARN ' + args.map(String).join(' ')); oldWarn(...args); };

const output = document.createElement('pre');
output.id = 'regressionResults';
output.style.cssText = 'position:fixed;inset:0;z-index:9999;overflow:auto;background:rgba(3,7,11,.97);color:#bde;font:13px/1.45 monospace;padding:24px;white-space:pre-wrap';
output.textContent = 'WAITING FOR IRONVEIL BOOT';
document.body.appendChild(output);
addEventListener('error', (event) => { if (!results.summary) output.textContent = 'PAGE ERROR: ' + event.message; });

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const endInput = () => g.Input.endFrame();
const rect = (el) => {
  const r = (typeof el === 'string' ? document.getElementById(el) : el).getBoundingClientRect();
  return { left: +r.left.toFixed(1), top: +r.top.toFixed(1), right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1), width: +r.width.toFixed(1), height: +r.height.toFixed(1) };
};
const insideViewport = (r) => r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
const sendPointer = (el, type, pointerId, clientX, clientY) => el.dispatchEvent(new PointerEvent(type, { pointerId, pointerType: 'touch', clientX, clientY, bubbles: true, cancelable: true, isPrimary: pointerId === 1 }));
const reset = (map = 'depot') => {
  g.Game.freeLook = true;
  g.Game.captureBlocked = false;
  g.Input.locked = true;
  g.buildMap(map);
  g.Game.start();
  g.Game.inter = 999;
  g.Enemies.clear();
  g.Game.queue = [];
};
const test = (name, fn) => {
  try {
    const detail = fn();
    results[name] = { pass: true, ...detail };
  } catch (error) {
    results[name] = { pass: false, error: error.stack || String(error) };
  }
};

function run() {
  test('settings_validation', () => {
    const s = g.validatedSettings({ quality: 'broken', difficulty: 'impossible', sens: 99, adsSens: -2, fov: NaN, rain: 'yes', map: 'unknown' });
    assert(s.quality === 'high' && s.difficulty === 'normal', 'enum fallback failed');
    assert(s.sens === 3 && s.adsSens === 0.3 && s.fov === 92, 'numeric validation failed');
    assert(s.rain === true && s.map === 'depot', 'boolean/map fallback failed');
    const r = g.validatedRecords({ score: -5, wave: 2.9, maps: { depot: { score: 400, wave: -2 }, bad: null } });
    assert(r.score === 0 && r.wave === 2 && r.maps.depot.score === 400 && r.maps.depot.wave === 0, 'record validation failed');
    return { sanitized: s, records: r };
  });

  test('wave_last_spawn_and_single_reward', () => {
    reset();
    g.Game.wave = 1;
    g.Game.waveActive = true;
    g.Game.queue = ['trooper'];
    g.Game.spawnT = 0;
    g.Game.update(1 / 60);
    assert(g.Game.waveActive && g.Enemies.alive() === 1, 'wave cleared with a living final spawn');
    const enemy = g.Enemies.list[0];
    enemy.spawnT = 0;
    enemy.root.scale.setScalar(1);
    enemy.updateHits();
    enemy.damage(10000, enemy.center(), null, 'body');
    g.Game.update(1 / 60);
    assert(!g.Game.waveActive && g.Enemies.alive() === 0, 'wave did not clear after the last enemy died');
    const score = g.Game.score;
    const credits = g.Game.credits;
    g.Game.waveClear();
    assert(g.Game.score === score && g.Game.credits === credits, 'wave-clear reward was granted twice');
    return { score, credits, alive: g.Enemies.alive(), waveActive: g.Game.waveActive };
  });

  test('dead_enemy_cannot_act', () => {
    reset();
    const enemy = g.Enemies.spawn('trooper', g.Player.pos.clone().add({ x: 0, y: 0, z: -5 }));
    enemy.spawnT = 0;
    enemy.root.scale.setScalar(1);
    enemy.updateHits();
    enemy.losT = 999;
    enemy.los = true;
    enemy.aimT = 1;
    enemy.burst = 1;
    enemy.burstT = 0;
    enemy.fireCD = 999;
    enemy.stagger = 0;
    enemy.damage(10000, enemy.center(), null, 'body');
    const before = g.Projectiles.list.length;
    g.Enemies.update(1 / 60);
    assert(g.Projectiles.list.length === before, 'destroyed enemy acted after shattering');
    return { projectilesBefore: before, projectilesAfter: g.Projectiles.list.length };
  });

  test('debris_release_after_last_piece', () => {
    reset();
    const enemy = g.Enemies.spawn('trooper', g.Player.pos.clone().add({ x: 0, y: 0, z: -5 }));
    enemy.spawnT = 0;
    enemy.root.scale.setScalar(1);
    enemy.updateHits();
    enemy.damage(10000, enemy.center(), null, 'body');
    assert(enemy.pieces > 0 && !enemy.disposed, 'enemy disposed while debris was still alive');
    g.Debris.clear();
    assert(enemy.disposed, 'enemy was not disposed with its last debris piece');
    return { pieces: enemy.pieces, disposed: enemy.disposed };
  });

  test('lock_overlay_main_menu', () => {
    reset();
    const touchActive = g.TouchUI.active;
    g.TouchUI.setActive(false);
    g.Game.freeLook = false;
    g.Input.locked = false;
    g.handleLockFailure('blocked');
    assert(g.Game.captureBlocked && !document.getElementById('clickResume').classList.contains('hidden'), 'lock recovery UI missing');
    document.getElementById('btnLockMenu').click();
    assert(g.Game.state === 'menu', 'lock overlay main menu button failed');
    g.TouchUI.setActive(touchActive);
    return { returnedToMenu: true };
  });

  test('radar_visibility_rules', () => {
    reset();
    const enemy = g.Enemies.spawn('trooper', g.Player.pos.clone().add({ x: 0, y: 0, z: -30 }));
    enemy.los = false;
    enemy.revealT = 0;
    assert(!g.HUD.radarVisible(enemy), 'distant hidden enemy appeared on radar');
    enemy.pos.copy(g.Player.pos).add({ x: 0, y: 0, z: -10 });
    assert(g.HUD.radarVisible(enemy), 'nearby audible enemy missing from radar');
    enemy.pos.copy(g.Player.pos).add({ x: 0, y: 0, z: -30 });
    enemy.revealT = 7;
    assert(g.HUD.radarVisible(enemy), 'pulse scan did not reveal distant enemy');
    return { hidden: false, nearby: true, scanned: true };
  });

  test('barrels_redeploy_restore', () => {
    reset();
    const before = g.Barrels.list.filter(b => !b.dead).length;
    g.Barrels.damage(g.Barrels.list[0], 1000);
    g.Barrels.update(2);
    assert(g.Barrels.list.filter(b => !b.dead).length === before - 1, 'barrel did not explode');
    g.Game.start();
    const after = g.Barrels.list.filter(b => !b.dead).length;
    const colliders = g.Barrels.list.filter(b => g.World.colliders.includes(b.col)).length;
    assert(after === before && colliders === before, 'barrels or colliders were not restored');
    return { before, after, colliders };
  });

  test('pointer_lock_failure_freezes_combat', () => {
    reset();
    const touchActive = g.TouchUI.active;
    g.TouchUI.setActive(false);
    g.Game.freeLook = false;
    g.Input.locked = false;
    g.handleLockFailure();
    assert(g.Game.captureBlocked, 'capture failure did not block simulation');
    assert(Math.abs(g.camera.position.y - (g.Player.pos.y + g.Player.eyeHeight())) < 1e-6 && g.camera.position.z === g.Player.pos.z, 'capture-blocked camera did not align with the player spawn');
    const time = g.Game.time;
    const health = g.Player.health;
    const wave = g.Game.wave;
    g.frame(0.05, 20, 0.05);
    assert(g.Game.time === time && g.Player.health === health && g.Game.wave === wave, 'gameplay advanced while mouse capture was blocked');
    assert(!document.getElementById('clickResume').classList.contains('hidden'), 'capture recovery UI is hidden');
    g.Game.freeLook = true;
    g.Game.setCaptureBlocked(false);
    g.frame(0.05, 1, 0.05);
    assert(g.Game.time > time, 'simulation did not resume after capture recovery');
    g.TouchUI.setActive(touchActive);
    return { frozenTime: time, resumedTime: g.Game.time };
  });

  test('pause_and_resume', () => {
    reset();
    const previousTestFlag = window.__ivTest;
    try {
      window.__ivTest = false;
      g.Game.pause();
      assert(g.Game.state === 'paused', 'pause failed');
      const time = g.Game.time;
      g.frame(0.05, 4, 0.05);
      assert(g.Game.time === time, 'game time advanced while paused');
      g.Game.resume();
      assert(g.Game.state === 'playing', 'resume failed');
      return { pause: true, resume: true };
    } finally {
      window.__ivTest = previousTestFlag;
    }
  });

  test('movement_jump_crouch', () => {
    reset();
    const z = g.Player.pos.z;
    g.Input.keys.KeyW = true;
    for (let i = 0; i < 60; i++) { g.Player.update(1 / 60); endInput(); }
    g.Input.keys.KeyW = false;
    const walk = z - g.Player.pos.z;
    reset();
    const z2 = g.Player.pos.z;
    g.Input.keys.KeyW = g.Input.keys.ShiftLeft = true;
    for (let i = 0; i < 60; i++) { g.Player.update(1 / 60); endInput(); }
    g.Input.keys.KeyW = g.Input.keys.ShiftLeft = false;
    const sprint = z2 - g.Player.pos.z;
    reset();
    g.Input.pressed.Space = true;
    g.Player.update(1 / 60);
    endInput();
    for (let i = 0; i < 10; i++) { g.Player.update(1 / 60); endInput(); }
    const jumpY = g.Player.pos.y;
    reset();
    g.Input.keys.KeyC = true;
    for (let i = 0; i < 40; i++) { g.Player.update(1 / 60); endInput(); }
    g.Input.keys.KeyC = false;
    assert(walk > 4 && sprint > walk && jumpY > 0.5 && g.Player.h < 1.2, 'movement regression');
    return { walkDistance: +walk.toFixed(2), sprintDistance: +sprint.toFixed(2), jumpY: +jumpY.toFixed(2), crouchHeight: +g.Player.h.toFixed(2) };
  });

  test('all_weapons_fire', () => {
    reset();
    const rows = [];
    for (let i = 0; i < 6; i++) {
      g.Weapons.owned[i] = true;
      g.Weapons.equip(i, true);
      g.Weapons.cd = 0;
      g.Weapons.raise = 1;
      const before = g.Weapons.ammo[i];
      g.Input.lmb = g.Input.lmbHit = true;
      g.Weapons.update(1 / 60);
      endInput();
      rows.push({ id: g.Weapons.def().id, before, after: g.Weapons.ammo[i] });
      assert(g.Weapons.ammo[i] === before - 1, `${g.Weapons.def().id} did not fire`);
    }
    g.Input.lmb = false;
    assert(g.Game.stats.shots === 6, 'shot statistics are incorrect');
    return { rows, shots: g.Game.stats.shots };
  });

  test('reload_and_scope', () => {
    reset();
    g.Weapons.cd = 0;
    g.Weapons.raise = 1;
    g.Input.lmb = true;
    g.Weapons.update(1 / 60);
    g.Input.lmb = false;
    endInput();
    g.Weapons.startReload();
    for (let i = 0; i < 130; i++) { g.Weapons.update(1 / 60); endInput(); }
    assert(g.Weapons.ammo[0] === 30 && g.Weapons.res[0] === 209 && !g.Weapons.reloading, 'rifle reload failed');
    g.Weapons.equip(2, true);
    g.Weapons.raise = 1;
    g.Input.rmb = true;
    for (let i = 0; i < 30; i++) { g.Weapons.update(1 / 60); endInput(); }
    assert(g.Weapons.scoped, 'scope did not engage');
    g.Input.rmb = false;
    for (let i = 0; i < 30; i++) { g.Weapons.update(1 / 60); endInput(); }
    assert(!g.Weapons.scoped, 'scope did not disengage');
    return { ammo: 30, reserve: 209, scopeCycle: true };
  });

  test('armory_no_free_or_useless_purchase', () => {
    reset();
    g.Player.pos.copy(g.Armory.pos);
    g.Input.pressed.KeyE = true;
    g.Armory.update(1 / 60);
    endInput();
    assert(g.Armory.open, 'armory did not open');
    g.Game.credits = 1000;
    g.Armory.buy(2);
    assert(g.Player.armor === 100 && g.Game.credits === 500, 'armor purchase failed');
    g.Weapons.addAmmo(1);
    g.Game.credits = 1000;
    const reserves = JSON.stringify(g.Weapons.res);
    g.Armory.buy(3);
    assert(g.Game.credits === 1000 && reserves === JSON.stringify(g.Weapons.res), 'full resupply charged for no benefit');
    return { armor: g.Player.armor, credits: g.Game.credits, reservesUnchanged: true };
  });

  test('full_pickup_is_not_consumed', () => {
    reset();
    g.Player.armor = 100;
    g.Pickups.spawn('armor', g.Player.pos);
    g.Pickups.update(1 / 60);
    assert(g.Pickups.list.length === 1 && g.Player.armor === 100, 'full armor pickup was consumed');
    g.Player.armor = 50;
    g.Pickups.update(1 / 60);
    assert(g.Pickups.list.length === 0 && g.Player.armor === 85, 'needed armor pickup was not collected');
    return { fullPickupRetained: true, collectedAt50: 85 };
  });

  test('melee_respects_world_occlusion', () => {
    reset();
    g.Player.update(0.001);
    const wall = g.World.collider(1, 0, 33, 3, 3, 33.05, { surf: 'concrete' });
    const enemy = g.Enemies.spawn('trooper', g.Player.pos.clone().add({ x: 0, y: 0, z: -2 }));
    enemy.spawnT = 0;
    enemy.root.scale.setScalar(1);
    enemy.updateHits();
    const hp = enemy.hp;
    g.Weapons.melee();
    assert(enemy.hp === hp, 'melee passed through a solid wall');
    g.World.colliders.splice(g.World.colliders.indexOf(wall), 1);
    g.Weapons.melee();
    assert(enemy.hp < hp, 'melee failed after the wall was removed');
    return { blockedDamage: 0, unblockedDamage: hp - enemy.hp };
  });

  test('boss_stomp_respects_height', () => {
    reset();
    g.Player.pos.y = 3;
    g.Player.onGround = true;
    const boss = g.Enemies.spawn('boss', g.Player.pos.clone().set(2, 0, 32));
    boss.spawnT = 0;
    boss.root.scale.setScalar(1);
    boss.updateHits();
    boss.stomp = 0.2;
    boss.stompHit = false;
    const hp = g.Player.health;
    boss.update(0.01);
    assert(g.Player.health === hp, 'boss stomp hit through an invalid height difference');
    g.Player.pos.y = 0;
    boss.stomp = 0.2;
    boss.stompHit = false;
    boss.update(0.01);
    assert(g.Player.health < hp, 'boss stomp failed at ground level');
    return { elevatedDamage: 0, groundDamage: hp - g.Player.health };
  });

  test('barrel_chain_respects_occlusion', () => {
    reset();
    const barrel = g.Barrels.list[0];
    const source = g.Player.pos.clone().set(barrel.x, 0.6, barrel.z + 2);
    const wall = g.World.collider(barrel.x - 2, 0, barrel.z + 0.9, barrel.x + 2, 3, barrel.z + 1.1, { surf: 'concrete' });
    g.Barrels.radiusDamage(source, 5);
    assert(barrel.burn === 0, 'barrel ignited through a solid wall');
    g.World.colliders.splice(g.World.colliders.indexOf(wall), 1);
    g.Barrels.radiusDamage(source, 5);
    assert(barrel.burn > 0, 'barrel did not ignite with clear line of sight');
    return { blockedBurn: 0, visibleBurn: barrel.burn };
  });

  test('launcher_swept_thin_wall_collision', () => {
    reset();
    g.World.collider(1, 0, 33, 3, 3, 33.05, { surf: 'concrete' });
    const p = g.Player.pos.clone().set(2, 1, 33.8);
    const v = p.clone().set(0, 0, -36);
    g.Grenades.launch(p, v);
    g.Grenades.list[0].dist = 3;
    const hits = [];
    const original = g.FX.explosion;
    try {
      g.FX.explosion = (point, scale) => { hits.push(point.toArray()); original.call(g.FX, point, scale); };
      g.Grenades.update(0.05);
    } finally {
      g.FX.explosion = original;
    }
    assert(hits.length === 1, 'launcher round did not detonate on the wall');
    assert(hits[0][2] >= 33 && hits[0][2] <= 33.1, `launcher round tunneled through the wall: ${hits[0]}`);
    assert(g.Grenades.list.length === 0, 'detonated round was not removed');
    return { impact: hits[0], remaining: g.Grenades.list.length };
  });

  test('objective_complete_and_contest', () => {
    reset();
    g.Objective.start();
    g.Player.pos.copy(g.Objective.pos);
    for (let i = 0; i < 900; i++) g.Objective.update(1 / 60);
    assert(!g.Objective.active && g.Game.score === 1000 && g.Game.credits === 1500 && g.Player.armor === 100, 'objective completion failed');
    reset();
    g.Objective.start();
    g.Player.pos.copy(g.Objective.pos);
    const enemy = g.Enemies.spawn('trooper', g.Objective.pos.clone());
    enemy.spawnT = 0;
    g.Objective.update(1);
    assert(g.Objective.contested && g.Objective.progress === 0, 'contested objective progressed incorrectly');
    return { completionRewards: true, contestedProgress: 0 };
  });

  test('sentry_deploy_and_kill', () => {
    reset();
    g.Sentry.charges = 1;
    g.Sentry.deploy();
    assert(g.Sentry.list.length === 1, 'sentry did not deploy');
    const enemy = g.Enemies.spawn('trooper', g.Player.pos.clone().add({ x: 0, y: 0, z: -6 }));
    enemy.spawnT = 0;
    enemy.root.scale.setScalar(1);
    enemy.updateHits();
    for (let i = 0; i < 70; i++) g.Sentry.update(0.05);
    assert(!enemy.alive && g.Game.stats.kills === 1 && g.Game.credits > 0, 'sentry did not kill and credit correctly');
    return { enemyAlive: enemy.alive, kills: g.Game.stats.kills, credits: g.Game.credits };
  });

  test('boss_phase_two', () => {
    reset();
    const boss = g.Enemies.spawn('boss', g.Player.pos.clone().add({ x: 0, y: 0, z: -18 }));
    boss.spawnT = 0;
    boss.root.scale.setScalar(1);
    boss.updateHits();
    boss.hp = boss.maxHp * 0.49;
    boss.update(1 / 60);
    const seekers = g.Enemies.list.filter(e => e.type === 'seeker').length;
    assert(boss.phase2 && seekers === 3, 'boss phase-two transition failed');
    return { phase2: boss.phase2, seekers };
  });

  test('map_builds', () => {
    const rows = [];
    for (const id of Object.keys(g.MAPS)) {
      reset(id);
      g.Player.update(1 / 60);
      g.Game.update(1 / 60);
      assert(g.World.colliders.length > 50 && g.World.spawns.length >= 7, `${id} failed to build correctly`);
      rows.push({ id, colliders: g.World.colliders.length, spawns: g.World.spawns.length, barrels: g.Barrels.list.length, weather: g.ENV.weather });
    }
    return { rows };
  });

  test('map_geometry_stability', () => {
    const counts = [];
    for (let i = 0; i < 5; i++) {
      reset('depot');
      g.warmShaders();
      g.frame(1 / 60, 1);
      counts.push(g.renderer.info.memory.geometries);
    }
    const stable = counts.slice(1);
    assert(Math.max(...stable) === Math.min(...stable), `geometry count kept growing: ${counts}`);
    return { counts };
  });

  test('entity_geometry_stability', () => {
    reset();
    const cycle = () => {
      g.Sentry.charges = 1;
      g.Sentry.deploy();
      g.Objective.start();
      g.warmShaders();
      g.frame(1 / 60, 1);
      g.Sentry.reset();
      g.Objective.reset();
      g.frame(1 / 60, 1);
    };
    cycle();
    cycle();
    const counts = [];
    for (let i = 0; i < 4; i++) { cycle(); counts.push(g.renderer.info.memory.geometries); }
    assert(Math.max(...counts) === Math.min(...counts), `entity geometry count kept growing: ${counts}`);
    return { counts };
  });

  test('fps_uses_real_elapsed_time', () => {
    reset();
    g.Settings.showFps = true;
    g.frame(0.05, 3, 0.2);
    const text = document.getElementById('fps').textContent;
    g.Settings.showFps = false;
    assert(text.startsWith('5 FPS'), `FPS used simulation dt instead of real elapsed time: ${text}`);
    return { text };
  });

  test('map_cards_keyboard_access', () => {
    g.Game.toMenu();
    document.getElementById('btnDeploy').click();
    const cards = [...document.querySelectorAll('#cards .card')];
    assert(cards.length === 3 && cards.every(c => c.getAttribute('role') === 'button' && c.tabIndex === 0), 'map cards are not keyboard accessible');
    const original = g.Game.deploy;
    let selected = '';
    try {
      g.Game.deploy = async id => { selected = id; };
      cards[0].dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true, cancelable: true }));
    } finally {
      g.Game.deploy = original;
    }
    assert(selected === 'depot', 'Enter did not activate the focused map card');
    return { cards: cards.length, keyboardSelection: selected };
  });

  test('touch_joystick_moves_player', () => {
    reset();
    g.TouchUI.setActive(true);
    const base = document.getElementById('stickBase');
    const zone = document.getElementById('stickZone');
    const r = base.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    sendPointer(zone, 'pointerdown', 11, x, y);
    sendPointer(zone, 'pointermove', 11, x + 30, y - 40);
    assert(g.Input.touchS > 0 && g.Input.touchF > 0, 'joystick did not produce analog movement');
    const z = g.Player.pos.z;
    for (let i = 0; i < 30; i++) { g.Player.update(1 / 60); endInput(); }
    assert(g.Player.pos.z < z, 'player did not move from joystick input');
    sendPointer(zone, 'pointerup', 11, x + 30, y - 40);
    assert(g.Input.touchF === 0 && g.Input.touchS === 0, 'joystick did not reset on release');
    return { forward: 0.833, strafe: 0.625, moved: +(z - g.Player.pos.z).toFixed(2) };
  });

  test('touch_multitouch_look_and_fire', () => {
    reset();
    g.TouchUI.setActive(true);
    g.Weapons.cd = 0;
    g.Weapons.raise = 1;
    const fire = document.getElementById('touchFire');
    const look = document.getElementById('touchLook');
    sendPointer(fire, 'pointerdown', 21, 0, 0);
    sendPointer(look, 'pointerdown', 22, 500, 200);
    sendPointer(look, 'pointermove', 22, 540, 180);
    g.Weapons.update(1 / 60);
    const yaw = g.Player.yaw;
    g.Player.update(1 / 60);
    assert(g.Weapons.ammo[0] === 29 && g.Input.lmb, 'fire did not remain held during look');
    assert(g.Player.yaw !== yaw, 'touch look did not rotate the player');
    sendPointer(fire, 'pointerup', 21, 0, 0);
    sendPointer(look, 'pointerup', 22, 540, 180);
    assert(!g.Input.lmb, 'fire remained held after release');
    return { ammo: 29, simultaneous: true };
  });

  test('touch_action_buttons', () => {
    reset();
    g.TouchUI.setActive(true);
    sendPointer(document.getElementById('touchScan'), 'pointerdown', 31, 0, 0);
    g.Systems.update(1 / 60);
    assert(g.Pulse.cd > 0, 'touch scan failed');
    g.Weapons.ammo[0] = 29;
    sendPointer(document.getElementById('touchReload'), 'pointerdown', 32, 0, 0);
    g.Weapons.update(1 / 60);
    assert(g.Weapons.reloading, 'touch reload failed');
    sendPointer(document.getElementById('touchWeapon'), 'pointerdown', 33, 0, 0);
    assert(g.Weapons.switching > 0, 'touch weapon switch failed');
    const previous = window.__ivTest;
    try {
      window.__ivTest = false;
      sendPointer(document.getElementById('touchPause'), 'pointerdown', 34, 0, 0);
      assert(g.Game.state === 'paused', 'touch pause failed');
    } finally { window.__ivTest = previous; }
    return { scan: true, reload: true, switch: true, pause: true };
  });

  test('touch_armory_purchase_and_close', () => {
    reset();
    g.TouchUI.setActive(true);
    g.Player.pos.copy(g.Armory.pos);
    g.Game.credits = 1000;
    g.Armory.open = true;
    g.HUD.armory(true);
    g.TouchUI.update();
    assert(document.getElementById('touchControls').classList.contains('hidden'), 'touch controls still cover the armory');
    assert(getComputedStyle(document.getElementById('armory')).pointerEvents === 'auto', 'armory is not touch interactive');
    const rows = [...document.getElementById('arList').children];
    rows[2].click();
    assert(g.Player.armor === 100 && g.Game.credits === 500, 'touch armory purchase failed');
    document.getElementById('armoryTouchClose').click();
    assert(!g.Armory.open, 'touch armory close failed');
    return { armor: 100, credits: 500, closed: true };
  });

  test('touch_controls_inside_viewport', () => {
    reset();
    g.TouchUI.setActive(true);
    g.TouchUI.update();
    const ids = ['stickBase', 'touchFire', 'touchAds', 'touchJump', 'touchCrouch', 'touchSprint', 'touchWeapon', 'touchPause'];
    const boxes = Object.fromEntries(ids.map(id => [id, rect(id)]));
    assert(ids.every(id => insideViewport(boxes[id])), `touch controls outside viewport: ${JSON.stringify(boxes)}`);
    if (innerWidth < innerHeight) {
      const vitals = rect('vitals'), weapon = rect('weapon');
      assert(vitals.right <= weapon.left || vitals.bottom <= weapon.top || weapon.right <= vitals.left || weapon.bottom <= vitals.top, 'portrait vitals and weapon HUD overlap');
    }
    g.Game.toMenu();
    assert(document.getElementById('touchControls').classList.contains('hidden'), 'touch controls remained visible in the main menu');
    return { viewport: [innerWidth, innerHeight], boxes, hiddenInMenu: true };
  });

  test('landscape_hud_bounds', () => {
    reset();
    const ids = ['minimap', 'vitals', 'weapon', 'topCenter', 'scoreBox'];
    const boxes = Object.fromEntries(ids.map(id => [id, rect(id)]));
    assert(ids.every(id => insideViewport(boxes[id])), `HUD outside viewport: ${JSON.stringify(boxes)}`);
    return { viewport: [innerWidth, innerHeight], boxes };
  });

  test('landscape_armory_bounds', () => {
    reset();
    g.Player.pos.copy(g.Armory.pos);
    g.Armory.open = true;
    g.HUD.armory(true);
    const box = rect('armory');
    g.HUD.armory(false);
    assert(insideViewport(box), `armory outside viewport: ${JSON.stringify(box)}`);
    return { viewport: [innerWidth, innerHeight], box };
  });

  test('landscape_map_select_bounds', () => {
    g.Game.toMenu();
    document.getElementById('btnDeploy').click();
    const boxes = { heading: rect(document.querySelector('#mapSelect h2')), back: rect('btnMapBack') };
    if (innerWidth > innerHeight) assert(insideViewport(boxes.heading) && insideViewport(boxes.back), `map select clipped: ${JSON.stringify(boxes)}`);
    else {
      assert(insideViewport(boxes.heading), 'portrait map heading is clipped');
      if (!insideViewport(boxes.back)) { document.getElementById('btnMapBack').scrollIntoView(); boxes.back = rect('btnMapBack'); }
      assert(insideViewport(boxes.back), 'portrait back button is not reachable by scrolling');
    }
    return { viewport: [innerWidth, innerHeight], boxes };
  });

  results.runtimeErrors = runtimeErrors.slice();
  const tests = Object.entries(results).filter(([name]) => name !== 'runtimeErrors');
  const failed = tests.filter(([, result]) => !result.pass).map(([name]) => name);
  results.summary = { total: tests.length, passed: tests.length - failed.length, failed };
  output.textContent = JSON.stringify(results, null, 2);
  document.title = failed.length ? 'IRONVEIL TESTS FAILED' : 'IRONVEIL TESTS PASSED';
}

const waitForBoot = () => {
  if (g.Game.state === 'menu') run();
  else setTimeout(waitForBoot, 100);
};
waitForBoot();
