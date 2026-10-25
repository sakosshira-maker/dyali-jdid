// End-to-end checks for browser-only storage (no server database involved).
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.TEST_BASE_URL || 'http://localhost:3000';
const STATELESS = /\/api\/(correct|study\/tutor|study\/oral-review)/;

async function isolatedContext(browser, extra = {}) {
  // Simulates Netlify without any database: every data route is unreachable.
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, ...extra });
  const dataCalls = [];
  await context.route('**/api/**', (route) => {
    const url = route.request().url();
    if (STATELESS.test(url)) return route.continue();
    if (!url.includes('/api/export')) dataCalls.push(url);
    return route.abort();
  });
  return { context, dataCalls };
}

async function idbCounts(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('petit-cahier');
    req.onsuccess = () => {
      const all = req.result.transaction('rows').objectStore('rows').getAll();
      all.onsuccess = () => { const c = {}; for (const r of all.result) c[r.t] = (c[r.t] || 0) + 1; resolve(c); };
      all.onerror = () => reject(all.error);
    };
    req.onerror = () => reject(req.error);
  }));
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const errors = [];
  try {
    const { context, dataCalls } = await isolatedContext(browser);
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => d.accept());

    await page.goto(base, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Grammaire française' }).waitFor();
    console.log('PASS app starts with its notebook content and no database at all');

    // Easy add: brand-new subject on two days in one go.
    await page.getByRole('button', { name: 'Séance', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Nouvelle séance' });
    await dialog.getByRole('button', { name: /Nouvelle matière/ }).click();
    await dialog.getByLabel('Nom de la nouvelle matière').fill('Les Grands Mythes');
    await dialog.getByLabel('Enseignant de la nouvelle matière').fill('Pr. El Harrak');
    for (const day of ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']) {
      const chip = dialog.getByRole('button', { name: day, exact: true });
      const want = day === 'Lun' || day === 'Jeu';
      if ((await chip.getAttribute('aria-pressed')) !== String(want)) await chip.click();
    }
    await dialog.getByRole('button', { name: '08:30 – 11:30' }).click();
    await dialog.getByLabel('Salle (facultatif)').fill('Salle R');
    await dialog.getByRole('button', { name: /Ajouter sur 2 jours/ }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.equal(await page.locator('button[title="Les Grands Mythes · 08:30–11:30"]').count(), 2);
    await page.getByRole('heading', { name: 'Les Grands Mythes' }).waitFor();
    console.log('PASS one form creates the subject, its notebook and two sessions');

    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await page.locator('button[title="Les Grands Mythes · 08:30–11:30"]').count(), 2);
    console.log('PASS timetable and subjects survive a page refresh');

    // Edit one session through the pencil.
    const block = page.locator('button[title="Les Grands Mythes · 08:30–11:30"]').first();
    await block.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.waitForTimeout(400);
    await block.hover();
    await page.waitForTimeout(300);
    await block.getByRole('button', { name: 'Modifier la séance' }).dispatchEvent('click');
    const edit = page.getByRole('dialog', { name: 'Modifier la séance' });
    await edit.getByRole('button', { name: '14:30 – 17:30' }).click();
    await edit.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await edit.waitFor({ state: 'detached' });
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await page.locator('button[title="Les Grands Mythes · 14:30–17:30"]').count(), 1);
    assert.equal(await page.locator('button[title="Les Grands Mythes · 08:30–11:30"]').count(), 1);
    console.log('PASS editing a session is kept after refresh');

    // The new subject's notebook works and autosaves locally.
    await page.locator('div.group', { has: page.getByRole('heading', { name: 'Les Grands Mythes' }) }).getByRole('button', { name: /Ouvrir le cahier/ }).click();
    await page.getByText('Cahier de Les Grands Mythes', { exact: true }).waitFor();
    await page.getByRole('button', { name: /صفحة جديدة/ }).first().click();
    const editor = page.locator('.page-editor');
    await editor.waitFor();
    await editor.click();
    await page.keyboard.type('Le mythe de Prométhée : le feu volé aux dieux.');
    await page.getByText('✓ محفوظة تلقائياً', { exact: false }).waitFor({ timeout: 20000 });
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('.page-editor').waitFor();
    assert.match(await page.locator('.page-editor').innerText(), /Prométhée/);
    console.log('PASS notebook writing is saved in the browser and restored');

    // Study corners keep their data too.
    await page.goto(base + '/bien-etre', { waitUntil: 'networkidle' });
    await page.getByLabel('Jour du journal').fill('2001-01-01');
    await page.getByRole('button', { name: '🥰 Heureuse', exact: true }).click();
    await page.waitForTimeout(400);
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByLabel('Jour du journal').fill('2001-01-01');
    await page.waitForFunction(() => document.querySelector('button[aria-pressed="true"]')?.textContent.includes('Heureuse'));
    await page.goto(base + '/dictionnaire', { waitUntil: 'networkidle' });
    const keep = page.getByRole('button', { name: 'Garder ce petit mot', exact: true });
    await keep.or(page.getByRole('button', { name: 'Dans mon dictionnaire', exact: true })).first().waitFor();
    if (await keep.count()) await keep.click();
    await page.getByRole('button', { name: 'Dans mon dictionnaire', exact: true }).waitFor();
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Dans mon dictionnaire', exact: true }).waitFor();
    console.log('PASS moods and saved words persist locally');

    const counts = await idbCounts(page);
    assert(counts.modules >= 9 && counts.timetable >= 13 && counts.pages >= 5 && counts.moods >= 1, JSON.stringify(counts));
    assert.equal(dataCalls.length, 0, 'unexpected data requests: ' + dataCalls.join(', '));
    console.log('PASS everything lives in IndexedDB; zero calls to server data routes');

    // Backup download, then restore into a completely different browser profile.
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Mes données et sauvegardes' }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Télécharger ma sauvegarde/ }).click()]);
    const file = '/tmp/mon-petit-cahier-backup-test.json';
    await download.saveAs(file);
    const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(backup.app, 'mon-petit-cahier');
    assert(backup.tables.modules.some((m) => m.name === 'Les Grands Mythes'));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base, { waitUntil: 'networkidle' });
    const mobile = await page.evaluate(() => ({ w: innerWidth, sw: document.documentElement.scrollWidth }));
    assert(mobile.sw <= mobile.w + 2, 'mobile overflow ' + JSON.stringify(mobile));
    await context.close();

    const second = await isolatedContext(browser);
    const other = await second.context.newPage();
    other.on('pageerror', (e) => errors.push(e.message));
    other.on('dialog', (d) => d.accept());
    await other.goto(base, { waitUntil: 'networkidle' });
    await other.getByRole('heading', { name: 'Grammaire française' }).waitFor();
    assert.equal(await other.getByRole('heading', { name: 'Les Grands Mythes' }).count(), 0);
    await other.getByRole('button', { name: 'Mes données et sauvegardes' }).click();
    await other.setInputFiles('input[aria-label="Fichier de sauvegarde"]', file);
    await other.waitForURL(base + '/', { waitUntil: 'networkidle' });
    await other.getByRole('heading', { name: 'Les Grands Mythes' }).waitFor({ timeout: 15000 });
    assert.equal(await other.locator('button[title="Les Grands Mythes · 14:30–17:30"]').count(), 1);
    await second.context.close();
    console.log('PASS backup downloads and restores everything on another browser');

    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('ALL LOCAL-FIRST TESTS PASSED');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
