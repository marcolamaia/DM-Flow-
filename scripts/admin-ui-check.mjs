import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const email = readFileSync('/tmp/admin-email.txt', 'utf8').trim();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FALHOU'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures.push(name);
};

page.on('console', (msg) => {
  if (msg.type() === 'error') console.log('  [console] ' + msg.text().slice(0, 200));
});

await page.goto('http://localhost:3000/login');
await page.fill('input[type=email]', email);
await page.fill('input[type=password]', 'senhaforte123');
await page.click('button[type=submit]');
await page.waitForURL('**/dashboard', { timeout: 20000 });
check('entra na plataforma', true);

// The admin link should be offered to somebody who has the grant.
const link = page.locator('a[href="/admin"]');
await link.waitFor({ timeout: 10000 }).catch(() => {});
check('link do painel aparece para admin', await link.count() > 0);

await page.goto('http://localhost:3000/admin');
await page.waitForLoadState('networkidle');
const body = await page.textContent('body');
check('visão geral carrega', body.includes('Visão geral'), '');
check('mostra MRR', /Receita recorrente mensal/i.test(body));
check('declara o fuso do relatório', /America\/Sao_Paulo/.test(body));
check('explica como cada número é calculado', /Como este número é calculado/i.test(body));
check('não mostra erro de acesso', !/não está disponível/i.test(body));

await page.goto('http://localhost:3000/admin/users');
await page.waitForLoadState('networkidle');
const usersBody = await page.textContent('body');
check('lista de contas carrega', /Contas/.test(usersBody));
const rows = await page.locator('a[href^="/admin/users/"]').count();
check('lista traz contas', rows > 0, `${rows} linhas`);

// Search narrows the list.
await page.fill('input[placeholder*="Buscar"]', email.split('@')[0]);
await page.waitForTimeout(1200);
const afterSearch = await page.locator('a[href^="/admin/users/"]').count();
check('busca filtra a lista', afterSearch > 0 && afterSearch < rows, `${afterSearch} de ${rows}`);

await page.locator('a[href^="/admin/users/"]').first().click();
// networkidle is not enough here: the fetch that fills this page starts after
// the route settles, so the assertions were reading an empty shell.
await page.locator('button:has-text("Bloquear conta")').waitFor({ timeout: 15000 });
const detail = await page.textContent('body');
check('detalhe da conta abre', /Workspaces/.test(detail));
check('detalhe não vaza hash de senha', !/argon2/.test(detail));
check('oferece bloquear a conta', /Bloquear conta/.test(detail));

// The dialog must refuse to submit without a reason.
await page.click('button:has-text("Bloquear conta")');
await page.waitForTimeout(400);
const confirm = page.locator('button:has-text("Bloquear")').last();
check('botão de confirmar começa desabilitado sem motivo', await confirm.isDisabled());
await page.fill('textarea', 'curto');
await page.waitForTimeout(200);
check('motivo curto demais continua bloqueando', await confirm.isDisabled());
await page.fill('textarea', 'Teste automatizado do painel administrativo');
await page.waitForTimeout(200);
check('motivo suficiente libera a ação', !(await confirm.isDisabled()));
await page.click('button:has-text("Cancelar")');

await page.goto('http://localhost:3000/admin/subscriptions');
await page.waitForLoadState('networkidle');
const subs = await page.textContent('body');
check('assinaturas carregam', /Assinaturas/.test(subs));
check('mostra valor mensal em reais', /R\$/.test(subs));

await page.goto('http://localhost:3000/admin/audit');
await page.waitForLoadState('networkidle');
const audit = await page.textContent('body');
check('registro de ações carrega', /Registro de ações/.test(audit));
check('diz que é somente leitura', /Somente leitura/.test(audit));

// ── And now the check that matters most: somebody without the grant ──
const customerEmail = `cliente-ui-${Date.now()}@test.local`;
const guest = await browser.newContext();
const other = await guest.newPage();

await other.goto('http://localhost:3000/register');
// The name field carries no type, so it is the first input on the form.
const inputs = other.locator('form input');
await inputs.nth(0).fill('Cliente Comum');
await other.fill('input[type=email]', customerEmail);
await other.fill('input[type=password]', 'senhaforte123');
await other.click('button[type=submit]');
await other.waitForURL('**/dashboard', { timeout: 20000 });

await other.waitForTimeout(1500);
check('conta comum não recebe link do painel', (await other.locator('a[href="/admin"]').count()) === 0);

await other.goto('http://localhost:3000/admin');
await other.waitForLoadState('networkidle');
await other.waitForTimeout(1000);
const denied = await other.textContent('body');
check('conta comum é barrada no painel', /não está disponível/i.test(denied));
// A 403 would confirm the area exists; the API answers 404 and the screen says
// nothing either way.
check('recusa não revela nada sobre o painel', !/SUPER_ADMIN|permission|MRR/i.test(denied));

await browser.close();
console.log(failures.length === 0 ? '\nTUDO PASSOU' : `\n${failures.length} FALHA(S): ${failures.join(', ')}`);
process.exit(failures.length === 0 ? 0 : 1);
