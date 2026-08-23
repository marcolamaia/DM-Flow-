import { chromium } from 'playwright';

const API = 'http://localhost:4000';
const WEB = 'http://localhost:3000';
const email = `recupera-${Date.now()}@test.local`;
const oldPassword = 'senhaantiga123';
const newPassword = 'senhanovinha456';

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FALHOU'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures.push(name);
};

// A real account to lock out and recover.
const reg = await fetch(`${API}/auth/register`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password: oldPassword, name: 'Pessoa Que Esqueceu' }),
});
check('conta criada', reg.status === 201);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

// 1. The link has to exist on the login screen at all.
await page.goto(`${WEB}/login`);
await page.waitForLoadState('networkidle');
const forgotLink = page.locator('a[href="/forgot-password"]');
check('login oferece "esqueci minha senha"', (await forgotLink.count()) > 0);

await forgotLink.click();
await page.waitForURL('**/forgot-password');
check('tela de recuperação abre', /Recuperar sua senha/.test(await page.textContent('body')));

// 2. Asking for the link.
await page.fill('input[type=email]', email);
await page.click('button[type=submit]');
await page.waitForTimeout(1500);
const afterAsk = await page.textContent('body');
check('confirma o envio', /link já está a caminho|link j. est. a caminho/.test(afterAsk));
// It must not reveal whether the address exists.
check('não revela se a conta existe', /Se existir uma conta/.test(afterAsk));

// An unknown address must produce the identical answer.
await page.goto(`${WEB}/forgot-password`);
await page.fill('input[type=email]', `ninguem-${Date.now()}@test.local`);
await page.click('button[type=submit]');
await page.waitForTimeout(1200);
check('endereço desconhecido responde igual', /Se existir uma conta/.test(await page.textContent('body')));

// 3. The token from the mail log — in this installation mail is written, not sent.
const token = await (async () => {
  const res = await fetch(`${API}/auth/password/forgot`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const body = await res.json();
  return body.token ?? null;
})();
check('token emitido', Boolean(token));

// 4. An incomplete link must say so instead of showing an empty form.
await page.goto(`${WEB}/reset-password`);
await page.waitForLoadState('networkidle');
await page.waitForTimeout(600);
check('link sem token é explicado', /incompleto/.test(await page.textContent('body')));

// 5. The real link.
await page.goto(`${WEB}/reset-password?token=${token}`);
await page.waitForLoadState('networkidle');
await page.waitForTimeout(600);
check('link do e-mail abre o formulário', /Criar uma senha nova/.test(await page.textContent('body')));

// Two different passwords must be refused before the request leaves the browser.
const inputs = page.locator('form input[type=password]');
await inputs.nth(0).fill(newPassword);
await inputs.nth(1).fill('outracoisa999');
await page.waitForTimeout(300);
check('senhas diferentes bloqueiam o envio', await page.locator('button[type=submit]').isDisabled());

await inputs.nth(1).fill(newPassword);
await page.waitForTimeout(300);
await page.click('button[type=submit]');
await page.waitForTimeout(2000);
const done = await page.textContent('body');
check('senha alterada', /Senha alterada/.test(done));
// Being signed out everywhere looks like a bug unless somebody says it is the point.
check('avisa que desconectou todos os aparelhos', /aparelhos/.test(done));

// 6. The token must not work twice.
await page.goto(`${WEB}/reset-password?token=${token}`);
await page.waitForLoadState('networkidle');
await page.waitForTimeout(600);
await page.locator('form input[type=password]').nth(0).fill('maisumasenha789');
await page.locator('form input[type=password]').nth(1).fill('maisumasenha789');
await page.click('button[type=submit]');
await page.waitForTimeout(2000);
check('token não funciona duas vezes', !/Senha alterada/.test(await page.textContent('body')));

// 7. What actually matters: the new password works and the old one does not.
const withNew = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password: newPassword }),
});
check('entra com a senha nova', withNew.status === 201, `status ${withNew.status}`);

const withOld = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password: oldPassword }),
});
check('senha antiga não entra mais', withOld.status === 401, `status ${withOld.status}`);

await browser.close();
console.log(failures.length === 0 ? '\nTUDO PASSOU' : `\n${failures.length} FALHA(S): ${failures.join(', ')}`);
process.exit(failures.length === 0 ? 0 : 1);
