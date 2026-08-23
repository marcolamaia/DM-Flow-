import { chromium } from 'playwright';
import { createRequire } from 'node:module';

const require = createRequire('/home/user/DM-Flow-/apps/api/');
const { authenticator } = require('otplib');

const API = 'http://localhost:4000';
const WEB = 'http://localhost:3000';
const stamp = Date.now();
const email = `seguranca-${stamp}@test.local`;
const password = 'senhaforte123';
const newPassword = 'outrasenhaforte456';

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FALHOU'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures.push(name);
};

// Every run gets its own source address. The credential rate limit counts by
// origin and is doing exactly its job — without this, a second run of this very
// file exhausts the bucket the first one filled and every check after the wrong
// code reads as a broken feature.
const runPrefix = `${1 + Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 256)}`;
let addressCounter = 0;
const freshAddress = () => `10.${runPrefix}.${(addressCounter += 1)}`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const context = await browser.newContext({
  viewport: { width: 1440, height: 950 },
  extraHTTPHeaders: { 'X-Forwarded-For': freshAddress() },
});
const page = await context.newPage();

const call = (path, body) =>
  fetch(API + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Forwarded-For': freshAddress() },
    body: JSON.stringify(body),
  });

await page.goto(`${WEB}/register`);
await page.locator('form input').nth(0).fill('Pessoa Segura');
await page.fill('input[type=email]', email);
await page.fill('input[type=password]', password);
await page.click('button[type=submit]');
await page.waitForURL('**/dashboard', { timeout: 25000 });

// The screen has to be reachable from the menu, not only by typing the URL.
// Waited for rather than counted immediately: the sidebar renders after the
// session query resolves, and checking too early reads an empty shell.
const menuLink = page.locator('a[href="/settings/security"]');
await menuLink.waitFor({ timeout: 15000 }).catch(() => {});
check('menu oferece Segurança', (await menuLink.count()) > 0);

await page.goto(`${WEB}/settings/security`);
await page.waitForLoadState('networkidle');
await page.waitForTimeout(900);
const body = await page.textContent('body');
check('tela de segurança abre', /Segurança|Seguran.a/.test(body));
check('avisa que trocar a senha desconecta tudo', /desconecta todos os aparelhos/.test(body));
check('segundo fator começa desativado', /Desativada/.test(body));

// ── Turning on the second factor ──
await page.click('button:has-text("Ativar")');
await page.waitForTimeout(1800);
const enrolling = await page.textContent('body');
check('mostra QR para escanear', (await page.locator('img[src^="data:image"]').count()) > 0);
check('oferece o código manual', /Não consegue escanear|N.o consegue escanear/.test(enrolling));
check('avisa sobre perder o acesso', /só o suporte consegue devolver|s. o suporte consegue devolver/.test(enrolling));

const secret = (await page.locator('code').first().textContent())?.trim();
check('código manual foi exibido', Boolean(secret) && secret.length > 10);

// A wrong code must be refused.
await page.locator('input[inputmode="numeric"]').fill('000000');
await page.click('button:has-text("Confirmar e ativar")');
await page.waitForTimeout(1500);
check('código errado é recusado', !/Verificação em duas etapas ativada/.test(await page.textContent('body')));

// The real one, generated from the secret the screen showed.
await page.locator('input[inputmode="numeric"]').fill(authenticator.generate(secret));
await page.click('button:has-text("Confirmar e ativar")');
await page.waitForTimeout(2000);
const afterEnable = await page.textContent('body');
check('segundo fator ativado', /Ativada/.test(afterEnable));

// ── It has to actually change how login works ──
const onlyPassword = await call('/auth/login', { email, password });
const onlyPasswordBody = await onlyPassword.json();
check(
  'login só com senha passa a exigir o código',
  onlyPassword.status !== 201 && /TOTP/i.test(JSON.stringify(onlyPasswordBody)),
  `status ${onlyPassword.status}`,
);

const withCode = await call('/auth/login', { email, password, totp: authenticator.generate(secret) });
check('login com senha e código funciona', withCode.status === 201, `status ${withCode.status}`);

// ── Changing the password ──
await page.reload();
await page.waitForLoadState('networkidle');
await page.waitForTimeout(900);
const fields = page.locator('form input[type=password]');
await fields.nth(0).fill(password);
await fields.nth(1).fill(newPassword);
await fields.nth(2).fill('naoconfere999');
await page.waitForTimeout(300);
check('senhas diferentes bloqueiam o envio', await page.locator('button:has-text("Trocar senha")').isDisabled());

await fields.nth(2).fill(newPassword);
await page.waitForTimeout(300);
await page.click('button:has-text("Trocar senha")');
await page.waitForTimeout(2500);
check('senha alterada', /Senha alterada/.test(await page.textContent('body')));

// What actually matters.
const oldTry = await call('/auth/login', { email, password, totp: authenticator.generate(secret) });
check('senha antiga não entra mais', oldTry.status === 401, `status ${oldTry.status}`);

const newTry = await call('/auth/login', { email, password: newPassword, totp: authenticator.generate(secret) });
check('senha nova entra', newTry.status === 201, `status ${newTry.status}`);

await browser.close();
console.log(failures.length === 0 ? '\nTUDO PASSOU' : `\n${failures.length} FALHA(S): ${failures.join(', ')}`);
process.exit(failures.length === 0 ? 0 : 1);
