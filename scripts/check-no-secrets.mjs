#!/usr/bin/env node
/**
 * Recusa publicar código com segredo dentro.
 *
 * Segredo em repositório não se conserta apagando o arquivo: quem já clonou
 * continua com ele, e o histórico do Git guarda a versão antiga para sempre. A
 * única correção real é revogar a chave e emitir outra. Por isso esta
 * verificação roda antes, e não depois.
 *
 * Olha só o que está versionado — `git ls-files`. O `.env` da máquina de quem
 * desenvolve está no `.gitignore` e não aparece aqui; se algum dia aparecer, é
 * exatamente isso que precisa quebrar a conferência.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const PADROES = [
  // Chaves do Stripe. A de produção é a que move dinheiro; a de teste não move,
  // mas dá acesso à conta de teste e não tem por que estar aqui.
  { nome: 'chave de produção do Stripe', re: /\b[sr]k_live_[A-Za-z0-9]{16,}/ },
  { nome: 'chave de teste do Stripe', re: /\b[sr]k_test_[A-Za-z0-9]{16,}/ },
  { nome: 'segredo de webhook do Stripe', re: /\bwhsec_[A-Za-z0-9]{16,}/ },

  // Token da Meta. O formato começa com o id do app e um caractere de barra.
  { nome: 'token de acesso da Meta', re: /\bEAA[A-Za-z0-9]{40,}/ },

  // Chaves privadas de qualquer formato.
  { nome: 'chave privada', re: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },

  { nome: 'credencial da AWS', re: /\b(AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { nome: 'token do GitHub', re: /\bgh[pousr]_[A-Za-z0-9]{36,}/ },
  { nome: 'chave da OpenAI', re: /\bsk-(proj-)?[A-Za-z0-9_-]{32,}/ },
  { nome: 'chave da Anthropic', re: /\bsk-ant-[A-Za-z0-9_-]{32,}/ },

  // Senha embutida numa URL de conexão. `dmflow:dmflow` e `postgres:postgres`
  // são as credenciais do banco local, iguais em toda máquina, e não contam.
  {
    nome: 'senha dentro de uma URL de conexão',
    re: /\b(postgres(ql)?|redis|mongodb|amqps?|smtps?):\/\/[^\s:@/]+:[^\s:@/]+@/,
    ignorar: (t) =>
      /:\/\/(dmflow:dmflow|postgres:postgres|user:pass(word)?|usuario:senha|:)@/.test(t),
  },
];

/**
 * A chave de cifra é 64 caracteres hexadecimais. Um valor de exemplo — só
 * zeros, ou a linha do `.env.example` — é o que deve estar versionado. Uma
 * chave de verdade nesse formato é o pior caso do repositório inteiro: quem a
 * tiver lê todo token de canal e todo segundo fator já guardados.
 */
const CHAVE_DE_CIFRA = /ENCRYPTION_KEY\s*[=:]\s*['"]?([0-9a-fA-F]{64})['"]?/g;

const EXTENSOES_BINARIAS = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|woff2?|ttf|eot|mp4|mp3)$/i;

// Arquivos que existem para falar sobre segredos. Um documento que explica o
// formato de uma chave não é uma chave — mas o `.env` de verdade, se algum dia
// for versionado, não está nesta lista e vai quebrar a conferência.
const ARQUIVOS_QUE_FALAM_DE_SEGREDO = new Set([
  'scripts/check-no-secrets.mjs',
  '.env.example',
  'ENVIRONMENT_VARIABLES.md',
  'SECURITY.md',
]);

const LIMITE_DE_TAMANHO = 2_000_000;

const arquivos = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const achados = [];

// Um `.env` versionado é achado por si só, sem precisar casar padrão nenhum:
// ele existe para guardar segredo.
for (const arquivo of arquivos) {
  const base = arquivo.split('/').pop();
  if (base === '.env' || (base.startsWith('.env.') && !base.endsWith('.example'))) {
    achados.push({ arquivo, linha: 0, o_que: 'arquivo .env versionado', trecho: base });
  }
}

for (const arquivo of arquivos) {
  if (EXTENSOES_BINARIAS.test(arquivo)) continue;
  if (ARQUIVOS_QUE_FALAM_DE_SEGREDO.has(arquivo)) continue;

  let tamanho;
  try {
    tamanho = statSync(arquivo).size;
  } catch {
    continue; // apagado no índice, mas ainda listado
  }
  if (tamanho > LIMITE_DE_TAMANHO) continue;

  let conteudo;
  try {
    conteudo = readFileSync(arquivo, 'utf8');
  } catch {
    continue;
  }
  if (conteudo.includes('\0')) continue;

  const linhas = conteudo.split('\n');
  linhas.forEach((linha, indice) => {
    for (const { nome, re, ignorar } of PADROES) {
      const casou = linha.match(re);
      if (!casou) continue;
      if (ignorar?.(linha)) continue;
      achados.push({
        arquivo,
        linha: indice + 1,
        o_que: nome,
        // Só o começo: escrever o segredo inteiro no log da conferência seria
        // publicá-lo outra vez, agora num lugar que não dá para apagar.
        trecho: `${casou[0].slice(0, 12)}…`,
      });
    }
  });

  for (const casou of conteudo.matchAll(CHAVE_DE_CIFRA)) {
    const valor = casou[1];
    if (/^0+$/.test(valor)) continue;
    const antes = conteudo.slice(0, casou.index).split('\n');
    achados.push({
      arquivo,
      linha: antes.length,
      o_que: 'ENCRYPTION_KEY com valor que não é o de exemplo',
      trecho: `${valor.slice(0, 8)}…`,
    });
  }
}

if (achados.length === 0) {
  console.log(`Nenhum segredo versionado. ${arquivos.length} arquivos conferidos.`);
  process.exit(0);
}

console.error(`\n${achados.length} possível(is) segredo(s) versionado(s):\n`);
for (const a of achados) {
  console.error(`  ${a.arquivo}:${a.linha}  ${a.o_que}  ${a.trecho}`);
}
console.error(
  '\nApagar o arquivo não resolve: o histórico do Git guarda a versão antiga, e\n' +
    'quem já clonou continua com ela. Revogue a chave, emita outra, e só então\n' +
    'tire o valor daqui.\n',
);
process.exit(1);
