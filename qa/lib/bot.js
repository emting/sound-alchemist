// Real-input bot: reads game state, but every action goes through Playwright mouse/keyboard
// events, so casts are timed and judged exactly like a player's.
const { sleep, checkOverflow } = require('./harness');

const PARRY_KEY = { metal: 'q', crystal: 'w', energy: 'e' };

const snapshot = (page) => page.evaluate(() => {
  const visible = (id) => { const m = document.getElementById(id); return !!m && !m.classList.contains('hidden'); };
  const cast = state.activeCast;
  return {
    act: state.act,
    wave: state.wave,
    hp: state.hp,
    mana: state.mana,
    stun: state.stunRemaining,
    selectedLane: state.selectedLane,
    gameOver: state.gameOver,
    victory: state.gameOver && state.hp > 0 && state.act === 3 && state.wave === state.maxWaves && state.enemies.length === 0,
    rewardOpen: visible('rewardModal'),
    hand: state.hand.map((c, i) => ({ i, id: c.id, cost: getEffectiveCardCost(c), charge: getEffectiveCardCharge(c), dmg: c.baseDmg || 0 })),
    enemies: state.enemies.map((e) => ({ lane: e.lane, x: e.x, hp: e.hp, isBoss: !!e.isBoss, telegraphing: !!e.telegraphing, weakness: e.weakness })),
    cast: cast && cast.__qa ? { index: cast.__qa.index, sinceStartMs: performance.now() - cast.__qa.t0, peakMs: cast.peakTime * 1000, windowMs: cast.windowSec * 1000 } : null,
  };
});

async function parry(page, s) {
  const kinds = [...new Set(s.enemies.filter((e) => e.telegraphing).map((e) => e.weakness))];
  for (const k of kinds) if (PARRY_KEY[k]) await page.keyboard.press(PARRY_KEY[k]);
  return kinds.length;
}

async function cardCenter(page, index) {
  const box = await page.locator('#handContainer > *').nth(index).boundingBox();
  return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;
}

// On main the reward choices are re-rendered every frame while the modal is open, so a normal
// click (which waits for a stable element) never lands. Click by coordinates instead and fall
// back to the static "skip" button if the choice still does not register.
async function pickReward(page, log) {
  const open = () => page.evaluate(() => !document.getElementById('rewardModal').classList.contains('hidden'));
  for (let attempt = 0; attempt < 4; attempt++) {
    const box = await page.locator('#rewardChoicesContainer').boundingBox();
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height - 40);
    await sleep(120);
    const confirm = page.locator('#btnConfirmReward');
    if (await confirm.isEnabled().catch(() => false)) await confirm.click();
    await sleep(150);
    if (!(await open())) { log.rewardsTaken += 1; return; }
    log.rewardClickRetries += 1;
  }
  await page.locator('#btnSkipReward').click();
  log.rewardsSkipped += 1;
}

// Aim offsets relative to the peak, as a fraction of the Peak window. Mostly dead-centre, with
// some releases well inside and a few just inside the window edge.
const AIM_PATTERN = [0, 0.45, 0, -0.45, 0, 0.9, 0, -0.9];

// Deliberately off-peak releases (opt-in, QA_OFFPEAK_EVERY=N makes every Nth charged cast one):
// ms beyond the edge of the Peak window, negative = early, positive = late.
const OFFPEAK_EVERY = Number(process.env.QA_OFFPEAK_EVERY || 0);
const OFFPEAK_MARGINS = [-30, 30, -80, 80, -200, 200, -15, 15];

// Clock outside the page (Node, monotonic). Each input is bracketed by the time its CDP
// command was sent and the time the browser acknowledged it.
const extNow = () => Number(process.hrtime.bigint()) / 1e6;

/**
 * Plays from the current state until victory (ACT 3 boss dead), defeat, or the time budget.
 * Returns a log of waves reached, bosses defeated and overflow checks taken along the way.
 */
