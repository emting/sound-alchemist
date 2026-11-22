// Prints a Markdown summary of qa/results/*.json (run after `npm test`).
const fs = require('fs');
const path = require('path');
const { RESULTS_DIR } = require('./harness');

const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, f), 'utf8')); } catch (_) { return null; } };
const sim = read('simulator.json');
const boss = read('boss-playthrough.json');
const out = [];
const overflowLine = (list) => {
  const bad = list.filter((o) => !o.ok);
  return bad.length ? `FAIL: ${bad.map((o) => `${o.label} (scrollWidth ${o.scrollWidth})`).join('; ')}` : `PASS (${list.length} checkpoints, scrollWidth ${Math.max(...list.map((o) => o.scrollWidth))}px)`;
};
const frames = (f) => `${f.count} frames, avg ${f.avgMs}ms, max ${f.maxMs}ms, ${f.over100} over 100ms`;

if (sim) {
  out.push('## 10-run / 18-wave simulator', '');
  out.push(`- CPU throttle: ${sim.throttle.rate}x requested, ${sim.throttle.measuredSlowdown.toFixed(2)}x measured`);
  out.push(`- Simulator executions: ${sim.iterations.length} (10 runs x 18 waves each), click-to-result ${Math.min(...sim.iterations.map((i) => i.clickToResultMs))}-${Math.max(...sim.iterations.map((i) => i.clickToResultMs))}ms`);
  out.push(`- Full clears per execution: ${sim.iterations.map((i) => `${i.fullClears}/10`).join(', ')}`);
  out.push(`- Horizontal overflow at 480px: ${overflowLine(sim.overflow)}`);
  out.push(`- Frames: ${frames(sim.frames)}`, '');
}
if (boss) {
  const p = boss.peak;
  out.push('## 3 Act Bosses playthrough', '');
  out.push(`- CPU throttle: ${boss.throttle.rate}x requested, ${boss.throttle.measuredSlowdown.toFixed(2)}x measured`);
  out.push(`- Bosses defeated: ${boss.bossesDefeated.length ? boss.bossesDefeated.map((a) => `ACT ${a}`).join(', ') : 'none'} (${boss.attempts.length} attempt(s): ${boss.attempts.map((a) => `${a.outcome} after ${a.wavesCleared} waves, ${Math.round(a.durationMs / 1000)}s`).join('; ')})`);
  out.push(`- Horizontal overflow at 480px: ${overflowLine(boss.overflow)}`);
  out.push(`- Frames: ${frames(boss.frames)}`, '');
  out.push(`| Peak registration (tolerance ±${boss.toleranceMs}ms) | All waves | Boss waves |`, '|---|---|---|');
  const row = (label, k, unit = '') => out.push(`| ${label} | ${p.all[k]}${unit} | ${p.bossWaves[k]}${unit} |`);
  row('Charged casts measured', 'casts');
  row(`Casts within ±${boss.toleranceMs}ms`, 'withinTolerance');
  row('Mean signed error (judged - real)', 'meanSignedErrorMs', 'ms');
  row('Median abs error', 'p50AbsErrorMs', 'ms');
  row('p95 abs error', 'p95AbsErrorMs', 'ms');
  row('Max abs error', 'maxAbsErrorMs', 'ms');
  row('Releases truly inside the Peak window', 'truePeakReleases');
  row('Releases the game registered as Peak', 'judgedPeakReleases');
  row('Wrong Peak/miss verdicts', 'verdictMismatches');
  row('Median signed error', 'medianSignedErrorMs', 'ms');
  row('p95 deviation from median error (diagnostic)', 'p95DeviationFromMedianMs', 'ms');
  if (p.all.medianStartOffsetMs !== null && p.all.medianStartOffsetMs !== undefined) {
    row('Designed cast-start offset, median (diagnostic)', 'medianStartOffsetMs', 'ms');
    row('p95 abs error after removing that offset (diagnostic)', 'p95AbsResidualMs', 'ms');
    row('Max abs error after removing that offset (diagnostic)', 'maxAbsResidualMs', 'ms');
  }
  if (p.all.extCasts) {
    out.push('', '| Outside-the-page reference (Node clock around each input command) | All waves | Boss waves |', '|---|---|---|');
    row('Casts with a reference', 'extCasts');
    row('Clearly on the peak by the reference', 'extClearlyPeak');
    row('... of those ruled a miss by the game', 'extClearlyPeakRuledMiss');
    row('Clearly off the peak by the reference', 'extClearlyOffPeak');
    row('... of those ruled a Peak by the game', 'extOffPeakRuledPeak');
    row('Widest off-peak release accepted (beyond window edge)', 'extWidestAcceptedOffPeakMs', 'ms');
    row('Too close to the window edge to call', 'extUndecided');
    row('Verdicts contradicting the reference', 'extMismatches');
    row('Point estimate (send-to-send): on the peak', 'extPointPeak');
    row('... of those ruled a miss', 'extPointPeakRuledMiss');
    row('Point estimate: off the peak', 'extPointOffPeak');
    row('... of those ruled a Peak', 'extPointOffPeakRuledPeak');
    row('... widest accepted (beyond window edge)', 'extPointWidestAcceptedOffPeakMs', 'ms');
    row('Point estimate: within 5ms of the window edge', 'extPointUndecided');
    row('Event-timestamp hold minus reference hold, median', 'eventVsExtMedianSignedMs', 'ms');
    row('... p95 abs', 'eventVsExtP95AbsMs', 'ms');
    row('... max abs', 'eventVsExtMaxAbsMs', 'ms');
    row('Reference uncertainty (bracket width), median', 'extBracketWidthP50Ms', 'ms');
    row('... p95', 'extBracketWidthP95Ms', 'ms');
  }
  if (boss.assets) {
    const m = boss.mp3; const g = (x, want) => `${x.mp3StartsHistogramWhenReady[want] || 0} of ${x.assetReady} started exactly ${want}`;
    out.push('', `MP3 assets (${boss.assets.protocol}): ${boss.assets.status}${boss.assets.reason ? ` (${boss.assets.reason})` : ''}, ${boss.assets.decoded}/${boss.assets.fetched} decoded.`);
    if (boss.assets.decoded > 0) {
      out.push(`MP3 sources per sound (asset decoded at the time): Peak release ${g(m.peakRelease, 1)}; off-Peak release ${g(m.offPeakRelease, 0)}; overload ${g(m.overload, 0)}; instant card ${g(m.instantCard, 1)}; relic ${g(m.relic, 1)}; unattributed starts ${m.unattributedMp3Starts}.`);
      if (m.peakStartLateMs) out.push(`Peak-release clip requested this long after the release's audio time: median ${m.peakStartLateMs.median.toFixed(1)}ms, p95 ${m.peakStartLateMs.p95.toFixed(1)}ms, max ${m.peakStartLateMs.max.toFixed(1)}ms; clip skipped to catch up: max ${m.peakCatchUpSkipMs.max.toFixed(1)}ms.`);
    }
    out.push(`Page errors / console errors / failed requests: ${(boss.pageErrors || []).length}.`);
  }
  if (boss.audioClock) {
    const a = boss.audioClock; const f = (v) => (v == null ? 'n/a' : v.toFixed(4));
    out.push('', `AudioContext clock vs performance.now(): overall ${f(a.overallRate)}x (1s samples: min ${f(a.minRate)}x, max ${f(a.maxRate)}x), ${a.sampleRate}Hz, baseLatency ${a.baseLatency == null ? 'n/a' : (a.baseLatency * 1000).toFixed(1)}ms, outputLatency ${a.outputLatency == null ? 'n/a' : (a.outputLatency * 1000).toFixed(1)}ms.`);
  }
  if (boss.audioSink) {
    const k = boss.audioSink;
    out.push(`Audio output: ${k.label || 'unlabelled'}; extra Chromium flags: ${k.chromiumArgs || 'none'}; PulseAudio default sink: ${k.defaultSink || 'n/a'}; browser sink-inputs during run: ${k.sinkInputs ? k.sinkInputs.split('\n').length : 0}.`);
  }
  out.push('', `Judged time read from: ${[...new Set(boss.casts.map((c) => c.judgedSource))].join(', ') || 'n/a'}. Casts started: ${boss.castsStarted ?? 'n/a'}.`);
  out.push('');
}
console.log(out.length ? out.join('\n') : 'No results found. Run `npm test` first.');
