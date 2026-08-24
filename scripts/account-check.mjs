/**
 * Trocar o e-mail e excluir a conta, num navegador de verdade.
 *
 * Os testes da API provam que as regras valem. Isto prova outra coisa: que a
 * pessoa consegue chegar lá, entender o que vai acontecer, e que a tela conta a
 * verdade sobre o que acontece — inclusive a parte que confunde todo mundo, que
 * é o e-mail NÃO mudar na hora de salvar.
 *
 * Precisa da plataforma no ar. Cada execução cria as próprias contas.
 */
import { chromium } from 'playwright';

const API = 'http://localhost:4000';
const WEB = 'http://localhost:3000';
const stamp = Date.now();
const senha = 'senhaforte123';

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FALHOU'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures.push(name);
};

// Endereço próprio por execução: o limite de credencial conta por origem, e sem
// isto a segunda execução deste arquivo esbarra no balde que a primeira encheu.
const runPrefix = `${1 + Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 256)}`;
let addressCounter = 0;
const freshAddress = () => `10.${runPrefix}.${(addressCounter += 1)}`;

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});

async function novaAba() {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 980 },
    extraHTTPHeaders: { 'X-Forwarded-For': freshAddress() },
  });
  return { context, page: await context.newPage() };
}

async function cadastrar(page, email, nome) {
  await page.goto(`${WEB}/register`);
  await page.locator('form input').nth(0).fill(nome);
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', senha);
  await page.click('button[type=submit]');
  await page.waitForURL('**/dashboard', { timeout: 25000 });
}

// ── Parte 1: trocar o e-mail ─────────────────────────────────

const emailA = `conta-troca-${stamp}@test.local`;
const emailNovo = `conta-troca-novo-${stamp}@test.local`;
const a = await novaAba();

await cadastrar(a.page, emailA, 'Pessoa Que Troca');

await a.page.goto(`${WEB}/settings/security`);
await a.page.waitForLoadState('networkidle');
await a.page.waitForTimeout(1200);

let corpo = await a.page.textContent('body');
check('a tela de segurança mostra o e-mail atual', corpo.includes(emailA));
check(
  'avisa que o e-mail não muda na hora',
  /NÃO muda agora|N.O muda agora/.test(corpo),
);
check('explica por que pede a senha', /tomar uma conta/.test(corpo));

// Pedir a troca.
await a.page.fill('input[type=email]', emailNovo);
await a.page.locator('form:has(input[type=email]) input[type=password]').first().fill(senha);
await a.page.click('button:has-text("Pedir a troca")');
await a.page.waitForTimeout(2200);

corpo = await a.page.textContent('body');
check('confirma que o link foi enviado', /Link enviado/.test(corpo));
check(
  'mostra o endereço mascarado, não o endereço inteiro',
  !corpo.includes(emailNovo) && /@test\.local/.test(corpo),
);
check('o e-mail da conta continua o antigo na tela', corpo.includes(emailA));

// E continua o antigo no servidor — que é o que realmente importa.
const meAntes = await fetch(`${API}/auth/me`, {
  headers: {
    Cookie: (await a.context.cookies()).map((c) => `${c.name}=${c.value}`).join('; '),
    'X-Forwarded-For': freshAddress(),
  },
}).then((r) => r.json());
check('o servidor também mantém o e-mail antigo', meAntes.user.email === emailA);

// O pedido sobrevive a recarregar a página.
await a.page.reload({ waitUntil: 'networkidle' });
await a.page.waitForTimeout(1500);
corpo = await a.page.textContent('body');
check('o pedido pendente aparece depois de recarregar', /esperando confirmação|esperando confirma..o/.test(corpo));
check('oferece cancelar a troca', (await a.page.locator('button:has-text("Cancelar essa troca")').count()) > 0);

// Cancelar de verdade.
await a.page.click('button:has-text("Cancelar essa troca")');
await a.page.waitForTimeout(1800);
corpo = await a.page.textContent('body');
check('cancelar some com o aviso de pendência', !/esperando confirmação|esperando confirma..o/.test(corpo));

// ── Parte 2: excluir a conta ─────────────────────────────────

corpo = await a.page.textContent('body');
check('a tela oferece excluir a conta', /Excluir minha conta/.test(corpo));
check('avisa que não há período de arrependimento', /não tem desfazer|n.o tem desfazer/.test(corpo));
check('lista o que vai ser apagado', /O que vai ser apagado agora/.test(corpo));
check('diz quantos aparelhos serão desconectados', /aparelhos conectados ser.o desconectados/.test(corpo));

// O botão de confirmar só libera com o e-mail digitado certo.
await a.page.click('button:has-text("Quero excluir minha conta")');
await a.page.waitForTimeout(700);

const confirmar = a.page.locator('button:has-text("Excluir para sempre")');
check('o botão de excluir começa desabilitado', await confirmar.isDisabled());

