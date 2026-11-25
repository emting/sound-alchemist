const { test, expect } = require('@playwright/test');
const path = require('path');
const { serve } = require('../lib/serve');

test('first-run gate, guided lane and cast tutorial, skip, reload, and restart', async ({ page }) => {
  const server = await serve(path.resolve(__dirname, '..', '..'));
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`${server.origin}/sound_alchemist.html`);
  await page.waitForFunction(() => typeof state === 'object' && state.hand.length === 5 && state.awaitingStart);

  const initial = await page.evaluate(() => ({
    hp: state.hp,
    mana: state.mana,
    hand: state.hand.map(card => card.id),
    enemies: state.enemies.length,
    tutorialStep: state.tutorialStep,
    tutorialDone: localStorage.getItem('soundAlchemist.tutorialDone')
  }));
  expect(initial).toMatchObject({ hp: 80, mana: 3, enemies: 0, tutorialStep: 0, tutorialDone: null });
  await expect(page.locator('#startOverlay')).toBeVisible();
  await page.waitForTimeout(15000);
  expect(await page.evaluate(() => ({
    hp: state.hp,
    enemies: state.enemies.length,
    rewardPending: state.rewardPending,
    rewardVisible: !document.getElementById('rewardModal').classList.contains('hidden')
  }))).toEqual({ hp: 80, enemies: 0, rewardPending: false, rewardVisible: false });

  await page.locator('#btnStartGame').click();
  await expect.poll(() => page.evaluate(() => state.tutorialStep)).toBe(1);
  expect(await page.evaluate(() => ({ awaitingStart: state.awaitingStart, enemies: state.enemies.length })))
    .toEqual({ awaitingStart: false, enemies: 0 });
  expect(await page.evaluate(() => audio.ctx && audio.ctx.state)).toBe('running');
  await expect(page.locator('#tutorialTitle')).toHaveText('Step 1 · 換聲道');

  await page.locator('#btnLane2').click();
  await expect.poll(() => page.evaluate(() => state.tutorialStep)).toBe(2);
  await expect(page.locator('#tutorialTitle')).toHaveText('Step 2 · 出牌');
  const chargedCard = await page.evaluate(() => {
    const index = state.hand.findIndex(card => getEffectiveCardCharge(card) > 0.01);
    return index < 0 ? null : { index, charge: getEffectiveCardCharge(state.hand[index]) };
  });
  expect(chargedCard).not.toBeNull();

  const cardBox = await page.locator('#handContainer > *').nth(chargedCard.index).boundingBox();
  expect(cardBox).not.toBeNull();
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(chargedCard.charge * 820);
  await page.mouse.up();
  const waveStart = await page.evaluate(() => ({
    at: performance.now(),
    hp: state.hp,
    enemies: state.enemies.map(enemy => ({ timer: enemy.attackTimer, max: enemy.attackMax }))
  }));
  expect(waveStart.enemies).toHaveLength(4);
  expect(waveStart.enemies[0].timer).toBeGreaterThanOrEqual(waveStart.enemies[0].max - 0.1);
  await page.waitForFunction(() => state.tutorialStep === 0 && !state.awaitingStart && state.enemies.length === 4);
  await expect(page.locator('#toastBanner')).toContainText(/Peak 命中|沒有命中 Peak/);

  expect(await page.evaluate(() => ({
    hand: state.hand.map(card => card.id),
    mana: state.mana,
    totalCasts: state.totalCasts,
    peakHits: state.peakHits,
    tutorialDone: localStorage.getItem('soundAlchemist.tutorialDone'),
    timers: state.enemies.map(enemy => ({ timer: enemy.attackTimer, max: enemy.attackMax }))
  }))).toEqual({
    hand: initial.hand,
    mana: initial.mana,
    totalCasts: 0,
    peakHits: 0,
    tutorialDone: '1',
    timers: expect.any(Array)
  });
  const waveStartHp = waveStart.hp;
  await page.waitForFunction(hp => state.hp < hp, waveStartHp, { timeout: 10000 });
  const firstAttackDelay = await page.evaluate(start => performance.now() - start, waveStart.at);
  expect(firstAttackDelay).toBeGreaterThanOrEqual(waveStart.enemies[0].max * 1000 - 250);

  await page.reload();
  await page.waitForFunction(() => typeof state === 'object' && state.hand.length === 5 && state.awaitingStart);
  expect(await page.evaluate(() => ({ tutorialStep: state.tutorialStep, enemies: state.enemies.length })))
    .toEqual({ tutorialStep: 0, enemies: 0 });
  await expect(page.locator('#startOverlay')).toBeVisible();
  await expect(page.locator('#btnReplayTutorial')).toBeVisible();
  await page.locator('#btnStartGame').click();
  await page.waitForFunction(() => !state.awaitingStart && state.enemies.length === 4);
  expect(await page.evaluate(() => state.tutorialStep)).toBe(0);

  await page.reload();
  await page.waitForFunction(() => state.awaitingStart && state.hand.length === 5);
  await expect(page.locator('#tutorialCoach')).toHaveClass(/hidden/);
  await page.locator('#btnReplayTutorial').click();
  await expect.poll(() => page.evaluate(() => state.tutorialStep)).toBe(1);
  await page.locator('#btnSkipTutorial').click();
  await page.waitForFunction(() => !state.awaitingStart && state.tutorialStep === 0 && state.enemies.length === 4);

  await page.evaluate(() => {
    try { localStorage.removeItem('soundAlchemist.tutorialDone'); } catch (e) {}
  });
  await page.reload();
  await page.waitForFunction(() => typeof state === 'object' && state.awaitingStart && state.hand.length === 5);
  await page.locator('#btnStartGame').click();
  await expect.poll(() => page.evaluate(() => state.tutorialStep)).toBe(1);
  await page.locator('#btnSkipTutorial').click();
  await page.waitForFunction(() => !state.awaitingStart && state.tutorialStep === 0 && state.enemies.length === 4);

  await page.evaluate(() => {
    state.hp = 1;
    state.armor = 0;
    state.r06ReviveUsed = true;
    resolveEnemyStrike(state.enemies[0]);
  });
  await expect.poll(() => page.evaluate(() => state.gameOver)).toBe(true);
  await page.locator('#btnRestartGame').click();
  await page.waitForFunction(() => !state.awaitingStart && state.tutorialStep === 0 && state.enemies.length === 4);
  await expect(page.locator('#startOverlay')).toHaveCSS('display', 'none');
  expect(errors).toEqual([]);
});
