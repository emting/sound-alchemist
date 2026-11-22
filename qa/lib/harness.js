const fs = require('fs');
const path = require('path');
const instrument = require('./instrument');

// QA_GAME_FILE points the harness at another checkout's sound_alchemist.html (e.g. a PR worktree).
const GAME_URL = 'file://' + path.resolve(process.env.QA_GAME_FILE || path.resolve(__dirname, '..', '..', 'sound_alchemist.html'));
const RESULTS_DIR = path.resolve(process.env.QA_RESULTS_DIR || path.resolve(__dirname, '..', 'results'));
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
function analyseCasts(casts, toleranceMs = TOLERANCE_MS, ext = []) {
  const extByIndex = new Map(ext.filter((e) => e.released).map((e) => [e.index, e]));
  const rows = casts.map((c) => {
    const e = extByIndex.get(c.index);
    const x = e ? externalReference(c, e, toleranceMs) : {};
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
      // Error left after removing the build's designed start offset (null when there is none).
      residualMs: c.startOffsetMs == null ? null : errorMs + c.startOffsetMs,
      ...x,
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
      ...residualStats(subset, round),
      ...externalStats(subset, round),
    };
  };
  return { toleranceMs, rows, all: stats(rows), bossWaves: stats(rows.filter((r) => r.bossWave)) };
}

// Reference the game cannot read: Node's clock around each CDP input command. The press happened
// between pressSend and pressAck, the release between relSend and relAck, so the real hold lies in
// [relSend - pressAck, relAck - pressSend]; send-to-send is the point estimate.
function externalReference(c, e, toleranceMs) {
  const extHoldMs = e.relSend - e.pressSend;
  const lo = e.relSend - e.pressAck;
  const hi = e.relAck - e.pressSend;
  const dLo = lo - c.peakTimeMs;
  const dHi = hi - c.peakTimeMs;
  const clearlyInside = Math.max(Math.abs(dLo), Math.abs(dHi)) <= c.windowMs - toleranceMs;
  const clearlyOutside = dLo > c.windowMs + toleranceMs || dHi < -(c.windowMs + toleranceMs);
  const pointIn = Math.abs(extHoldMs - c.peakTimeMs) <= c.windowMs - toleranceMs;
  const pointOut = Math.abs(extHoldMs - c.peakTimeMs) > c.windowMs + toleranceMs;
  // How far outside the window the whole bracket is (0 when it touches the window).
  const outsideByMs = dLo > c.windowMs ? dLo - c.windowMs : dHi < -c.windowMs ? -c.windowMs - dHi : 0;
  return {
    aimMs: e.aimMs,
    offPeakAimed: e.offPeak,
    extHoldMs,
    extHoldLoMs: lo,
    extHoldHiMs: hi,
    extOffsetMs: extHoldMs - c.peakTimeMs,
    eventVsExtMs: c.trueElapsedMs - extHoldMs, // game's event-timestamp hold minus the outside clock's
    extVerdict: clearlyInside ? 'peak' : clearlyOutside ? 'off-peak' : 'undecided',
    extOutsideByMs: outsideByMs,
    extMismatch: (clearlyInside && !c.judgedPeak) || (clearlyOutside && c.judgedPeak),
    // Same test on the send-to-send point estimate (no proof of its error bound; diagnostic).
    extPointVerdict: pointIn ? 'peak' : pointOut ? 'off-peak' : 'undecided',
    extPointOutsideByMs: Math.max(0, Math.abs(extHoldMs - c.peakTimeMs) - c.windowMs),
    extPointMismatch: (pointIn && !c.judgedPeak) || (pointOut && c.judgedPeak),
  };
}

