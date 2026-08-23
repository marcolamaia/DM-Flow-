# Publicar a DM FLOW na Heroku

Passo a passo do que precisa ser feito, e de quem faz cada parte.

---

## Antes de tudo: são DOIS apps, não um

A DM FLOW tem dois servidores HTTP — a API e o site. Cada app da Heroku expõe
**uma** porta. Então:

| App na Heroku | O que roda | Processos |
|---|---|---|
| `dmflow-api` | Backend, worker e agendador | `web`, `worker`, `release` |
| `dmflow-web` | O site em Next.js | `web` |

Os dois apontam para o **mesmo repositório**. A Heroku constrói o monorepo
inteiro nos dois, o que gasta alguns minutos a mais de build e em troca torna
impossível os dois ficarem fora de sincronia.

O `worker` é um processo separado de propósito: automação com espera de horas
não pode ocupar um processo que precisa responder requisição HTTP em segundos.

---

## AÇÃO NECESSÁRIA — MARCOS

### Serviço: Heroku
**O que precisamos:** dois apps e um Redis.
**Por que precisamos:** é onde a plataforma vai rodar.

1. Crie a conta em https://heroku.com e instale a CLI:
   `curl https://cli-assets.heroku.com/install.sh | sh`
2. `heroku login`
3. Crie os dois apps:
   ```
   heroku create dmflow-api
   heroku create dmflow-web
   ```
   (troque os nomes se já estiverem em uso; anote os que você escolheu)
4. Ligue o Redis **no app da API**:
   ```
   heroku addons:create heroku-redis:mini -a dmflow-api
   ```
   Isso preenche `REDIS_URL` sozinho.
5. Conecte os dois apps ao GitHub: no painel de cada app, aba **Deploy** →
   **GitHub** → escolha `marcolamaia/DM-Flow-` → **Enable Automatic Deploys** na
   branch que você quiser publicar.

> **Custo.** `heroku-redis:mini` e os dynos `basic` são pagos. Não contratei nada
> e não vou contratar — a decisão e o cartão são seus. Se quiser começar sem
> custo, dá para usar dynos `eco`, mas eles hibernam depois de 30 minutos parados
> e o **worker não pode hibernar**: automação agendada simplesmente não roda
> enquanto o dyno dorme. Me avise qual caminho quer seguir.

### Serviço: banco de dados
**O que precisamos:** uma `DATABASE_URL`.