async function playRun(page, { budgetMs, onBossWave } = {}) {
  const started = Date.now();
  const log = { bossesDefeated: [], bossesReached: [], wavesCleared: 0, rewardModalsSeen: 0, parries: 0, endTurns: 0, castsStarted: 0, rewardsTaken: 0, rewardsSkipped: 0, rewardClickRetries: 0, overflow: [], ext: [], offPeakAimed: 0, outcome: 'timeout' };
  let offPeakNo = 0;
  let castNo = 0;
  let lead = 0; // running estimate of input latency, so aimed releases land where intended
  let lastWaveKey = '';
  let bossActive = 0;

  while (Date.now() - started < budgetMs) {
    const s = await snapshot(page);
    log.wavesCleared = (s.act - 1) * 6 + s.wave - 1 + (s.victory || s.rewardOpen ? 1 : 0);
    const waveKey = `${s.act}-${s.wave}`;
    if (waveKey !== lastWaveKey && !s.rewardOpen) {
      lastWaveKey = waveKey;
      const isBoss = s.enemies.some((e) => e.isBoss);
      bossActive = isBoss ? s.act : 0;
      if (isBoss) {
        log.bossesReached.push(s.act);
        log.overflow.push(await checkOverflow(page, `ACT ${s.act} boss fight`));
        if (onBossWave) await onBossWave(s.act);
      }
    }

    if (s.gameOver) {
      if (s.victory && bossActive) log.bossesDefeated.push(bossActive);
      log.outcome = s.victory ? 'victory' : 'defeat';
      log.endedAt = { act: s.act, wave: s.wave };
      log.overflow.push(await checkOverflow(page, `game over modal (${log.outcome})`));
      break;
    }

    if (s.rewardOpen) {
      if (bossActive) { log.bossesDefeated.push(bossActive); bossActive = 0; }
      log.rewardModalsSeen += 1;
      if (log.rewardModalsSeen === 1 || s.wave === 6) log.overflow.push(await checkOverflow(page, `reward modal after ACT ${s.act} wave ${s.wave}`));
      await pickReward(page, log);
      continue;
    }

    log.parries += await parry(page, s);
    if (s.stun > 0 || s.enemies.length === 0) { await sleep(60); continue; }

    const affordable = s.hand.filter((c) => c.cost <= s.mana);
    if (affordable.length === 0) {
      await page.keyboard.press('r');
      log.endTurns += 1;
      continue;
    }
    const card = affordable.sort((a, b) => b.dmg - a.dmg || a.charge - b.charge)[0];

    const target = s.enemies.find((e) => e.isBoss) || [...s.enemies].sort((a, b) => a.x - b.x)[0];
    if (target.lane !== s.selectedLane) await page.keyboard.press(String(target.lane + 1));

    const pos = await cardCenter(page, card.i);
    if (!pos) continue;
    await page.mouse.move(pos.x, pos.y);
    const pressSend = extNow();
    await page.mouse.down();
    const pressAck = extNow();
    const hold = card.charge > 0 && castNo % 2 === 1; // alternate tap + Space with hold + release
    if (!hold) await page.mouse.up();
    if (card.charge <= 0) continue;

    const c = (await snapshot(page)).cast;
    if (!c) { if (hold) await page.mouse.up(); continue; }
    log.castsStarted += 1;
    let aimMs = AIM_PATTERN[castNo % AIM_PATTERN.length] * c.windowMs;
    castNo += 1;
    let offPeak = false;
    if (OFFPEAK_EVERY > 0 && castNo % OFFPEAK_EVERY === 0) {
      let m = OFFPEAK_MARGINS[offPeakNo % OFFPEAK_MARGINS.length];
      offPeakNo += 1;
      // A late release must still land before the overload deadline (charge + 0.85 x window).
      const lateRoom = card.charge * 1000 + 0.85 * c.windowMs - c.peakMs - c.windowMs - 60;
      if (m > 0 && m > lateRoom) m = -m;
      if (c.peakMs - c.windowMs + m > 120) {
        aimMs = m > 0 ? c.windowMs + m : -c.windowMs + m;
        offPeak = true;
        log.offPeakAimed += 1;
      }
    }

    let remaining = c.peakMs + aimMs - c.sinceStartMs - lead;
    if (remaining > 500) {
      const t = Date.now();
      await sleep(remaining - 350);
      log.parries += await parry(page, await snapshot(page));
      remaining -= Date.now() - t;
    }
    const c2 = (await snapshot(page)).cast;
    if (c2) remaining = c2.peakMs + aimMs - c2.sinceStartMs - lead;
    await sleep(remaining);
    const relSend = extNow();
    if (hold) await page.mouse.up(); else await page.keyboard.down('Space');
    const relAck = extNow();
    if (!hold) await page.keyboard.up('Space');

    let last = await page.evaluate(() => { const a = window.__qa.casts; return a[a.length - 1] || null; });
    if (last && c.index !== undefined && last.index !== c.index) last = null; // ended without this release (e.g. overload misfire)
    log.ext.push({ index: c.index, aimMs, offPeak, released: !!last, pressSend, pressAck, relSend, relAck });
    if (last) {
      const aimError = last.trueElapsedMs - last.peakTimeMs - aimMs;
      if (Math.abs(aimError) < 150) lead = Math.max(0, Math.min(150, lead + aimError * 0.5));
    }
  }
  log.durationMs = Date.now() - started;
  return log;
}

