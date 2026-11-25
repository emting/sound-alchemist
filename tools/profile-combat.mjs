// From the repo root: node tools/profile-combat.mjs /path/to/output-directory [--gpu] [--headed] [--cpu=1,4] [--parry|--reward]
// --reward adds four idle reward-modal conditions after the combat reference at each CPU rate.
// Uses Chrome (set CHROME_PATH for a nonstandard install) and Playwright from qa/.
// Set PROFILE_ROOT to serve a separate checkout rather than this one.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../qa/package.json', import.meta.url));
const { chromium } = require('playwright');
const { serve } = require('./lib/serve');
const [output, ...options] = process.argv.slice(2);
if (!output) throw new Error('Pass an output directory for the trace, metrics and screenshot.');
fs.mkdirSync(output, { recursive: true });
const gpu = options.includes('--gpu');
const parry = options.includes('--parry');
const reward = options.includes('--reward');
if (parry && reward) throw new Error('Use --reward or --parry, not both.');
const rates = (options.find(arg => arg.startsWith('--cpu='))?.slice(6) || '1,4').split(',').map(Number);
const conditions = reward ? ['combat', 'baseline', 'blur-off', 'draw-paused', 'combined'] : ['combat'];
const args = ['--autoplay-policy=no-user-gesture-required', ...(gpu ? ['--enable-gpu'] : ['--disable-gpu'])];
const { origin } = await serve(path.resolve(process.env.PROFILE_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..')));
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  headless: !options.includes('--headed'),
  args,
});

const categories = ['devtools.timeline', 'disabled-by-default-devtools.timeline',
  'disabled-by-default-v8.cpu_profiler', 'blink.user_timing', 'cc', 'viz', 'gpu'];
const browserCdp = await browser.newBrowserCDPSession();
const { gpu: gpuInfo } = await browserCdp.send('SystemInfo.getInfo');
const metrics = async cdp => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(({ name, value }) => [name, value]));
const round = n => Number(n.toFixed(3));
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];

function renderingTimes(trace, frames) {
  const events = JSON.parse(trace.toString()).traceEvents;
  const start = events.find(event => event.name === 'combat-profile-start');
  const end = events.find(event => event.name === 'combat-profile-end');
  if (!start || !end) throw new Error('The trace did not record both sample markers.');
  // Use separate Renderer and Viz totals: they can run concurrently, and draw-quad
  // timings inside Viz's DrawAndSwap slices would otherwise be counted twice.
  const mainStages = new Set(['UpdateLayoutTree', 'Layout', 'PrePaint', 'Paint', 'Layerize', 'LayerTreeHost::DoUpdateLayers']);
  const elapsed = predicate => {
    const slices = events.filter(event => event.ph === 'X' && event.ts < end.ts &&
      event.ts + event.dur > start.ts && predicate(event)).sort((a, b) => a.ts - b.ts);
    let total = 0;
    let cursor = start.ts;
    for (const { ts, dur } of slices) {
      const stop = Math.min(end.ts, ts + dur);
      total += Math.max(0, stop - Math.max(cursor, ts));
      cursor = Math.max(cursor, stop);
    }
    return round(total / 1000 / frames);
  };
  const onMain = event => event.pid === start.pid && event.tid === start.tid;
  return {
    mainThreadRendering: elapsed(event => onMain(event) && mainStages.has(event.name)),
    mainThreadPaint: elapsed(event => onMain(event) && event.name === 'Paint'),
    vizDrawAndSwap: elapsed(event => event.name === 'Display::DrawAndSwap'),
    softwareDrawQuad: elapsed(event => event.name === 'SoftwareRenderer::DoDrawQuad'),
    raster: elapsed(event => event.name === 'RasterTask'),
  };
}

