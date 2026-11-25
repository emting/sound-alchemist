// From the repo root: node tools/profile-combat.mjs /path/to/output-directory [--gpu] [--headed] [--cpu=1,4] [--parry]
// Uses Chrome (set CHROME_PATH for a nonstandard install) and Playwright from qa/.
// Set PROFILE_ROOT to serve a separate checkout rather than this one.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../qa/package.json', import.meta.url));
const { chromium } = require('playwright');
const { serve } = require('./lib/serve');
const [output, ...options] = process.argv.slice(2);
if (!output) throw new Error('Pass an output directory for the trace, metrics and screenshot.');
fs.mkdirSync(output, { recursive: true });
const gpu = options.includes('--gpu');
const parry = options.includes('--parry');
const rates = (options.find(arg => arg.startsWith('--cpu='))?.slice(6) || '1,4').split(',').map(Number);
const { origin } = await serve(path.resolve(process.env.PROFILE_ROOT || path.join(import.meta.dirname, '..')));
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  headless: !options.includes('--headed'),
  args: ['--autoplay-policy=no-user-gesture-required', ...(gpu ? ['--enable-gpu'] : ['--disable-gpu'])],
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
  return {
    mainThreadRendering: elapsed(event => event.pid === start.pid && event.tid === start.tid && mainStages.has(event.name)),
    vizDrawAndSwap: elapsed(event => event.name === 'Display::DrawAndSwap'),
    softwareDrawQuad: elapsed(event => event.name === 'SoftwareRenderer::DoDrawQuad'),
  };
}

try {
  for (const rate of rates) {
    const prefix = path.join(output, `${gpu ? 'gpu' : 'software'}-${rate}x${parry ? '-parry' : ''}`);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.addInitScript(() => {
      let seed = 42;
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
    const setup = await page.evaluate(() => ({
      canvas: [canvas.width, canvas.height], enemies: state.enemies.length,
      wave: state.wave, analyser: !!audio.analyser, dpr: devicePixelRatio,
      decodedAudioAssets: audioAssets.entries.size,
      backdropFilters: ['header', 'main .glass-panel', '#btnLane0'].map(selector => {
        const el = document.querySelector(selector);
        return getComputedStyle(selector === '#btnLane0' ? el.parentElement : el).backdropFilter;
      }),
    }));
    await page.screenshot({ path: `${prefix}.png`, animations: 'disabled' });

    await browser.startTracing(page, { categories, path: `${prefix}.trace.json` });
    const start = await metrics(cdp);
    const live = await page.evaluate(parry => new Promise(resolve => {
      const intervals = [];
      let first, last;
      let parried = false, maxParticles = 0;
      const frame = now => {
        if (first === undefined) {
          first = now;
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
          resolve({ intervals, wave: state.wave, enemies: state.enemies.length, gameOver: state.gameOver, maxParticles });
        }
      };
      requestAnimationFrame(frame);
    }), parry);
    const end = await metrics(cdp);
    const trace = await browser.stopTracing();
    if (live.gameOver || live.wave !== setup.wave || !live.enemies) throw new Error('The sample did not stay in live combat.');
    if (parry && !live.maxParticles) throw new Error('The parry sample did not exercise particle rendering.');
    const n = live.intervals.length;
    const perFrame = name => 1000 * (end[name] - start[name]) / n;
    const result = {
      chrome: browser.version(), cpu: os.cpus()[0].model, device: gpuInfo.devices,
      featureStatus: gpuInfo.featureStatus, rate, setup, frameCount: n, maxParticles: live.maxParticles,
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
    console.log(JSON.stringify({ rate, setup, frameCount: n, maxParticles: live.maxParticles, frameIntervalMs: result.frameIntervalMs,
      mainThreadMsPerFrame: result.mainThreadMsPerFrame, traceMsPerFrame: result.traceMsPerFrame,
      device: gpuInfo.devices[0].deviceString }));
    await context.close();
  }
} finally {
  await browser.close();
}
