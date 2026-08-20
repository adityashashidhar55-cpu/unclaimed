/**
 * Drive the two wizards the way a person does.
 *
 * Shared by qa-screens.mjs and test-results-i18n.mjs. It lived inside
 * qa-screens; a second copy in the new guard would have been a second thing to
 * keep in step with the markup, and the guard that is not kept in step is the
 * one that quietly stops reaching the screen it is supposed to measure.
 */

/**
 * Walk the personal wizard: answer what is in front of you, then press
 * whatever moves you on.
 *
 * Not "press Continue eight times". The status step renders no Continue until
 * something is chosen and no Skip at all, and the region, status and income
 * steps commit and advance on the tile click itself — so a loop that only
 * presses nav buttons stalls on step 2 and reports "the wizard never reached
 * a result" about a wizard that works.
 *
 * @returns {Promise<boolean>} whether a result screen was reached.
 */
export async function stepThrough(page, { onStep = null, max = 12 } = {}) {
  for (let i = 0; i < max; i += 1) {
    if (await page.$('.result-hero')) return true;
    if (onStep) await onStep(page);
    const before = await page.evaluate(() => document.querySelector('.progress-caption')?.textContent || '');
    const picked = await page.evaluate(() => {
      const tiles = [...document.querySelectorAll('.opt[data-field]')];
      if (!tiles.length) return false;
      if (tiles.some((t) => t.getAttribute('aria-pressed') === 'true')) return false;
      tiles[0].click();
      return true;
    });
    if (picked) {
      await page.waitForTimeout(280);
      if (await page.$('.result-hero')) return true;
      const after = await page.evaluate(() => document.querySelector('.progress-caption')?.textContent || '');
      if (after !== before) continue; // the tile advanced us; nothing to press
    }
    const next = await page.$('[data-act="next"]');
    const skip = await page.$('[data-act="skip"]');
    if (!next && !skip) return !!(await page.$('.result-hero'));
    await (next || skip).click();
    await page.waitForTimeout(280);
  }
  return !!(await page.$('.result-hero'));
}

/**
 * Pick a country on step 1 of the personal wizard, then walk the rest.
 *
 * @param {string} cc the country slug on the tile's data-cc.
 */
export async function drivePersonal(page, cc, opts = {}) {
  await page.waitForSelector('[data-act="country"]', { timeout: 8000 });
  const tile = await page.$(`[data-cc="${cc}"]`);
  if (!tile) throw new Error(`no country tile for "${cc}" on step 1`);
  await tile.click();
  await page.waitForTimeout(200);
  return stepThrough(page, opts);
}

/**
 * Walk the company wizard. Its steps are fixed and each one commits on
 * Continue, so unlike the personal wizard it can be answered by name.
 */
export async function driveCompany(page, cc) {
  await page.waitForSelector('[data-act="country"]', { timeout: 8000 });
  await page.click(`[data-cc="${cc}"]`);
  for (const [field, value] of [
    ['stage', 'seed'],
    ['headcount', '15'],
    ['turnover_annual_eur', '750000'],
    ['sectors', 'software'],
    ['rd_active', 'true'],
  ]) {
    const tile = await page.$(`[data-field="${field}"][data-value="${value}"]`);
    if (!tile) throw new Error(`no tile for ${field}=${value}`);
    await tile.click();
    await page.click('[data-act="next"]');
    await page.waitForTimeout(150);
  }
  await page.waitForSelector('.result-hero', { timeout: 8000 });
  return true;
}