try {
  for (const [rate, condition] of rates.flatMap(rate => conditions.map(condition => [rate, condition]))) {
    const modal = condition !== 'combat';
    const blurOff = condition === 'blur-off' || condition === 'combined';
    const drawPaused = condition === 'draw-paused' || condition === 'combined';
    const prefix = path.join(output, `${gpu ? 'gpu' : 'software'}-${rate}x${reward ? `-${condition}` : parry ? '-parry' : ''}`);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.addInitScript(() => {
      let seed;
      window.resetProfileRandom = () => { seed = 42; };
      window.resetProfileRandom();
      Math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    });
    await page.goto(`${origin}/sound_alchemist.html`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.locator('#battleCanvas').click({ position: { x: 600, y: 160 } });
    await page.waitForFunction(() => audio.ctx?.state === 'running' && state.enemies.length > 0);
    await page.waitForFunction(() => audioAssets.status === 'fallback' ||
      (audioAssets.status === 'ready' && [...audioAssets.entries.values()].every(entry => entry.buffer)));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Performance.enable');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    if (modal) {
      if (blurOff) await page.addStyleTag({ content: '#rewardModal, #rewardModal .glass-panel { backdrop-filter: none !important; }' });
      await page.evaluate(drawPaused => {
        const draw = drawGame;
        const rewardModal = document.getElementById('rewardModal');
        let drewOpenModal = false;
        let draws = 0;
        window.profileDrawCount = () => draws;
        drawGame = dt => {
          if (!rewardModal.classList.contains('hidden')) {
            if (drawPaused && drewOpenModal) return;
            drewOpenModal = true;
          } else {
            drewOpenModal = false;
          }
          draws++;
          draw(dt);
        };
        window.resetProfileRandom();
        for (const enemy of state.enemies) enemy.hp = 0;
        cleanupDeadEnemies(false);
      }, drawPaused);
      await page.locator('#rewardChoicesContainer > *').first().waitFor();
      await page.waitForTimeout(3000);
    }
    const setup = await page.evaluate(() => ({
      canvas: [canvas.width, canvas.height], enemies: state.enemies.length,
      wave: state.wave, analyser: !!audio.analyser, dpr: devicePixelRatio,
      decodedAudioAssets: audioAssets.entries.size,
      backdropFilters: ['header', 'main .glass-panel', '#btnLane0', '#rewardModal', '#rewardModal .glass-panel'].map(selector => {
        const el = document.querySelector(selector);
        return getComputedStyle(selector === '#btnLane0' ? el.parentElement : el).backdropFilter;
      }),
    }));
    if (blurOff && setup.backdropFilters.slice(-2).some(filter => filter !== 'none')) throw new Error('Modal blur was not disabled.');
    await page.screenshot({ path: `${prefix}.png`, animations: 'disabled' });

    await browser.startTracing(page, { categories, path: `${prefix}.trace.json` });
    const start = await metrics(cdp);
    const live = await page.evaluate(parry => new Promise(resolve => {
      const intervals = [];
      let first, last, initialDraws;
      let parried = false, maxParticles = 0;
      const frame = now => {
        if (first === undefined) {
          first = now;
          initialDraws = window.profileDrawCount?.();
          performance.mark('combat-profile-start');
        } else {
          intervals.push(now - last);
        }
        if (parry && !parried) {
          const enemy = state.enemies.find(e => audioClock.isParryOpen(e, audioClock.inputTime()));
          if (enemy) {
            performance.mark('combat-profile-parry');
            handleParryInput(enemy.weakness);
            parried = true;
          }
        }
        maxParticles = Math.max(maxParticles, state.particles.length);
        last = now;
        if (now - first < 7000) requestAnimationFrame(frame);
        else {
          performance.mark('combat-profile-end');
          resolve({ intervals, wave: state.wave, enemies: state.enemies.length, gameOver: state.gameOver, maxParticles,
            rewardOpen: !document.getElementById('rewardModal').classList.contains('hidden'),
            draws: window.profileDrawCount && window.profileDrawCount() - initialDraws });
        }
      };
      requestAnimationFrame(frame);
    }), parry);
    const end = await metrics(cdp);
    const trace = await browser.stopTracing();
    if (live.gameOver || live.wave !== setup.wave || (modal ? !live.rewardOpen || live.enemies : !live.enemies || live.rewardOpen)) {
      throw new Error(`The sample did not stay in ${modal ? 'the reward modal' : 'live combat'}.`);
    }
    if (drawPaused && live.draws !== 0) throw new Error('Canvas drawing did not stay paused.');
    if (parry && !live.maxParticles) throw new Error('The parry sample did not exercise particle rendering.');
    const n = live.intervals.length;
    const perFrame = name => 1000 * (end[name] - start[name]) / n;
    const result = {
      chrome: browser.version(), cpu: os.cpus()[0].model, device: gpuInfo.devices,
      featureStatus: gpuInfo.featureStatus, args, headed: options.includes('--headed'),
      rate, condition, setup, frameCount: n, maxParticles: live.maxParticles, draws: live.draws,
      frameIntervalMs: { median: round(percentile(live.intervals, 0.5)), p95: round(percentile(live.intervals, 0.95)) },
      mainThreadMsPerFrame: {
        script: round(perFrame('ScriptDuration')),
        style: round(perFrame('RecalcStyleDuration')),
        layout: round(perFrame('LayoutDuration')),
        task: round(perFrame('TaskDuration')),
      },
      traceMsPerFrame: renderingTimes(trace, n),
    };
    fs.writeFileSync(`${prefix}.json`, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ rate, condition, frameCount: n, draws: live.draws, frameIntervalMs: result.frameIntervalMs,
      mainThreadMsPerFrame: result.mainThreadMsPerFrame, traceMsPerFrame: result.traceMsPerFrame,
      device: gpuInfo.devices[0].deviceString }));
    await context.close();
  }
} finally {
  await browser.close();
}
