// VM-4: automated 18-wave stress + CPU-throttled QA for sound_alchemist.html
//
//   1. Runs the in-game 10-run / 18-wave balance simulator repeatedly under CPU throttling.
//   2. Plays the real game with real mouse/keyboard input through all 3 Act Bosses under CPU
//      throttling, and checks that Peak registration matches real input timing within ±5ms.
//   3. Checks for horizontal overflow at a 480px viewport throughout.
//
// The checks are not tuned to pass: results are written to qa/results/ either way.
const { test, expect } = require('@playwright/test');
const { GAME_URL, TOLERANCE_MS, CPU_RATE, sleep, openGame, applyCpuThrottle, checkOverflow, analyseCasts, writeResult } = require('../lib/harness');
const { playRun } = require('../lib/bot');

const SIM_ITERATIONS = Number(process.env.QA_SIM_ITERATIONS || 10);
const PLAY_BUDGET_MS = Number(process.env.QA_PLAY_BUDGET_MIN || 30) * 60 * 1000;
const MAX_ATTEMPTS = Number(process.env.QA_MAX_ATTEMPTS || 6);

const frameStats = (page) => page.evaluate(() => {
  const f = window.__qa.frames;
  return { ...f, avgMs: f.count ? Math.round((f.sumMs / f.count) * 100) / 100 : null, maxMs: Math.round(f.maxMs * 100) / 100 };
});

test.describe.configure({ mode: 'serial' });

test(`10-run / 18-wave simulator under ${CPU_RATE}x CPU throttle at 480px`, async ({ page }) => {
  await openGame(page);
  const throttle = await applyCpuThrottle(page);
  const overflow = [await checkOverflow(page, 'battle screen (idle)')];

  const readSim = () => page.evaluate(() => [...document.querySelectorAll('#simTableBody tr')].map((tr) => {
    const cells = [...tr.children].map((td) => td.textContent.trim());
    const m = cells[1].match(/(\d+)\s*\/\s*(\d+)/);
    return { label: cells[0], waves: m ? Number(m[1]) : null, of: m ? Number(m[2]) : null, cleared: cells[1].includes('三幕全破') };
  }));

  const iterations = [];
  for (let i = 0; i < SIM_ITERATIONS; i++) {
    const t = Date.now();
    await page.locator(i === 0 ? '#btnOpenSim' : '#btnRerunSim').click();
    await expect(page.locator('#simTableBody tr')).toHaveCount(10);
    const runs = await readSim();
    iterations.push({ iteration: i + 1, clickToResultMs: Date.now() - t, fullClears: runs.filter((r) => r.cleared).length, runs });
    if (i === 0) overflow.push(await checkOverflow(page, 'simulator modal'));
    await sleep(400);
  }
  overflow.push(await checkOverflow(page, 'simulator modal (after reruns)'));
  await page.locator('#btnCloseSim').click();

  for (const [open, close, label] of [['#btnOpenShop', '#btnCloseShop', 'shop modal'], ['#btnOpenCodex', '#btnCloseCodex', 'codex modal'], ['#btnOpenGuide', '#btnCloseGuide', 'guide modal']]) {
    await page.locator(open).click();
    await sleep(300);
    overflow.push(await checkOverflow(page, label));
    await page.locator(close).click();
  }

  const result = { throttle, iterations, overflow, frames: await frameStats(page) };
  writeResult('simulator.json', result);

  expect.soft(throttle.measuredSlowdown, 'CPU throttle must actually be in effect').toBeGreaterThan(CPU_RATE > 1 ? 1.2 : 0);
  for (const it of iterations) {
    expect.soft(it.runs.length, `iteration ${it.iteration}: 10 simulated runs`).toBe(10);
    for (const r of it.runs) {
      expect.soft(r.of, `${r.label}: run is an 18-wave campaign`).toBe(18);
      expect.soft(r.waves >= 1 && r.waves <= 18, `${r.label}: waves cleared in range (${r.waves})`).toBe(true);
    }
  }
  for (const o of overflow) expect.soft(o, `no horizontal overflow at 480px: ${o.label}`).toMatchObject({ ok: true });
});

test(`3 Act Bosses under ${CPU_RATE}x CPU throttle: Peak registration within ±${TOLERANCE_MS}ms, no overflow at 480px`, async ({ page }) => {
  await openGame(page);
  const throttle = await applyCpuThrottle(page);
  const overflow = [await checkOverflow(page, 'battle screen (start)')];

  // Full 18-wave campaign from wave 1. If the bot loses, it restarts through the game's own
  // restart button and tries again until every Act Boss has been beaten or the budget runs out.
  const attempts = [];
  const defeated = new Set();
  const deadline = Date.now() + PLAY_BUDGET_MS;
  while (attempts.length < MAX_ATTEMPTS && Date.now() < deadline && defeated.size < 3) {
    const log = await playRun(page, { budgetMs: deadline - Date.now() });
    attempts.push(log);
    log.bossesDefeated.forEach((a) => defeated.add(a));
    overflow.push(...log.overflow);
    if (log.outcome === 'timeout' || defeated.size === 3) break;
    await sleep(1500);
    await page.locator('#btnRestartGame').click();
  }
  await sleep(1500);

  const casts = await page.evaluate(() => window.__qa.casts);
  const analysis = analyseCasts(casts);
  const result = {
    throttle,
    toleranceMs: TOLERANCE_MS,
    bossesDefeated: [...defeated].sort(),
    attempts: attempts.map(({ overflow: _o, ...rest }) => rest),
    peak: { all: analysis.all, bossWaves: analysis.bossWaves },
    overflow,
    frames: await frameStats(page),
    gameUrl: GAME_URL,
    castsStarted: await page.evaluate(() => window.__qa.castsStarted),
    casts: analysis.rows,
  };
  writeResult('boss-playthrough.json', result);

  expect.soft(throttle.measuredSlowdown, 'CPU throttle must actually be in effect').toBeGreaterThan(CPU_RATE > 1 ? 1.2 : 0);
  expect.soft(result.bossesDefeated, 'all 3 Act Bosses played through and defeated').toEqual([1, 2, 3]);
  expect.soft(analysis.all.casts, 'enough charged casts to judge accuracy').toBeGreaterThanOrEqual(30);
  expect.soft(analysis.all.maxAbsErrorMs, `worst Peak registration error (judged vs real input time) must be within ±${TOLERANCE_MS}ms`).toBeLessThanOrEqual(TOLERANCE_MS);
  expect.soft(analysis.all.verdictMismatches, `Peak/miss verdicts that contradict real input timing by more than ${TOLERANCE_MS}ms`).toBe(0);
  for (const o of overflow) expect.soft(o, `no horizontal overflow at 480px: ${o.label}`).toMatchObject({ ok: true });
});
