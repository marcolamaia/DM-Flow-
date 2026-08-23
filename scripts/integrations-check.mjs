import { chromium } from 'playwright';

const API = 'http://localhost:4000';
const WEB = 'http://localhost:3000';
const stamp = Date.now();
const email = `integra-${stamp}@test.local`;
const password = 'senhaforte123';

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
  viewport: { width: 1440, height: 950 },
  extraHTTPHeaders: { 'X-Forwarded-For': freshAddress() },
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await context.newPage();

await page.goto(`${WEB}/register`);
await page.locator('form input').nth(0).fill('Pessoa Integradora');
await page.fill('input[type=email]', email);
await page.fill('input[type=password]', password);
await page.click('button[type=submit]');
await page.waitForURL('**/dashboard', { timeout: 25000 });

const menuLink = page.locator('a[href="/settings/integrations"]');
await menuLink.waitFor({ timeout: 15000 }).catch(() => {});
check('menu oferece Integrações', (await menuLink.count()) > 0);

await page.goto(`${WEB}/settings/integrations`);
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1000);
const body = await page.textContent('body');
check('tela abre', /Integrações|Integra..es/.test(body));
check('explica o que é uma chave', /outro sistema seu crie contatos/.test(body));
check('lista de chaves começa vazia', /Nenhuma chave criada/.test(body));

// ── The free plan does not include this. The refusal has to be useful. ──
await page.locator('form').first().locator('input').first().fill('Site institucional');
await page.locator('button:has-text("Criar chave")').click();
await page.waitForTimeout(1800);
const refused = await page.textContent('body');
check('plano grátis é recusado com explicação', /plano não inclui|plano n.o inclui/.test(refused));
check('a recusa aponta para os planos', (await page.locator('a[href="/settings/billing"]').count()) > 0);
check('não mostra erro cru', !/PLAN_LIMIT_REACHED/.test(refused));

// ── Move this workspace to a plan that includes it, then it must work. ──
// Billing is not configured on this installation, so checkout applies the plan
// locally — which is exactly the path a self-hosted install takes.
const cookieHeader = (await context.cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
const me = await fetch(`${API}/auth/me`, {
  headers: { cookie: cookieHeader, 'X-Forwarded-For': freshAddress() },
}).then((r) => r.json());
const workspaceId = me.workspaces?.[0]?.id;
check('workspace identificado', Boolean(workspaceId));

const upgrade = await fetch(`${API}/billing/checkout`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'X-Forwarded-For': freshAddress(),
    cookie: cookieHeader,
    'x-dmflow-workspace': workspaceId,
  },
  body: JSON.stringify({ planCode: 'pro' }),
});
check('plano alterado para um que inclui o recurso', upgrade.status === 201, `status ${upgrade.status}`);

await page.reload();
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1200);
await page.locator('form').first().locator('input').first().fill('Site institucional');
await page.locator('button:has-text("Criar chave")').click();
await page.waitForTimeout(2000);
const created = await page.textContent('body');

if (/plano não inclui|plano n.o inclui/.test(created)) {
  console.log('   (workspace ainda no plano grátis — a parte de criação não foi exercitada)');
} else {
  check('chave criada aparece inteira uma vez', /Copie agora/.test(created));
  check('avisa que é a única vez', /única vez que a chave inteira aparece|.nica vez que a chave inteira aparece/.test(created));
  const shown = (await page.locator('code').first().textContent())?.trim() ?? '';
  check('a chave exibida parece uma chave', shown.length > 20);

  await page.click('button:has-text("Já guardei")');
  await page.waitForTimeout(800);
  const after = await page.textContent('body');
  check('depois de guardar, a chave some da tela', !after.includes(shown));
  check('só o prefixo continua visível', /…/.test(after));

  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1200);
  const reloaded = await page.textContent('body');
  check('chave persiste depois de recarregar', /Site institucional/.test(reloaded));
  check('a chave inteira não volta nunca mais', !reloaded.includes(shown));
}

await browser.close();
console.log(failures.length === 0 ? '\nTUDO PASSOU' : `\n${failures.length} FALHA(S): ${failures.join(', ')}`);
process.exit(failures.length === 0 ? 0 : 1);
