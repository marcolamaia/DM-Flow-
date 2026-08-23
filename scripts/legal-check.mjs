import { chromium } from 'playwright';

const WEB = 'http://localhost:3000';
const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FALHOU'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures.push(name);
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
// Contexto novo, sem sessão. É assim que a Meta e o Stripe vão acessar.
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });

for (const [path, titulo] of [['/privacidade', 'Política de privacidade'], ['/termos', 'Termos de uso']]) {
  const res = await page.goto(WEB + path);
  await page.waitForLoadState('networkidle');
  check(`${path} responde 200 sem login`, res?.status() === 200, `status ${res?.status()}`);
  const body = await page.textContent('body');
  check(`${path} mostra o título`, body.includes(titulo));
  // Não pode redirecionar para o login: quem lê isto normalmente não tem conta.
  check(`${path} não manda para o login`, !page.url().includes('/login'), page.url());
}

// O conteúdo tem que ser honesto sobre o que ainda não existe.
await page.goto(`${WEB}/privacidade`);
await page.waitForLoadState('networkidle');
const priv = await page.textContent('body');
check('avisa que a exclusão automática ainda não existe', /ainda não está implementada|ainda n.o est. implementada/.test(priv));
check('avisa que o pedido LGPD é manual hoje', /atendido manualmente/.test(priv));
check('diz que senha nem nós conseguimos ler', /nem nós conseguimos|nem n.s conseguimos/.test(priv));
check('diz que cartão não passa pelos servidores', /nunca passam pelos nossos servidores/.test(priv));
check('separa cliente de contato do cliente', /em nome do cliente/.test(priv));
// Os campos que só o Marcos pode preencher precisam estar visíveis, não escondidos.
const marcados = await page.locator('mark').count();
check('campos a preencher estão destacados', marcados >= 3, `${marcados} marcações`);

await page.goto(`${WEB}/termos`);
await page.waitForLoadState('networkidle');
const termos = await page.textContent('body');
check('termos proíbem mensagem não solicitada', /não solicitada|n.o solicitada/.test(termos));
check('termos dizem que não somos afiliados à Meta', /não é afiliada|n.o . afiliada/.test(termos));
check('termos explicam a tolerância antes de suspender', /tolerância antes de qualquer suspensão|toler.ncia antes de qualquer suspens.o/.test(termos));

// E os links precisam estar onde alguém de fora encontra.
await page.goto(`${WEB}/login`);
await page.waitForLoadState('networkidle');
check('login tem link da política', (await page.locator('a[href="/privacidade"]').count()) > 0);
check('login tem link dos termos', (await page.locator('a[href="/termos"]').count()) > 0);

await page.goto(`${WEB}/register`);
await page.waitForLoadState('networkidle');
check('cadastro mostra o aceite', /Ao criar a conta você concorda|Ao criar a conta voc. concorda/.test(await page.textContent('body')));

await browser.close();
console.log(failures.length === 0 ? '\nTUDO PASSOU' : `\n${failures.length} FALHA(S): ${failures.join(', ')}`);
process.exit(failures.length === 0 ? 0 : 1);