const formExcluir = a.page.locator('form:has(button:has-text("Excluir para sempre"))');
await formExcluir.locator('input').first().fill('email-errado@test.local');
await formExcluir.locator('input[type=password]').fill(senha);
await a.page.waitForTimeout(500);
check('e-mail errado mantém o botão travado', await confirmar.isDisabled());

await formExcluir.locator('input').first().fill(emailA);
await a.page.waitForTimeout(500);
check('e-mail certo libera o botão', !(await confirmar.isDisabled()));

// ── Parte 3: a página que o link do e-mail abre ──────────────
//
// O caminho que só o navegador prova: a pessoa clica no link que chegou na
// caixa NOVA, a troca se efetiva, e a partir daí o endereço antigo não entra
// mais.
//
// O pedido é feito pela API para pegar o token — com MAIL_TRANSPORT=log ele
// volta na resposta. Não é atalho: o que está sendo testado aqui é a página de
// confirmação e o efeito dela, não o formulário, que a parte 1 já cobriu.
//
// O impedimento do último proprietário NÃO está aqui: montá-lo exige uma
// segunda pessoa na mesma área, e o plano gratuito recusa o convite com 402 —
// que é o produto funcionando certo. Esse caminho é coberto pelos testes da
// API, onde dá para montar a equipe direto no banco.

const emailB = `conta-confirma-${stamp}@test.local`;
const emailBNovo = `conta-confirma-novo-${stamp}@test.local`;
const b = await novaAba();
await cadastrar(b.page, emailB, 'Pessoa Que Confirma');

const cookiesB = (await b.context.cookies()).map((c) => `${c.name}=${c.value}`).join('; ');
const pedido = await fetch(`${API}/account/email`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    Cookie: cookiesB,
    'X-Forwarded-For': freshAddress(),
  },
  body: JSON.stringify({ newEmail: emailBNovo, password: senha }),
}).then((r) => r.json());

check('o pedido devolve o token no modo de desenvolvimento', Boolean(pedido.token));
check(
  'a resposta da API não devolve o endereço novo em claro',
  !JSON.stringify(pedido).includes(emailBNovo.split('@')[0]),
);

await b.page.goto(`${WEB}/confirm-email-change?token=${encodeURIComponent(pedido.token)}`);
await b.page.waitForLoadState('networkidle');
await b.page.waitForTimeout(2500);

const corpoConfirma = await b.page.textContent('body');
check('a página de confirmação diz que deu certo', /E-mail trocado/.test(corpoConfirma));
check('mostra o endereço novo já valendo', corpoConfirma.includes(emailBNovo));
check(
  'avisa que todos os aparelhos foram desconectados',
  /todos os aparelhos foram desconectados/.test(corpoConfirma),
);

// O endereço antigo não entra mais.
const loginAntigo = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'X-Forwarded-For': freshAddress() },
  body: JSON.stringify({ email: emailB, password: senha }),
});
check('o endereço antigo deixa de entrar', loginAntigo.status === 401, `HTTP ${loginAntigo.status}`);

// O novo entra.
const loginNovo = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'X-Forwarded-For': freshAddress() },
  body: JSON.stringify({ email: emailBNovo, password: senha }),
});
check('o endereço novo entra', loginNovo.status === 201, `HTTP ${loginNovo.status}`);

// E o link não serve duas vezes.
await b.page.goto(`${WEB}/confirm-email-change?token=${encodeURIComponent(pedido.token)}`);
await b.page.waitForLoadState('networkidle');
await b.page.waitForTimeout(2000);
check('o mesmo link não funciona de novo', /Não deu para trocar|N.o deu para trocar/.test(await b.page.textContent('body')));

// ── Parte 4: excluir de verdade ──────────────────────────────

await a.page.click('button:has-text("Excluir para sempre")');
await a.page.waitForURL('**/login**', { timeout: 20000 }).catch(() => {});
check('excluir leva de volta para o login', a.page.url().includes('/login'));

// A sessão tem que estar morta no servidor, não só na tela.
const depois = await fetch(`${API}/auth/me`, {
  headers: {
    Cookie: (await a.context.cookies()).map((c) => `${c.name}=${c.value}`).join('; '),
    'X-Forwarded-For': freshAddress(),
  },
});
check('a sessão morreu no servidor', depois.status === 401, `HTTP ${depois.status}`);

// E não dá para entrar de novo com a mesma senha.
const relogin = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'X-Forwarded-For': freshAddress() },
  body: JSON.stringify({ email: emailA, password: senha }),
});
check('a conta não entra mais', relogin.status === 401, `HTTP ${relogin.status}`);

await browser.close();

console.log('');
if (failures.length) {
  console.log(`${failures.length} FALHA(S): ${failures.join(', ')}`);
  process.exit(1);
}
console.log('TUDO PASSOU');