// One charged cast released `offsetMs` from its peak, timed on the outside clock only.
async function castOnce(page, offsetMs, during) {
  let s = await snapshot(page);
  for (let i = 0; i < 100 && (s.stun > 0 || !s.hand.some((c) => c.charge >= 0.5 && c.cost <= s.mana)); i++) {
    if (s.stun <= 0) await page.keyboard.press('r');
    await sleep(150);
    s = await snapshot(page);
  }
  const card = s.hand.filter((c) => c.charge >= 0.5 && c.cost <= s.mana).sort((a, b) => a.charge - b.charge)[0];
  if (!card) return null;
  const pos = await cardCenter(page, card.i);
  await page.mouse.move(pos.x, pos.y);
  const pressSend = extNow();
  await page.mouse.down();
  const pressAck = extNow();
  await page.mouse.up();
  const c = (await snapshot(page)).cast;
  if (!c) return null;
  if (during) await during();
  const deadlineMs = card.charge * 1000 + 0.85 * c.windowMs; // overload deadline, from the press
  if (offsetMs === 'overload-hold') {
    // Never released: the game's own loop must fire the overload misfire.
    await sleep(deadlineMs + 700 - (extNow() - pressSend));
    const s2 = await snapshot(page);
    return { index: c.index, card: card.id, aimMs: offsetMs, offPeak: true, released: false, misfired: !s2.cast, pressSend, pressAck, relSend: null, relAck: null };
  }
  if (offsetMs === 'overload-release') offsetMs = deadlineMs - c.peakMs + 25; // released just past the deadline
  if (offsetMs === 'audio') {
    // Reads the game's own audio-clock elapsed time (the getter the cast UI uses every frame).
    const audioElapsed = () => page.evaluate(() => (state.activeCast ? state.activeCast.elapsed * 1000 : null));
    for (let e = await audioElapsed(); e !== null && e < c.peakMs - 25 && extNow() - pressSend < c.peakMs + 4000; e = await audioElapsed()) await sleep(Math.min(40, Math.max(1, c.peakMs - 25 - e)));
  } else {
    await sleep(c.peakMs + offsetMs - (extNow() - pressSend));
  }
  const relSend = extNow();
  await page.keyboard.down('Space');
  const relAck = extNow();
  await page.keyboard.up('Space');
  const last = await page.evaluate(() => { const a = window.__qa.casts; return a[a.length - 1] || null; });
  const released = !!last && last.index === c.index;
  const stun = (await snapshot(page)).stun;
  return { index: c.index, card: card.id, aimMs: offsetMs, offPeak: offsetMs === 'audio' || Math.abs(offsetMs) > c.windowMs, released, misfired: !released && stun > 0, pressSend, pressAck, relSend, relAck };
}

module.exports = { playRun, snapshot, cardCenter, extNow, castOnce };
