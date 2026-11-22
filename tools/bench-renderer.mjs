// Battle-renderer benchmark for sound_alchemist.html (no build step needed).
//   npm i --no-save playwright-core
//   node tools/bench-renderer.mjs [path/to.html] [--dpr=1] [--cpu=1] [--headed] [--chrome=/path/to/chrome] [--json=out.json]
// Drives the page's own global drawGame()/drawAlchemistSpire() so the same script
// can be pointed at any revision of the file.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(path.join(process.cwd(), 'noop.js'));
const { chromium } = require('playwright-core');

const args = process.argv.slice(2);
const opt = (k, d) => (args.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const file = path.resolve(args.find(a => !a.startsWith('--')) || 'sound_alchemist.html');
const dpr = Number(opt('dpr', 1));
const cpu = Number(opt('cpu', 1));
const chromePath = opt('chrome', process.env.CHROME_PATH || undefined);

const stats = xs => {
  const s = [...xs].sort((a, b) => a - b);
  const q = p => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  const r = v => Math.round(v * 1000) / 1000;
  return { n: s.length, mean: r(s.reduce((a, b) => a + b, 0) / s.length), p50: r(q(0.5)), p95: r(q(0.95)), p99: r(q(0.99)), max: r(s[s.length - 1]) };
};

const browser = await chromium.launch({
  headless: !args.includes('--headed'),
  executablePath: chromePath,
  channel: chromePath ? undefined : 'chrome',
  args: ['--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info'],
});
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: dpr })).newPage();
const cdp = await page.context().newCDPSession(page);
await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.click('#battleCanvas');               // user gesture -> audio.init(), analyser goes live
await page.waitForTimeout(1500);
if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });

const out = { file, dpr, cpuThrottle: cpu, userAgent: await page.evaluate(() => navigator.userAgent) };
out.canvas = await page.evaluate(() => ({ w: canvas.width, h: canvas.height, enemies: state.enemies.length, analyser: !!audio.analyser, audioState: audio.ctx && audio.ctx.state }));

// Synchronous batches. performance.now() is coarsened to 0.1 ms on file://, so each
// sample is the mean per-frame time of a batch. flush=true forces rasterization of
// the frame with a 1x1 getImageData; flush=false times JS + canvas command recording only.
const syncBench = (what, flush, batches = 120, per = 25) => page.evaluate(({ what, flush, batches, per }) => {
  const c2d = canvas.getContext('2d');
  const w = canvas.width / devicePixelRatio, h = canvas.height / devicePixelRatio;
  // 'empty' is the fixed overhead (clear + flush) to subtract from 'spire'.
  const one = what === 'empty' ? () => { c2d.clearRect(0, 0, w, h); }
    : what === 'spire' ? () => { c2d.clearRect(0, 0, w, h); drawAlchemistSpire(w, h, performance.now() / 1000); }
    : () => drawGame(1 / 60);
  const samples = [];
  for (let i = 0; i < 50; i++) { one(); if (flush) c2d.getImageData(0, 0, 1, 1); }
  for (let b = 0; b < batches; b++) {
    const t0 = performance.now();
    for (let i = 0; i < per; i++) { one(); if (flush) c2d.getImageData(0, 0, 1, 1); }
    samples.push((performance.now() - t0) / per);
  }
  return samples;
}, { what, flush, batches, per });

out.empty_raster_ms = stats(await syncBench('empty', true));
out.spire_raster_ms = stats(await syncBench('spire', true));
out.spire_record_ms = stats(await syncBench('spire', false));
out.frame_raster_ms = stats(await syncBench('frame', true));
out.frame_record_ms = stats(await syncBench('frame', false));

// JS heap allocated per drawGame() call, attributed by function (V8 sampling heap profiler).
await cdp.send('HeapProfiler.enable');
await cdp.send('HeapProfiler.startSampling', { samplingInterval: 512, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
const FR = 6000;
await page.evaluate(n => { for (let i = 0; i < n; i++) drawGame(1 / 60); }, FR);
const { profile } = await cdp.send('HeapProfiler.stopSampling');
const byFn = {};
(function walk(n) { byFn[n.callFrame.functionName || '(anon)'] = (byFn[n.callFrame.functionName || '(anon)'] || 0) + n.selfSize; n.children.forEach(walk); })(profile.head);
out.alloc_bytes_per_frame = Object.fromEntries(Object.entries(byFn).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => [k, Math.round(v / FR)]));
out.alloc_bytes_per_frame.TOTAL = Math.round(Object.values(byFn).reduce((a, b) => a + b, 0) / FR);

// Live loop: the page's own requestAnimationFrame(gameLoop) for 20 s.
await browser.startTracing(page, { categories: ['v8', 'devtools.timeline', 'disabled-by-default-v8.gc'] });
const live = await page.evaluate(() => new Promise(res => {
  const intervals = [], draw = [];
  const orig = window.drawGame;
  window.drawGame = dt => { const t = performance.now(); orig(dt); draw.push(performance.now() - t); };
  let last = 0; const t0 = performance.now();
  (function tick(now) {
    if (last) intervals.push(now - last);
    last = now;
    if (now - t0 < 20000) requestAnimationFrame(tick);
    else { window.drawGame = orig; res({ intervals, draw }); }
  })(performance.now());
}));
const trace = JSON.parse((await browser.stopTracing()).toString());
const gc = trace.traceEvents.filter(e => e.ph === 'X' && /^(MinorGC|MajorGC|V8\.GC_SCAVENGER|V8\.GC_MARK_COMPACTOR)$/.test(e.name));
const gcBy = {};
for (const e of gc) { const g = gcBy[e.name] || (gcBy[e.name] = { count: 0, totalMs: 0, maxMs: 0 }); g.count++; g.totalMs += e.dur / 1000; g.maxMs = Math.max(g.maxMs, e.dur / 1000); }
out.live_frame_interval_ms = stats(live.intervals);
out.live_frames_over_20ms = live.intervals.filter(x => x > 20).length;
out.live_drawGame_ms = stats(live.draw);
out.live_gc = gcBy;

await browser.close();
const json = JSON.stringify(out, null, 2);
console.log(json);
if (opt('json')) fs.writeFileSync(opt('json'), json);
