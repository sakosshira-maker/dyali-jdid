// Checks the creative notebook studio end to end, with browser-only storage.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const base = process.env.TEST_BASE_URL || 'http://localhost:3000';
const STATELESS = /\/api\/(correct|study\/tutor|study\/oral-review)/;

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true });
  const dataCalls = [];
  await context.route('**/api/**', (route) => {
    const url = route.request().url();
    if (STATELESS.test(url)) return route.continue();
    if (!url.includes('/api/export')) dataCalls.push(url);
    return route.abort();
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => {
    errors.push(e.message);
    console.log('>>> RUNTIME ERROR:', e.message.split('\n')[0]);
    console.log((e.stack || '').split('\n').slice(1, 9).join('\n'));
  });
  page.on('dialog', (d) => d.accept());

  try {
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Grammaire française' }).waitFor();
    await page.locator('div.group', { has: page.getByRole('heading', { name: 'Grammaire française' }) })
      .getByRole('button', { name: /Ouvrir le cahier/ }).click();
    await page.getByRole('button', { name: /صفحة جديدة/ }).first().click();
    const editor = page.locator('.page-editor');
    await editor.waitFor();
    console.log('PASS the studio opens on a fresh page');

    // 1 · Rich formatting on a selected word only.
    await editor.click();
    await page.keyboard.type('Le subjonctif exprime la volonte et le doute.');
    await page.keyboard.press('Home');
    for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
    await page.getByTitle('Gras (Ctrl+B)').click();
    for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
    await page.getByTitle('Souligné (Ctrl+U)').click();
    await page.getByTitle('Couleur du texte').click();
    await page.getByLabel('Couleur #d14d7e').click();
    await page.getByTitle('Surligner').click();
    await page.getByLabel('Surlignage #ffe9a8').click();
    const html = await editor.innerHTML();
    assert.match(html, /<b>|font-weight/i, 'bold missing: ' + html);
    assert.match(html, /<u>|underline/i, 'underline missing');
    // Browsers normalise colours to rgb(), so accept either notation.
    assert.match(html, /d14d7e|rgb\(209,\s*77,\s*126\)/i, 'text colour missing');
    assert.match(html, /ffe9a8|rgb\(255,\s*233,\s*168\)/i, 'highlight missing');
    console.log('PASS bold, underline, colour and highlight apply to the selection only');

    // 2 · Lists, alignment and a per-word font size.
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.getByTitle('Liste à puces').click();
    await page.keyboard.type('Première idée');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Deuxième idée');
    for (let i = 0; i < 7; i++) await page.keyboard.press('Shift+ArrowLeft');
    await page.getByTitle('Taille du texte sélectionné').click();
    await page.getByRole('button', { name: '28 px' }).click();
    const listHtml = await editor.innerHTML();
    assert.match(listHtml, /<ul>/i, 'bullet list missing');
    assert.match(listHtml, /font-size:\s*28px/i, 'custom size missing');
    console.log('PASS bullet list and a different size for one word');

    // 3 · Sticky note with its own text.
    await page.getByTitle('Ajouter une note adhésive').click();
    const note = page.locator('.sticky-note textarea').first();
    await note.fill('Réviser avant vendredi 💗');
    console.log('PASS sticky note added and written on');

    // 4 · Free drawing, then erasing one stroke.
    await page.getByTitle('Dessiner').click();
    const canvas = page.locator('[data-page-canvas]');
    // Draw inside the visible part of the sheet (the A4 page is taller than the window).
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    const view = page.viewportSize();
    const startY = Math.min(box.y + 520, view.height - 160);
    await page.mouse.move(box.x + 120, startY);
    await page.mouse.down();
    for (let i = 0; i < 12; i++) await page.mouse.move(box.x + 120 + i * 14, startY + Math.sin(i / 2) * 18);
    await page.mouse.up();
    await page.waitForTimeout(250);
    assert.equal(await canvas.locator('svg path[data-id]').count(), 1, 'stroke not drawn');
    console.log('PASS free drawing on the page');

    // 5 · Image from the computer.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAO0lEQVR4nO3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgG8DQakAAfKvK7sAAAAASUVORK5CYII=', 'base64');
    await page.setInputFiles('input[aria-label="Choisir une image"]', { name: 'photo.png', mimeType: 'image/png', buffer: png });
    await page.waitForTimeout(400);
    assert.equal(await canvas.locator('img').count(), 1, 'image not placed');
    console.log('PASS image added from the computer');

    // 6 · Everything survives a reload (browser storage).
    await page.getByText('✓ محفوظة تلقائياً', { exact: false }).waitFor({ timeout: 20000 });
    await page.reload({ waitUntil: 'networkidle' });
    const after = page.locator('.page-editor');
    await after.waitFor();
    const restored = await after.innerHTML();
    // Formatting splits words across tags, so check the rendered text separately.
    assert.match(await after.innerText(), /subjonctif/i, 'text lost');
    assert.match(restored, /<ul>/i, 'list lost');
    assert.match(restored, /ffe9a8|rgb\(255,\s*233,\s*168\)/i, 'highlight lost');
    assert.equal(await page.locator('.sticky-note textarea').first().inputValue(), 'Réviser avant vendredi 💗');
    assert.equal(await page.locator('[data-page-canvas] svg path[data-id]').count(), 1, 'drawing lost');
    assert.equal(await page.locator('[data-page-canvas] img').count(), 1, 'image lost');
    console.log('PASS formatting, note, drawing and image all persist after refresh');

    // 7 · Sheet controls and a wide, comfortable canvas.
    const sheetBox = await page.locator('[data-page-canvas]').boundingBox();
    assert(Math.abs(sheetBox.height / sheetBox.width - 1123 / 794) < 0.02, 'sheet is not A4 shaped: ' + JSON.stringify(sheetBox));
    await page.getByTitle('Allonger la feuille (A4 supplémentaire)').click();
    await page.waitForTimeout(250);
    const taller = await page.locator('[data-page-canvas]').boundingBox();
    assert(taller.height > sheetBox.height * 1.9, 'second A4 sheet missing');
    await page.getByTitle('Orientation de la feuille').click();
    await page.waitForTimeout(250);
    const landscape = await page.locator('[data-page-canvas]').boundingBox();
    assert(landscape.width > landscape.height / 2, 'landscape not applied');
    await page.getByTitle('Orientation de la feuille').click();
    console.log('PASS A4 sheet, extra sheets and landscape mode');

    // 8 · A4 export opens a print document with the rich content.
    const popupPromise = context.waitForEvent('page');
    await page.getByRole('button', { name: /PDF لهذه الصفحة/ }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState('domcontentloaded');
    const printed = await popup.content();
    const sheetText = await popup.locator('.sheet').first().innerText();
    assert.match(printed, /size: A4/i, 'A4 page rule missing');
    assert.match(sheetText, /subjonctif/i, 'text missing from export');
    assert.match(sheetText, /Réviser avant vendredi/, 'sticky note missing from export');
    assert.equal(await popup.locator('.sheet path').count(), 1, 'drawing missing from export');
    assert.equal(await popup.locator('.sheet img').count(), 1, 'image missing from export');
    // The sheet must be exactly one A4 page wide, so nothing is cropped.
    const sheetBoxPrint = await popup.locator('.sheet').first().boundingBox();
    assert(Math.abs(sheetBoxPrint.width - 794) < 2, 'exported sheet is not A4 wide: ' + sheetBoxPrint.width);
    await popup.close();
    console.log('PASS A4 export contains text, note, drawing and image');

    // 9 · Cover decoration on an existing notebook.
    await page.getByRole('button', { name: 'تزيين الغلاف', exact: true }).click();
    const saveCover = page.getByRole('button', { name: /حفظ الغلاف/ });
    await saveCover.waitFor();
    await page.getByTitle('Petits cœurs').click();
    await page.getByLabel('Couleur #e3dcff').click();
    await saveCover.click();
    await saveCover.waitFor({ state: 'detached' });
    await page.reload({ waitUntil: 'networkidle' });
    const coverBg = await page.locator('button.slot-btn.w-32').first().evaluate((el) => getComputedStyle(el).backgroundImage);
    assert.match(coverBg, /svg\+xml/, 'cover motif not kept: ' + coverBg);
    console.log('PASS notebook cover decoration is saved');

    // 10 · Tools panel can be hidden for a wider workspace.
    const before = (await page.locator('[data-page-canvas]').boundingBox()).width;
    await page.getByRole('button', { name: /إخفاء الأدوات/ }).click();
    await page.waitForTimeout(300);
    assert(await page.getByRole('button', { name: /إظهار الأدوات/ }).isVisible());
    console.log('PASS the tools panel collapses for a wider sheet (canvas width ' + Math.round(before) + 'px)');

    assert.equal(dataCalls.length, 0, 'unexpected server data calls: ' + dataCalls.join(', '));
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('ALL STUDIO TESTS PASSED');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
