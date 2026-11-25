const { test, expect } = require('@playwright/test');
const { HTTP, gameUrl } = require('../lib/harness');

test('starter sounds are prioritized, on-demand sounds jump the queue, and undecoded hits fall back', async ({ browser }) => {
  test.skip(!HTTP, 'needs QA_HTTP=1');
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const mp3Requests = [];
  let unblock;
  const held = new Promise(resolve => { unblock = resolve; });
  try {
    await context.route('**/assets/audio/sfx/*.mp3', async route => {
      mp3Requests.push(new URL(route.request().url()).pathname.split('/').pop().split('.')[0]);
      await held;
      await route.continue();
    });
    const page = await context.newPage();
    await page.goto(await gameUrl());
    await expect.poll(() => mp3Requests.length).toBe(4);
    const priority = await page.evaluate(() => ({
      hand: state.hand.map(card => card.id),
      starters: [...state.ownedRelics, ...state.masterDeck.map(card => card.id)],
    }));
    expect(mp3Requests.every(id => priority.hand.includes(id))).toBe(true);
    const firstPlay = await page.evaluate(() => {
      const relic = ALL_RELICS.find(r => r.id === 'R09');
      const impact = audio.playImpactOrRelease;
      let synthCalls = 0;
      audio.playImpactOrRelease = () => { synthCalls += 1; };
      try {
        audio.playRelic(relic);
        return { synthCalls, decoded: audioAssets.summary().decoded };
      } finally {
        audio.playImpactOrRelease = impact;
      }
    });
    expect(firstPlay).toEqual({ synthCalls: 1, decoded: 0 });
    unblock();
    await page.waitForFunction(ids => ids.every(id => audioAssets.has(id)), [...priority.starters, 'R09']);
    expect(mp3Requests[4]).toBe('R09');
    expect(mp3Requests.slice(0, priority.starters.length + 1).filter(id => id !== 'R09').sort()).toEqual(priority.starters.sort());
    await page.waitForFunction(() => audioAssets.summary().decoded === 40);
  } finally {
    unblock();
    await context.close();
  }
});

test('offline reload starts an MP3 from the service worker cache', async ({ page, context }, testInfo) => {
  test.skip(!HTTP, 'needs QA_HTTP=1');
  await page.addInitScript(() => {
    try { localStorage.setItem('soundAlchemist.tutorialDone', '1'); } catch (e) {}
    if (navigator.serviceWorker.controller) return;
    const register = navigator.serviceWorker.register.bind(navigator.serviceWorker);
    navigator.serviceWorker.register = (...args) => new Promise((resolve, reject) => {
      window.allowWorkerRegistration = () => register(...args).then(resolve, reject);
    });
  });
  await page.goto(await gameUrl());
  await page.waitForFunction(() => state.awaitingStart && state.hand.length === 5);
  await page.locator('#btnStartGame').click();
  await page.waitForFunction(() => !state.awaitingStart && state.enemies.length === 4);
  await page.waitForFunction(() => audioAssets.summary().loaded === 40, null, { timeout: 60000 });
  expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();
  await page.evaluate(() => { window.allowWorkerRegistration(); });
  const styles = 'assets/css/tailwind.css';
  const font = 'assets/fonts/noto-sans-tc.woff2';
  const cached = [page.url(), styles, font, 'assets/audio/manifest.json', 'assets/audio/envelopes/C01.json', 'assets/audio/sfx/C01.mp3'];
  await expect.poll(() => page.evaluate(async urls => navigator.serviceWorker.controller?.state === 'activated' &&
    (await Promise.all(urls.map(url => caches.match(url)))).every(Boolean), cached), { timeout: 60000 }).toBe(true);
  const game = page.url();
  await context.setOffline(true);
  const responses = await Promise.all([
    page.waitForResponse(new URL(styles, game).href),
    page.waitForResponse(new URL(font, game).href),
    page.reload(),
  ]);
  expect(responses.every(response => response.ok() && response.fromServiceWorker())).toBe(true);
  await page.waitForFunction(() => state.awaitingStart && state.hand.length > 0);
  await page.locator('#btnStartGame').click();
  await page.waitForFunction(() => !state.awaitingStart && state.enemies.length === 4);
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  await expect(page.locator('#codexModal')).toHaveCSS('display', 'none');
  await page.locator('#btnMobileMenu').click();
  await page.locator('#btnOpenCodex').click();
  await page.waitForFunction(() => audioAssets.has('C01'));
  await page.evaluate(() => {
    const create = audio.ctx.createBufferSource.bind(audio.ctx);
    const buffer = audioAssets.entries.get('C01').buffer;
    window.offlineMp3Starts = 0;
    audio.ctx.createBufferSource = () => {
      const node = create();
      const start = node.start.bind(node);
      node.start = (...args) => {
        start(...args);
        if (node.buffer === buffer) window.offlineMp3Starts += 1;
      };
      return node;
    };
  });
  await page.locator('.btn-preview-card').first().click();
  const played = await page.evaluate(() => ({ mp3Starts: window.offlineMp3Starts, assets: audioAssets.summary() }));
  expect(played.mp3Starts).toBe(1);
  await testInfo.attach('offline decode and playback', { body: JSON.stringify(played), contentType: 'application/json' });
});

test('an updated worker takes control and keeps previously cached audio playable offline', async ({ page, context }) => {
  test.skip(!HTTP, 'needs QA_HTTP=1');
  await page.goto(await gameUrl());
  await page.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated' && audioAssets.summary().loaded === 40);
  const retiredCache = await page.evaluate(async () => {
    const scope = new URL('./', location.href).href;
    const prefix = `sound-alchemist:${scope}:`;
    const key = prefix + 'retired';
    const old = await caches.open(key);
    const current = await caches.open((await caches.keys()).find(name => name.startsWith(prefix) && name !== key));
    for (const path of ['envelopes/C01.json', 'sfx/C01.mp3']) {
      const url = new URL('assets/audio/' + path, scope).href;
      await old.put(url, new Response('obsolete content'));
      await current.delete(url);
    }
    await old.put(new URL('assets/audio/envelopes/removed.json', scope).href, new Response('removed from manifest'));
    await navigator.serviceWorker.register('sw.js?update-test=1');
    return key;
  });
  await page.waitForFunction(() => {
    const worker = navigator.serviceWorker.controller;
    return worker?.state === 'activated' && worker.scriptURL.endsWith('?update-test=1');
  }, null, { timeout: 15000 });
  expect(await page.evaluate(async key => (await caches.keys()).includes(key), retiredCache)).toBe(false);
  await context.setOffline(true);
  expect((await page.goto(page.url())).fromServiceWorker()).toBe(true);
  await page.evaluate(() => audio.init());
  await page.waitForFunction(() => audioAssets.has('C01'), null, { timeout: 15000 });
});

test('file URL still initializes the hand and uses the synth fallback', async ({ page }) => {
  test.skip(HTTP, 'needs file://');
  const audioRequests = [];
  page.on('request', request => {
    if (/\/sw\.js|\/assets\/audio\//.test(request.url())) audioRequests.push(request.url());
  });
  await page.goto(await gameUrl());
  const stateAndAssets = await page.evaluate(() => ({ hand: state.hand.length, ...audioAssets.summary() }));
  expect(stateAndAssets).toMatchObject({ hand: 5, status: 'fallback', loaded: 0, decoded: 0 });
  expect(audioRequests).toEqual([]);
});
