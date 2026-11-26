// VM-4: automated 18-wave stress + CPU-throttled QA for sound_alchemist.html
//
//   1. Runs the in-game 10-run / 18-wave balance simulator repeatedly under CPU throttling.
//   2. Plays the real game with real mouse/keyboard input through all 3 Act Bosses under CPU
//      throttling, and checks that Peak registration matches real input timing within ±5ms.
//   3. Checks for horizontal overflow at a 480px viewport throughout.
//
// The checks are not tuned to pass: results are written to qa/results/ either way.
const { test, expect } = require('@playwright/test');
const { TOLERANCE_MS, CPU_RATE, sleep, openGame, applyCpuThrottle, checkOverflow, analyseCasts, writeResult, audioSinkInfo, audioClockStats, HTTP, gameUrl, pageErrors, assetStatus, analyseMp3 } = require('../lib/harness');
const { castOnce } = require('../lib/bot');
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
  const expectUnblurred = async selector => {
    const modal = page.locator(selector);
    await expect(modal).toBeVisible();
    await expect(modal).toHaveCSS('backdrop-filter', 'none');
    await expect(page.locator(`${selector} > .glass-panel`)).toHaveCSS('backdrop-filter', 'none');
  };

  const iterations = [];
  for (let i = 0; i < SIM_ITERATIONS; i++) {
    const t = Date.now();
    await page.locator(i === 0 ? '#btnOpenSim' : '#btnRerunSim').click();
    await expect(page.locator('#simTableBody tr')).toHaveCount(10);
    const runs = await readSim();
    iterations.push({ iteration: i + 1, clickToResultMs: Date.now() - t, fullClears: runs.filter((r) => r.cleared).length, runs });
    if (i === 0) {
      await expectUnblurred('#simModal');
      overflow.push(await checkOverflow(page, 'simulator modal'));
    }
    await sleep(400);
  }
  overflow.push(await checkOverflow(page, 'simulator modal (after reruns)'));
  await page.locator('#btnCloseSim').click();

  for (const [modal, open, close, label] of [
    ['#shopModal', '#btnOpenShop', '#btnCloseShop', 'shop modal'],
    ['#codexModal', '#btnOpenCodex', '#btnCloseCodex', 'codex modal'],
    ['#guideModal', '#btnOpenGuide', '#btnCloseGuide', 'guide modal'],
  ]) {
    await page.locator(open).click();
    await expectUnblurred(modal);
    await sleep(300);
    overflow.push(await checkOverflow(page, label));
    await page.locator(close).click();
  }

  const result = { throttle, iterations, overflow, frames: await frameStats(page), gameUrl: await gameUrl(), assets: await assetStatus(page), pageErrors: pageErrors(page) };
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
  expect.soft(pageErrors(page), 'no page errors, console errors or failed requests').toEqual([]);
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
  const audioSink = audioSinkInfo(); // while the page is still producing audio
  await sleep(1500);

  const casts = await page.evaluate(() => window.__qa.casts);
  const analysis = analyseCasts(casts, TOLERANCE_MS, attempts.flatMap((a) => a.ext));
  const result = {
    throttle,
    toleranceMs: TOLERANCE_MS,
    bossesDefeated: [...defeated].sort(),
    attempts: attempts.map(({ overflow: _o, ext: _e, ...rest }) => rest),
    peak: { all: analysis.all, bossWaves: analysis.bossWaves },
    overflow,
    frames: await frameStats(page),
    gameUrl: await gameUrl(),
    assets: await assetStatus(page),
    mp3: analyseMp3(await page.evaluate(() => window.__qa.ops), await page.evaluate(() => window.__qa.mp3Unattributed)),
    pageErrors: pageErrors(page),
    audioSink,
    audioClock: await audioClockStats(page),
    castsStarted: await page.evaluate(() => window.__qa.castsStarted),
    casts: analysis.rows,
  };
  writeResult('boss-playthrough.json', result);

  expect.soft(throttle.measuredSlowdown, 'CPU throttle must actually be in effect').toBeGreaterThan(CPU_RATE > 1 ? 1.2 : 0);
  expect.soft(result.bossesDefeated, 'all 3 Act Bosses played through and defeated').toEqual([1, 2, 3]);
  expect.soft(analysis.all.casts, 'enough charged casts to judge accuracy').toBeGreaterThanOrEqual(30);
  expect.soft(analysis.all.maxAbsErrorMs, `worst Peak registration error (judged vs real input time) must be within ±${TOLERANCE_MS}ms`).toBeLessThanOrEqual(TOLERANCE_MS);
  expect.soft(analysis.all.verdictMismatches, `Peak/miss verdicts that contradict real input timing by more than ${TOLERANCE_MS}ms`).toBe(0);
  // Independent of the page: verdicts against Node's clock around each input command.
  expect.soft(analysis.all.extMismatches, `Peak/miss verdicts that contradict the outside-the-page clock by more than ${TOLERANCE_MS}ms`).toBe(0);
  for (const o of overflow) expect.soft(o, `no horizontal overflow at 480px: ${o.label}`).toMatchObject({ ok: true });
  expect.soft(pageErrors(page), 'no page errors, console errors or failed requests').toEqual([]);
  if (HTTP) {
    expect.soft(result.assets, 'the idle batch finishes during the campaign over http').toMatchObject({ status: 'ready', fetched: 40, decoded: 40 });
    expect.soft(result.mp3.violations, 'MP3 sources per sound: Peak release 1, off-Peak 0, overload 0, instant card 1, relic 1').toEqual({ peakReleaseNot1: 0, offPeakReleaseNot0: 0, overloadNot0: 0, instantCardNot1: 0, relicNot1: 0, unattributed: 0 });
  }
});

