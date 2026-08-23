import { chromium } from 'playwright';

const WEB = 'http://localhost:3000';
const stamp = Date.now();
const email = `segmento-${stamp}@test.local`;

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FALHOU'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures.push(name);
};

const runPrefix = `${1 + Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 256)}`;
let n = 0;
const freshAddress = () => `10.${runPrefix}.${(n += 1)}`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const context = await browser.newContext({
  viewport: { width: 1500, height: 980 },
  extraHTTPHeaders: { 'X-Forwarded-For': freshAddress() },
});
const page = await context.newPage();

await page.goto(`${WEB}/register`);
await page.locator('form input').nth(0).fill('Pessoa dos Segmentos');
await page.fill('input[type=email]', email);
await page.fill('input[type=password]', 'senhaforte123');
await page.click('button[type=submit]');
await page.waitForURL('**/dashboard', { timeout: 25000 });

// ── Custom fields ──
await page.goto(`${WEB}/contacts`);
await page.waitForLoadState('networkidle');
await page.waitForTimeout(800);
check('contatos oferece campos personalizados', (await page.locator('a[href="/contacts/fields"]').count()) > 0);
check('contatos oferece segmentos', (await page.locator('a[href="/contacts/segments"]').count()) > 0);

await page.goto(`${WEB}/contacts/fields`);
await page.waitForLoadState('networkidle');
await page.waitForTimeout(800);
check('tela de campos abre', /Campos personalizados/.test(await page.textContent('body')));

// The identifier should follow the label while nobody has touched it.
await page.getByLabel('Nome do campo').fill('Nome da empresa');
await page.waitForTimeout(400);
const derived = await page.getByLabel('Identificador').inputValue();
check('identificador é derivado do nome', derived === 'nome_da_empresa', derived);

await page.click('button:has-text("Criar campo")');
await page.waitForTimeout(1500);
check('campo criado aparece', /nome_da_empresa/.test(await page.textContent('body')));

await page.reload();
await page.waitForLoadState('networkidle');
await page.waitForTimeout(900);
check('campo persiste depois de recarregar', /nome_da_empresa/.test(await page.textContent('body')));

// Deleting says both consequences.
await page.locator('button[aria-label="Excluir"]').first().click();
await page.waitForTimeout(500);
check(
  'exclusão avisa que automações param de encontrá-lo',
  /automações que o consultam|automa..es que o consultam/.test(await page.textContent('body')),
);
await page.locator('button:has-text("Cancelar")').first().click();
await page.waitForTimeout(400);

// ── Segments ──
await page.goto(`${WEB}/contacts/segments`);
await page.waitForLoadState('networkidle');
await page.waitForTimeout(900);
check('tela de segmentos abre', /Segmentos/.test(await page.textContent('body')));
check('explica que é regra, não lista', /definidos por regra/.test(await page.textContent('body')));

await page.click('button:has-text("Criar segmento")');
await page.waitForTimeout(700);
const editor = await page.textContent('body');
check('editor abre com uma regra', /Regras/.test(editor));
check('avisa que sem regra pegaria todo mundo', /pegaria todo mundo/.test(editor));

// Saving must be refused while the rule is incomplete.
// Found by label rather than by position: the first input on the page belongs
// to the sidebar, and so does the first select.
await page.getByLabel('Nome do segmento').fill('Clientes ativos');
await page.waitForTimeout(300);
const saveButton = page.locator('button:has-text("Criar segmento")').last();
check('salvar bloqueado enquanto a regra está incompleta', await saveButton.isDisabled());

// Complete it: contact status is set.
await page.getByLabel('Verificar').selectOption('contact');
await page.waitForTimeout(300);
await page.getByLabel('Qual').selectOption('status');
await page.waitForTimeout(300);
check('salvar liberado com a regra completa', !(await saveButton.isDisabled()));

// The count has to come from the real contacts, on demand.
await page.click('button:has-text("Ver quantos se encaixam")');
await page.waitForTimeout(1800);
const previewed = await page.textContent('body');
check('mostra quantos se encaixam', /se encaixam nestas regras agora/.test(previewed));
check('diz que contou sobre contatos reais', /contatos reais desta conta/.test(previewed));

await saveButton.click();
await page.waitForTimeout(1800);
check('segmento criado aparece na lista', /Clientes ativos/.test(await page.textContent('body')));

await page.reload();
await page.waitForLoadState('networkidle');
await page.waitForTimeout(900);
check('segmento persiste depois de recarregar', /Clientes ativos/.test(await page.textContent('body')));

// Reopening must show the rule that was saved, not an empty editor.
await page.click('button:has-text("Editar")');
await page.waitForTimeout(900);
check('reabrir traz a regra salva', (await page.getByLabel('Qual').inputValue()) === 'status');

await browser.close();
console.log(failures.length === 0 ? '\nTUDO PASSOU' : `\n${failures.length} FALHA(S): ${failures.join(', ')}`);
process.exit(failures.length === 0 ? 0 : 1);