O plano é CockroachDB (fila #45). Enquanto ele não existe, dá para subir com
Postgres da própria Heroku:
```
heroku addons:create heroku-postgresql:essential-0 -a dmflow-api
```
Isso também é pago, e também é sua decisão.

### Serviço: envio de e-mail
**O que precisamos:** uma `SMTP_URL`.
**Por que precisamos:** verificação de e-mail, convite e redefinição de senha
passam por lá. **A API se recusa a subir em produção sem isso** — de propósito:
uma plataforma que aceita cadastro e nunca manda o e-mail de confirmação está
quebrada de um jeito que ninguém percebe até o cliente reclamar.

Qualquer provedor serve. O formato é `smtps://usuario:senha@servidor:465`.

---

## As variáveis, e onde cada uma vai

Nomes e explicações completas em
[`ENVIRONMENT_VARIABLES.md`](./ENVIRONMENT_VARIABLES.md). O essencial:

### No app da API

```bash
heroku config:set -a dmflow-api \
  NODE_ENV=production \
  API_URL=https://dmflow-api.herokuapp.com \
  WEB_URL=https://dmflow-web.herokuapp.com \
  SESSION_SECRET="$(openssl rand -base64 48)" \
  ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  MAIL_TRANSPORT=smtp \
  SMTP_URL='smtps://usuario:senha@smtp.provedor.com:465' \
  MAIL_FROM='DM FLOW <nao-responda@seudominio.com>' \
  DATABASE_URL='...'
```

> **`ENCRYPTION_KEY` não pode ser trocada depois.** Ela decifra todo token de
> canal já guardado. Trocar torna ilegível tudo que foi conectado antes —
> gere uma vez, guarde num cofre de senhas e não mexa mais.

### No app do site

```bash
heroku config:set -a dmflow-web \
  NEXT_PUBLIC_API_URL=https://dmflow-api.herokuapp.com \
  DM_FLOW_REQUIRE_PUBLIC_API_URL=1
```

> **Esta é a variável mais traiçoeira do deploy inteiro.** O endereço da API é
> gravado **dentro** do bundle na hora do build — não é lido quando o site roda.
> Definir depois não resolve: seria preciso buildar de novo.
>
> Sem ela, o site subiria, abriria, carregaria bonito, e tentaria falar com
> `localhost:4000` no navegador de quem acessasse. Nada funcionaria e nada no log
> diria o porquê.
>
> Por isso **o build agora se recusa a acontecer sem ela**, e
> `DM_FLOW_REQUIRE_PUBLIC_API_URL=1` faz ele recusar também um endereço apontando
> para localhost. Testado nos três casos: ausente, localhost, e endereço público.

---

## O que acontece em cada deploy

```
git push  (ou deploy automático pelo GitHub)
   │
   ▼
Heroku detecta Node, lê packageManager: pnpm@10.33.0
   │
   ▼
pnpm install
   │
   ▼
heroku-postbuild  →  pnpm build
   │                 (shared → db → api → web)
   ▼
release: prisma migrate deploy      ← SÓ NO APP DA API
   │
   │  Se falhar, o deploy é CANCELADO e a versão antiga continua no ar.
   │  É exatamente o que se quer: subir código que espera uma coluna
   │  que não existe é pior do que não subir.
   ▼
web e worker sobem
```

O comando de `release` foi rodado exatamente como está escrito no `Procfile`,
contra um banco real, antes de eu documentar isso.

---

## Verificar que subiu de verdade

```bash
# A API responde e alcança banco e Redis?
curl https://dmflow-api.herokuapp.com/health/ready
# esperado: {"status":"ok","checks":{"database":"fulfilled","redis":"fulfilled"}}

# O worker está de pé?
heroku ps -a dmflow-api

# O site abre?
curl -o /dev/null -w '%{http_code}\n' https://dmflow-web.herokuapp.com/

# Os logs
heroku logs --tail -a dmflow-api
heroku logs --tail -a dmflow-web
```

**Não considere publicado até `/health/ready` responder `ok`.** A rota confere
banco e Redis de verdade; um `200` na página inicial não prova nada sobre eles.

---

## Ambientes separados

Produção nunca deve usar credencial de teste. O jeito de garantir isso é não
deixá-las no mesmo lugar:

| Ambiente | Apps | Banco | Stripe |
|---|---|---|---|
| desenvolvimento | local | Postgres local | modo teste |
| staging | `dmflow-api-staging`, `dmflow-web-staging` | banco próprio | modo teste |
| produção | `dmflow-api`, `dmflow-web` | banco próprio | modo ao vivo |

Bancos separados, não schemas separados no mesmo banco. Um `DATABASE_URL`
colado no app errado com schemas compartilhados apaga dados de cliente.

Para promover staging → produção sem rebuildar:
```
heroku pipelines:create dmflow -a dmflow-api-staging -s staging
heroku pipelines:add dmflow -a dmflow-api -s production
heroku pipelines:promote -a dmflow-api-staging
```

---

## O que ainda não foi verificado

Sendo direto: **nada disto foi testado numa Heroku de verdade.** Não tenho conta
e não vou criar uma no seu nome.

O que **foi** verificado, aqui, contra serviços reais:

- O comando de `release` (`prisma migrate deploy`) roda e encontra as 5 migrations
- O `prisma` saiu de devDependencies para dependencies — sem isso a Heroku o
  removeria depois do build e **todo deploy morreria no release**
- A API passou a respeitar `PORT`. Sem isso o dyno seria morto por timeout em 60
  segundos, porque a aplicação estaria escutando 4000 enquanto a Heroku esperava
  outra porta
- O build do site recusa os três casos errados de `NEXT_PUBLIC_API_URL`
- `pnpm build` completo funciona

Os três primeiros itens eram bloqueadores reais, achados preparando isto — não
teorias.

Quando você criar os apps, me mande a saída de `heroku logs --tail` se algo
falhar. Não vou dizer que funciona antes de ver funcionando.