// Sounds the campaign bot rarely or never triggers: overload misfires (held past the deadline, and
// released just past it), codex previews of every card and relic, and a shop relic purchase.
test(`MP3 path over http under ${CPU_RATE}x CPU throttle: overloads, codex previews, relics`, async ({ page }) => {
  test.skip(!HTTP, 'needs QA_HTTP=1 (assets are not fetched on file://)');
  await openGame(page);
  const throttle = await applyCpuThrottle(page);
  const steps = [];
  // Nothing here parries, so the player can die mid-test: restart through the game's own button.
  const revive = async () => {
    if (await page.evaluate(() => state.gameOver)) { await page.locator('#btnRestartGame').click(); await sleep(500); }
  };
  // Test set-up only (not an input under test): a new game, so the player survives while a modal is open.
  const freshGame = async () => { await revive(); await page.evaluate(() => restartFullGame()); await sleep(300); };
  // The first cast is the gesture that starts downloading and decoding.
  steps.push(await castOnce(page, 0));
  const assetsAfterFirstCast = await assetStatus(page);
  await page.waitForFunction(() => window.__qa.assetStatus().decoded === 40, null, { timeout: 60000 });
  const previews = {};
  for (const [key, filter, sel] of [['cards', 'all', '.btn-preview-card'], ['relics', 'relics', '.btn-preview-relic']]) {
    await freshGame();
    await page.locator('#btnOpenCodex').click();
    await page.locator(`.codex-tab[data-filter="${filter}"]`).click();
    const n = (previews[key] = await page.locator(sel).count());
    for (let i = 0; i < n; i++) { await page.locator(sel).nth(i).click(); await sleep(60); }
    await sleep(key === 'cards' ? 3500 : 300); // let the scheduled preview hits start
    await page.locator('#btnCloseCodex').click();
  }
  await freshGame();
  await page.evaluate(() => { state.gold = Math.max(state.gold, 400); }); // test set-up only: afford the relic box
  await page.locator('#btnOpenShop').click();
  const relicsBefore = await page.evaluate(() => state.ownedRelics.length);
  await page.locator('#btnBuyRelicShop').click();
  await sleep(300);
  const relicsBought = (await page.evaluate(() => state.ownedRelics.length)) - relicsBefore;
  await page.locator('#btnCloseShop').click();
  for (const aim of [0, 'overload-hold', 0, 'overload-release', 'overload-hold', -400, 'overload-release', 0, 'overload-hold', 'overload-release']) {
    await revive();
    steps.push(await castOnce(page, aim));
    await sleep(1300); // past the 1s overload stun
  }

  const ops = await page.evaluate(() => window.__qa.ops);
  const result = {
    throttle, gameUrl: await gameUrl(), assetsAfterFirstCast, assets: await assetStatus(page), previews, relicsBought,
    steps: steps.filter(Boolean).map(({ index, card, aimMs, released, misfired }) => ({ index, card, aimMs, released, misfired })),
    mp3: analyseMp3(ops, await page.evaluate(() => window.__qa.mp3Unattributed)),
    codex: {
      relicPreviews: ops.filter((o) => o.type === 'relic').map((o) => ({ id: o.card, assetReady: o.assetReady, mp3: o.mp3.length })),
      cardPreviews: ops.filter((o) => (o.type === 'cardHitSound' || o.type === 'instantSound') && !o.parent).map((o) => ({ id: o.card, type: o.type, assetReady: o.assetReady, mp3: o.mp3.length })),
    },
    audioSink: audioSinkInfo(),
    pageErrors: pageErrors(page),
    ops,
  };
  writeResult('mp3-path.json', result);
  expect.soft(result.assets, 'all MP3 assets fetched and decoded over http').toMatchObject({ status: 'ready', fetched: 40, decoded: 40 });
  expect.soft(result.mp3.violations, 'MP3 sources per sound: Peak release 1, off-Peak 0, overload 0, instant card 1, relic 1').toEqual({ peakReleaseNot1: 0, offPeakReleaseNot0: 0, overloadNot0: 0, instantCardNot1: 0, relicNot1: 0, unattributed: 0 });
  expect.soft(result.mp3.overload.count, 'overload misfires exercised').toBeGreaterThan(0);
  expect.soft(previews, 'codex lists every card and relic').toEqual({ cards: 30, relics: 10 });
  expect.soft(result.codex.cardPreviews.filter((p) => p.assetReady && p.mp3 !== 1), 'codex card previews start exactly one MP3').toEqual([]);
  expect.soft(pageErrors(page), 'no page errors, console errors or failed requests').toEqual([]);
});
