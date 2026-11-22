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
  out.push('');
}
console.log(out.length ? out.join('\n') : 'No results found. Run `npm test` first.');