function externalStats(subset, round) {
  const x = subset.filter((r) => r.extVerdict);
  if (!x.length) return {};
  const abs = x.map((r) => Math.abs(r.eventVsExtMs)).sort((a, b) => a - b);
  const signed = x.map((r) => r.eventVsExtMs).sort((a, b) => a - b);
  const width = x.map((r) => r.extHoldHiMs - r.extHoldLoMs).sort((a, b) => a - b);
  const off = x.filter((r) => r.extVerdict === 'off-peak');
  const accepted = off.filter((r) => r.judgedPeak);
  return {
    extCasts: x.length,
    extClearlyPeak: x.filter((r) => r.extVerdict === 'peak').length,
    extClearlyPeakRuledMiss: x.filter((r) => r.extVerdict === 'peak' && !r.judgedPeak).length,
    extClearlyOffPeak: off.length,
    extOffPeakRuledPeak: accepted.length,
    extWidestAcceptedOffPeakMs: round(accepted.length ? Math.max(...accepted.map((r) => r.extOutsideByMs)) : null),
    extUndecided: x.filter((r) => r.extVerdict === 'undecided').length,
    extMismatches: x.filter((r) => r.extMismatch).length,
    extPointPeak: x.filter((r) => r.extPointVerdict === 'peak').length,
    extPointPeakRuledMiss: x.filter((r) => r.extPointVerdict === 'peak' && !r.judgedPeak).length,
    extPointOffPeak: x.filter((r) => r.extPointVerdict === 'off-peak').length,
    extPointOffPeakRuledPeak: x.filter((r) => r.extPointVerdict === 'off-peak' && r.judgedPeak).length,
    extPointWidestAcceptedOffPeakMs: round(Math.max(0, ...x.filter((r) => r.extPointVerdict === 'off-peak' && r.judgedPeak).map((r) => r.extPointOutsideByMs))),
    extPointUndecided: x.filter((r) => r.extPointVerdict === 'undecided').length,
    eventVsExtMedianSignedMs: round(percentile(signed, 50)),
    eventVsExtP50AbsMs: round(percentile(abs, 50)),
    eventVsExtP95AbsMs: round(percentile(abs, 95)),
    eventVsExtMaxAbsMs: round(abs[abs.length - 1]),
    extBracketWidthP50Ms: round(percentile(width, 50)),
    extBracketWidthP95Ms: round(percentile(width, 95)),
  };
}

// Diagnostic only, never asserted on: spread of the error around its median, and the error
// with the designed start offset removed.
function residualStats(subset, round) {
  const signed = subset.map((r) => r.errorMs).sort((a, b) => a - b);
  const med = percentile(signed, 50);
  const dev = signed.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
  const res = subset.filter((r) => r.residualMs !== null).map((r) => Math.abs(r.residualMs)).sort((a, b) => a - b);
  const off = subset.filter((r) => r.startOffsetMs != null).map((r) => r.startOffsetMs).sort((a, b) => a - b);
  return {
    medianSignedErrorMs: round(med),
    p50DeviationFromMedianMs: round(percentile(dev, 50)),
    p95DeviationFromMedianMs: round(percentile(dev, 95)),
    medianStartOffsetMs: round(percentile(off, 50)),
    p50AbsResidualMs: round(percentile(res, 50)),
    p95AbsResidualMs: round(percentile(res, 95)),
    maxAbsResidualMs: round(res.length ? res[res.length - 1] : null),
  };
}

// Where the browser's audio goes during this run (diagnostic; needs PulseAudio's pactl, else null).
function audioSinkInfo() {
  const { execSync } = require('child_process');
  const sh = (cmd) => { try { return execSync(cmd, { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch (_) { return null; } };
  return {
    chromiumArgs: process.env.QA_CHROMIUM_ARGS || '',
    label: process.env.QA_AUDIO_LABEL || '',
    defaultSink: sh('pactl get-default-sink'),
    sinks: sh('pactl list short sinks'),
    sinkInputs: sh('pactl list short sink-inputs'),
  };
}

const audioClockStats = (page) => page.evaluate(() => {
  const a = window.__qa.audioClock;
  const span = a.lastPerf - a.firstPerf;
  return { ...a, overallRate: span > 0 ? (a.lastCtx - a.firstCtx) * 1000 / span : null };
});

function writeResult(name, data) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const file = path.join(RESULTS_DIR, name);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

module.exports = { GAME_URL, RESULTS_DIR, TOLERANCE_MS, CPU_RATE, sleep, openGame, applyCpuThrottle, checkOverflow, analyseCasts, writeResult, audioSinkInfo, audioClockStats };
