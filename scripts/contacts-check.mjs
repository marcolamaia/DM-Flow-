import { chromium } from 'playwright';

const WEB = 'http://localhost:3000';
const stamp = Date.now();
const email = `contatos-${stamp}@test.local`;
const password = 'senhaforte123';

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FALHOU'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures.push(name);
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });

await page.goto(`${WEB}/register`);
await page.locator('form input').nth(0).fill('Dono dos Contatos');
await page.fill('input[type=email]', email);
await page.fill('input[type=password]', password);
await page.click('button[type=submit]');
await page.waitForURL('**/dashboard', { timeout: 25000 });
check('conta criada e logada', true);

// ── Tags: create, rename, delete ──
await page.goto(`${WEB}/contacts`);
await page.waitForLoadState('networkidle');
const tagsLink = page.locator('a[href="/contacts/tags"]');
check('contatos oferece o gerenciador de etiquetas', (await tagsLink.count()) > 0);

await page.goto(`${WEB}/contacts/tags`);
await page.waitForLoadState('networkidle');
await page.waitForTimeout(900);
check('tela de etiquetas abre', /Etiquetas/.test(await page.textContent('body')));
check('estado vazio explica o que fazer', /Crie a primeira/.test(await page.textContent('body')));

await page.locator('form input[type=text], form input:not([type])').first().fill('Cliente VIP');
await page.click('button[type=submit]');
await page.waitForTimeout(1500);
check('etiqueta criada aparece na lista', /Cliente VIP/.test(await page.textContent('body')));

// It has to survive a reload — otherwise it only ever existed in the browser.
await page.reload();
await page.waitForLoadState('networkidle');
await page.waitForTimeout(900);
check('etiqueta persiste depois de recarregar', /Cliente VIP/.test(await page.textContent('body')));

await page.click('button:has-text("Renomear")');
await page.waitForTimeout(400);
// The page has two forms — the create box at the top and the row being edited.
// The row's input is the one already carrying the current name.
const editInput = page.locator('form input').filter({ hasNot: page.locator('[type=color]') }).last();
await editInput.fill('Cliente Premium');
await page.click('button:has-text("Salvar")');
await page.waitForTimeout(1500);
const renamed = await page.textContent('body');
check('renomear grava de verdade', /Cliente Premium/.test(renamed) && !/Cliente VIP/.test(renamed));

// Deleting must explain what it breaks, not just ask "are you sure".
await page.locator('button[aria-label="Excluir"]').first().click();
await page.waitForTimeout(500);
const warning = await page.textContent('body');
check('exclusão avisa que automações param de encontrá-la', /Automações que dependem dela|Automa..es que dependem dela/.test(warning));

await page.locator('button:has-text("Excluir")').last().click();
await page.waitForTimeout(1500);
check('etiqueta excluída some', !/Cliente Premium/.test(await page.textContent('body')));

// ── A contact to work on ──
const cookie = (await page.context().cookies()).find((c) => c.name.includes('session') || c.name.includes('dmflow'));
check('sessão existe no navegador', Boolean(cookie));

// Create a tag we will attach, then a contact via the API sandbox.
await page.goto(`${WEB}/contacts/tags`);
await page.waitForLoadState('networkidle');
await page.locator('form input[type=text], form input:not([type])').first().fill('Interessado');
await page.click('button[type=submit]');
await page.waitForTimeout(1200);
check('segunda etiqueta criada', /Interessado/.test(await page.textContent('body')));

await browser.close();
console.log(failures.length === 0 ? '\nTUDO PASSOU' : `\n${failures.length} FALHA(S): ${failures.join(', ')}`);
process.exit(failures.length === 0 ? 0 : 1);
