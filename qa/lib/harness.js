const fs = require('fs');
const path = require('path');
const instrument = require('./instrument');

const GAME_URL = 'file://' + path.resolve(__dirname, '..', '..', 'sound_alchemist.html');
const RESULTS_DIR = path.resolve(__dirname, '..', 'results');
const TOLERANCE_MS = 5;
const CPU_RATE = Number(process.env.QA_CPU_RATE || 4);

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

async function openGame(page) {
  await page.addInitScript(instrument, { toleranceMs: TOLERANCE_MS });
  await page.goto(GAME_URL);
  await page.waitForFunction(() => window.__qa && window.__qa.hooked && window.tailwind && typeof state === 'object' && state.hand.length > 0);
  await page.evaluate(() => document.fonts.ready);
  const hookError = await page.evaluate(() => window.__qa.hookError || null);
  if (hookError) throw new Error(hookError);
}

// Fixed JS workload, used to prove the CDP throttle is really applied.
const cpuBench = (page) => page.evaluate(() => {
  const run = () => {
    const t = performance.now();
    let x = 0;
    for (let i = 0; i < 4e6; i++) x += Math.sqrt(i) % 7;
    return performance.now() - t;
  };
  for (let i = 0; i < 4; i++) run(); // warm up the JIT so both measurements run the same code
  let total = 0;
  for (let i = 0; i < 10; i++) total += run(); // total, not min: the throttle works by pausing the thread in slices
  return total;
});

async function applyCpuThrottle(page, rate = CPU_RATE) {
  const baselineMs = await cpuBench(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  const throttledMs = await cpuBench(page);
  await page.evaluate((r) => { window.__qa.cpuRate = r; window.__qa.renderHud(); }, rate);
  return { rate, baselineMs, throttledMs, measuredSlowdown: throttledMs / baselineMs };
}

// Horizontal overflow at the current viewport: the document must not scroll sideways and no
// visible element may stick out past the viewport edge (unless an ancestor clips/scrolls it).
function checkOverflow(page, label) {
  return page.evaluate((lbl) => {
    const report = (res) => {
      window.__qa.setOverflow(`overflow @${res.viewportWidth}px [${lbl}]: scrollWidth ${res.scrollWidth} ${res.ok ? 'OK' : 'FAIL'}`);
      return res;
    };
    const vw = document.documentElement.clientWidth;
    const clipped = (el) => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox !== 'visible') {
          const r = p.getBoundingClientRect();
          if (r.left >= -0.5 && r.right <= vw + 0.5) return true;
        }
      }
      return false;
    };
    const offenders = [];
    for (const el of document.body.querySelectorAll('*')) {
      if (el.id === 'qaHud') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right <= vw + 0.5 && r.left >= -0.5) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (clipped(el)) continue;
      offenders.push({
        el: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className ? '.' + el.className.split(/\s+/).slice(0, 3).join('.') : ''),
        left: Math.round(r.left * 10) / 10,
        right: Math.round(r.right * 10) / 10,
      });
      if (offenders.length >= 10) break;
    }
    return report({
      label: lbl,
      viewportWidth: vw,
      innerWidth: window.innerWidth,
      scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      offenders,
      ok: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) <= vw && offenders.length === 0,
    });
  }, label);
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

// Peak registration accuracy. "True" elapsed is the time between the input event that started
// the charge and the input event that released it (Event.timeStamp); "judged" elapsed is what
// the game compared against the peak. A cast is a verdict mismatch when the true timing was
// clearly (more than the tolerance) inside or outside the Peak window but the game ruled otherwise.
function analyseCasts(casts, toleranceMs = TOLERANCE_MS) {
  const rows = casts.map((c) => {
    const errorMs = c.judgedElapsedMs - c.trueElapsedMs;
    const trueOffsetMs = c.trueElapsedMs - c.peakTimeMs;
    const margin = c.windowMs - Math.abs(trueOffsetMs); // >0: truly inside the window
    const truePeak = margin >= 0;
    return {
      ...c,
      errorMs,
      trueOffsetMs,
      judgedOffsetMs: c.judgedElapsedMs - c.peakTimeMs,
      audioErrorMs: c.audioElapsedMs === null ? null : c.judgedElapsedMs - c.audioElapsedMs,
      truePeak,
      verdictMismatch: truePeak !== c.judgedPeak && Math.abs(margin) > toleranceMs,
    };
  });
  const stats = (subset) => {
    const abs = subset.map((r) => Math.abs(r.errorMs)).sort((a, b) => a - b);
    const signed = subset.map((r) => r.errorMs);
    const round = (v) => (v === null ? null : Math.round(v * 100) / 100);
    return {
      casts: subset.length,
      withinTolerance: subset.filter((r) => Math.abs(r.errorMs) <= toleranceMs).length,
      meanSignedErrorMs: round(signed.length ? signed.reduce((a, b) => a + b, 0) / signed.length : null),
      p50AbsErrorMs: round(percentile(abs, 50)),
      p95AbsErrorMs: round(percentile(abs, 95)),
      maxAbsErrorMs: round(abs.length ? abs[abs.length - 1] : null),
      truePeakReleases: subset.filter((r) => r.truePeak).length,
      judgedPeakReleases: subset.filter((r) => r.judgedPeak).length,
      verdictMismatches: subset.filter((r) => r.verdictMismatch).length,
    };
  };
  return { toleranceMs, rows, all: stats(rows), bossWaves: stats(rows.filter((r) => r.bossWave)) };
}

function writeResult(name, data) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const file = path.join(RESULTS_DIR, name);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

module.exports = { GAME_URL, RESULTS_DIR, TOLERANCE_MS, CPU_RATE, sleep, openGame, applyCpuThrottle, checkOverflow, analyseCasts, writeResult };
