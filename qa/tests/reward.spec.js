const { test, expect } = require('@playwright/test');
const { openGame, applyCpuThrottle } = require('../lib/harness');

const clearWave = () => {
  for (const enemy of state.enemies) enemy.hp = 0;
  cleanupDeadEnemies(false);
};

test('wave clear awards gold once, keeps choices stable and advances or restarts', async ({ page }) => {
  await openGame(page);
  await applyCpuThrottle(page);
  await page.locator('#battleCanvas').click();
  const reward = page.locator('#rewardModal');
  const choices = page.locator('#rewardChoicesContainer > *');

  const expectedGold = await page.evaluate(() => {
    state.ownedRelics.push('R05');
    return state.gold + state.enemies.length * 12 + 20 + 15;
  });
  await page.evaluate(clearWave);
  await expect(reward).toBeVisible();
  await expect(choices).toHaveCount(3);
  await expect(reward).toHaveCSS('backdrop-filter', 'none');
  await expect(reward.locator('.glass-panel')).toHaveCSS('backdrop-filter', 'none');

  const stable = await page.evaluate(async () => {
    const container = document.getElementById('rewardChoicesContainer');
    const options = [...container.children];
    for (let i = 0; i < 10; i++) await new Promise(requestAnimationFrame);
    return {
      gold: state.gold,
      sameChoices: options.length === container.children.length && options.every((el, i) => el === container.children[i]),
    };
  });
  expect(stable).toEqual({ gold: expectedGold, sameChoices: true });

  await choices.first().click();
  await expect(reward).toBeHidden();
  expect(await page.evaluate(() => state.wave === 2 && state.enemies.length > 0)).toBe(true);

  await page.evaluate(() => {
    state.act = 3;
    state.wave = state.maxWaves;
    spawnWaveEnemies();
  });
  await page.evaluate(clearWave);
  await expect(reward).toBeHidden();
  await expect(page.locator('#goWaveStat')).toHaveText(/ACT 3 CLEAR/);
  await expect(page.locator('#gameOverModal')).toHaveCSS('backdrop-filter', 'none');
  await expect(page.locator('#gameOverModal > .glass-panel')).toHaveCSS('backdrop-filter', 'none');
  await page.locator('#btnRestartGame').click();
  await expect(page.locator('#gameOverModal')).toBeHidden();
  expect(await page.evaluate(() => state.act === 1 && state.wave === 1 && state.enemies.length > 0)).toBe(true);
});
