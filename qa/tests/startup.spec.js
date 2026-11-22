// Opt-in (QA_STARTUP=1): first casts of a freshly launched browser, where the AudioContext clock
// can stall, and casts during a deliberate audio-clock stall (PulseAudio sink suspended from
// outside the page). Each case launches its own browser so its AudioContext is the first one.
//
//   QA_STARTUP_OFFSETS  release offsets from the peak for the first cast, ms (default "0"), or
//                       "audio": hold until the game's audio-clock elapsed time reaches the peak,
//                       i.e. the latest release the audio measure alone would still call a Peak
//   QA_SUSPEND_MS       if set, suspend the sink this long during cast 3 instead (needs pactl)
//   QA_STARTUP_REPS     repetitions of every offset (default 1)
const { test, expect, chromium } = require('@playwright/test');
const { execSync } = require('child_process');
const { TOLERANCE_MS, CPU_RATE, sleep, openGame, applyCpuThrottle, analyseCasts, writeResult, audioSinkInfo, audioClockStats } = require('../lib/harness');
const { snapshot, cardCenter, extNow } = require('../lib/bot');

const OFFSETS = (process.env.QA_STARTUP_OFFSETS || '0').split(',').map((v) => (v === 'audio' ? v : Number(v)));
const REPS = Number(process.env.QA_STARTUP_REPS || 1);
const SUSPEND_MS = Number(process.env.QA_SUSPEND_MS || 0);
const ARGS = ['--autoplay-policy=no-user-gesture-required', ...(process.env.QA_CHROMIUM_ARGS || '').split(' ').filter(Boolean)];
const pactl = (cmd) => { try { execSync(`pactl ${cmd}`, { stdio: 'ignore', timeout: 5000 }); return true; } catch (_) { return false; } };

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
  return { index: c.index, aimMs: offsetMs, offPeak: offsetMs === 'audio' || Math.abs(offsetMs) > c.windowMs, released, misfired: !released && stun > 0, pressSend, pressAck, relSend, relAck };
}

test(`fresh-browser start-up / audio-stall casts under ${CPU_RATE}x CPU throttle`, async () => {
  test.skip(!process.env.QA_STARTUP, 'opt-in: set QA_STARTUP=1');
  const cases = [];
  for (let rep = 0; rep < REPS; rep++) {
    for (const offsetMs of OFFSETS) {
      const browser = await chromium.launch({ args: ARGS });
      const page = await (await browser.newContext({ viewport: { width: 480, height: 1800 } })).newPage();
      await openGame(page);
      const throttle = await applyCpuThrottle(page);
      const ext = [];
      const plan = SUSPEND_MS > 0 ? [0, 0, offsetMs] : [offsetMs, 0, 0];
      for (let i = 0; i < plan.length; i++) {
        const stalled = SUSPEND_MS > 0 && i === 2;
        const e = await castOnce(page, plan[i], stalled ? async () => {
          pactl('suspend-sink @DEFAULT_SINK@ 1');
          await sleep(SUSPEND_MS);
          pactl('suspend-sink @DEFAULT_SINK@ 0');
        } : null);
        if (e) ext.push({ ...e, castNo: i + 1, stalled });
        await sleep(400);
      }
      const audioSink = audioSinkInfo();
      const casts = await page.evaluate(() => window.__qa.casts);
      const rows = analyseCasts(casts, TOLERANCE_MS, ext).rows.map((r) => {
        const e = ext.find((x) => x.index === r.index) || {};
        // Time the AudioContext clock lost against the page clock during the hold.
        return { ...r, castNo: e.castNo, stalled: e.stalled, audioClockLostMs: r.audioElapsedMs == null ? null : r.handlerElapsedMs - r.audioElapsedMs };
      });
      cases.push({ offsetMs, rep, suspendMs: SUSPEND_MS, throttle, audioSink, audioClock: await audioClockStats(page), unreleased: ext.filter((e) => !e.released), rows });
      await browser.close();
    }
  }
  writeResult(`startup${SUSPEND_MS > 0 ? '-suspend' : ''}.json`, { cpuRate: CPU_RATE, toleranceMs: TOLERANCE_MS, cases });
  const all = cases.flatMap((c) => c.rows);
  expect.soft(all.length, 'casts measured').toBeGreaterThan(0);
  expect.soft(all.filter((r) => r.extMismatch).length, `Peak/miss verdicts that contradict the outside-the-page clock by more than ${TOLERANCE_MS}ms`).toBe(0);
});
