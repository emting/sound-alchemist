// node tools/bench-loading.mjs [site-directory]
// Playwright Chromium from qa/ (npm ci && npx playwright install chromium there).
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve } from 'node:path';
import { chromium } from '../qa/node_modules/playwright/index.mjs';

const root = resolve(process.argv[2] || '.');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.mp3': 'audio/mpeg' };
const originLog = [];
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const file = resolve(root, '.' + path);
  if (!file.startsWith(root + '/')) { res.writeHead(403).end(); return; }
  try {
    const mtime = (await stat(file)).mtime.toUTCString();
    if (req.headers['if-modified-since'] === mtime) {
      originLog.push({ url: path, bytes: 0 });
      res.writeHead(304).end();
      return;
    }
    const body = await readFile(file);
    originLog.push({ url: path, bytes: body.length });
    res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Last-Modified': mtime });
    res.end(body);
  } catch {
    originLog.push({ url: path, bytes: 0 });
    res.writeHead(404).end();
  }
});
await new Promise(resolve => server.listen(8090, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:8090/sound_alchemist.html';
const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required'],
});

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => {
    const decode = BaseAudioContext.prototype.decodeAudioData;
    BaseAudioContext.prototype.decodeAudioData = function (data, done, fail) {
      return decode.call(this, data, buffer => {
        window.firstDecodedAt ??= performance.now();
        window.lastDecodedAt = performance.now();
        done?.(buffer);
      }, fail);
    };
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  const requests = new Map();
  cdp.on('Network.requestWillBeSent', ({ requestId, request }) => {
    if (/^https?:/.test(request.url)) requests.set(requestId, { url: request.url });
  });
  cdp.on('Network.responseReceived', ({ requestId, response }) => {
    const entry = requests.get(requestId);
    if (entry) entry.cached = response.fromDiskCache ||
      (response.fromServiceWorker && response.serviceWorkerResponseSource !== 'network');
  });
  cdp.on('Network.loadingFinished', ({ requestId, encodedDataLength }) => {
    const entry = requests.get(requestId);
    if (entry) entry.bytes = entry.cached ? 0 : encodedDataLength;
  });
  const totals = list => {
    const bytes = entries => entries.reduce((n, entry) => n + (entry.bytes || 0), 0);
    const mp3 = list.filter(entry => /\.mp3(?:\?|$)/.test(entry.url));
    return { requests: list.length, bytes: bytes(list), mp3Requests: mp3.length, mp3Bytes: bytes(mp3) };
  };
  const snapshot = () => {
    const list = [...requests.values()];
    const origin = totals(originLog);
    const external = totals(list.filter(entry => new URL(entry.url).origin !== new URL(url).origin));
    // CDP doesn't attribute all worker fetches to the page. Count same-origin response
    // bodies at the server instead, plus the page's CDP-observed external transfer.
    return { browser: totals(list), origin, external, accountedBytes: origin.bytes + external.bytes };
  };
  const measure = async navigate => {
    requests.clear();
    originLog.length = 0;
    await navigate();
    // Open the game's Web Audio context at the earliest point the game exposes it.
    await page.evaluate(() => audio.init());
    await page.waitForFunction(() => audioAssets.summary().decoded > 0);
    const atFirstDecode = snapshot();
    await page.waitForFunction(() => audioAssets.summary().decoded === 40, null, { timeout: 60000 });
    await page.evaluate(() => document.fonts.ready.then(() => null));
    const timings = await page.evaluate(() => ({
      firstDecodedMs: Math.round(window.firstDecodedAt),
      allDecodedMs: Math.round(window.lastDecodedAt),
      serviceWorker: !!navigator.serviceWorker.controller,
      assets: audioAssets.summary(),
    }));
    return { ...timings, atFirstDecode, full: snapshot() };
  };
  const opts = { waitUntil: 'domcontentloaded' };
  const cold = await measure(() => page.goto(url, opts));
  const repeat = await measure(() => page.reload(opts));
  console.log(JSON.stringify({ url, chromium: browser.version(), cold, repeat }, null, 2));
} finally {
  await browser.close();
  server.close();
}
