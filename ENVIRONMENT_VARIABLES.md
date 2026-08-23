# Variáveis de ambiente

Só nomes e explicações. **Nenhum valor real aparece neste arquivo nem em
qualquer outro versionado.** Os valores vivem no `.env` local (que está no
`.gitignore`) e nas Config Vars da Heroku.

Coluna **Onde**: `API` = app da API, `SITE` = app do site, `local` = só na
máquina de quem desenvolve.

---

## Obrigatórias

| Variável | Onde | O que é | Se estiver errada |
|---|---|---|---|
| `DATABASE_URL` | API | Conexão do banco | A aplicação não sobe |
| `REDIS_URL` | API | Conexão do Redis. O add-on da Heroku preenche sozinho | Filas param; execuções ficam paradas |
| `SESSION_SECRET` | API | Assina o cookie de sessão. Mínimo 32 caracteres | Não sobe. Em produção, também recusa o valor de exemplo |
| `ENCRYPTION_KEY` | API | 64 caracteres hexadecimais. Cifra token de canal e segredo de TOTP | **Trocar torna ilegível tudo que já foi guardado.** Gere uma vez e nunca mexa |
| `API_URL` | API | Endereço público da própria API | Links de e-mail e callbacks apontam para o lugar errado |
| `WEB_URL` | API | Endereço público do site. Usado no CORS e nos links dos e-mails | O navegador bloqueia as chamadas por CORS |
| `NEXT_PUBLIC_API_URL` | **SITE** | Endereço da API, **gravado dentro do bundle no build** | Ver o aviso abaixo |
| `MAIL_TRANSPORT` | API | `smtp` ou `log` | Com `log` em produção, **a API se recusa a subir** |
| `SMTP_URL` | API | Servidor de e-mail. Obrigatória quando `MAIL_TRANSPORT=smtp` | Não sobe |
| `MAIL_FROM` | API | Remetente dos e-mails | E-mails saem com remetente errado ou são recusados |

### O aviso sobre `NEXT_PUBLIC_API_URL`

Ela é **substituída em tempo de compilação**, não lida em execução. Isso muda
tudo sobre quando ela precisa existir:

- Definir **depois** do build não tem efeito nenhum
- Um build sem ela geraria um site que abre, carrega e tenta falar com
  `localhost:4000` no navegador de quem acessou
- Nada no log diria o motivo

Por isso o build **se recusa a rodar sem ela**, e com
`DM_FLOW_REQUIRE_PUBLIC_API_URL=1` recusa também um endereço apontando para
localhost.

---

## Com padrão, mexer só se souber por quê

| Variável | Onde | Padrão | O que faz |
|---|---|---|---|
| `NODE_ENV` | ambos | `development` | `production` liga as verificações que impedem subir mal configurado |
| `API_PORT` | local | `4000` | Porta da API. **Na Heroku, `PORT` vence esta** — a plataforma atribui a porta e mata quem escuta outra |
| `WEB_PORT` | local | `3000` | Porta do site em desenvolvimento |
| `LOG_LEVEL` | API | `info` | `debug` em produção vaza volume, não segredo — os logs nunca registram senha nem token |
| `RATE_LIMIT_WINDOW_MS` | API | `60000` | Janela do limite de requisições |
| `RATE_LIMIT_MAX` | API | `300` | Orçamento por janela nas rotas comuns. **Não afrouxa o login**: rotas de credencial, API pública e webhooks têm orçamento próprio no código |
| `BILLING_GRACE_DAYS` | API | `7` | Dias em atraso antes de suspender o workspace |

---

## Cobrança (Stripe)

| Variável | Onde | O que faz |
|---|---|---|
| `STRIPE_SECRET_KEY` | API | Vazia mantém a cobrança em **modo local**: planos e cotas funcionam, checkout é simulado, nenhum cartão é cobrado |
| `STRIPE_WEBHOOK_SECRET` | API | Segredo do endpoint de webhook. Sem ele o webhook é recusado |
| `STRIPE_PORTAL_RETURN_URL` | API | Para onde o cliente volta ao sair do portal |

Enquanto `STRIPE_SECRET_KEY` estiver vazia, **reembolso pelo painel é recusado**
— registrar um reembolso que nenhum dinheiro seguiu colocaria movimentação falsa
nos números.

---

## Meta

| Variável | Onde | O que faz |
|---|---|---|
| `INSTAGRAM_PROVIDER` | API | `sandbox` usa o simulador. `live` fala com a Meta de verdade |
| `META_APP_ID` | API | Id do App da Meta |
| `META_APP_SECRET` | API | Segredo do App. **Nunca no site, nunca no Git** |
| `META_WEBHOOK_VERIFY_TOKEN` | API | Token que a Meta devolve ao verificar o webhook. Você inventa |
| `META_API_VERSION` | API | Versão explícita da API. **Obrigatória quando `INSTAGRAM_PROVIDER=live`** — chamar endpoint sem versão é pedir para quebrar sem aviso |

---

## Só no deploy

| Variável | Onde | O que faz |
|---|---|---|
| `PORT` | ambos | Atribuída pela Heroku. Nunca defina à mão |
| `DM_FLOW_REQUIRE_PUBLIC_API_URL` | SITE | `1` faz o build recusar um endereço de API apontando para localhost |

---

## Regras que valem sempre

1. **Nenhum valor real vai para o Git.** O `.gitignore` cobre `.env`,
   `.env.local` e `.env.production`. Conferido: nenhum deles está versionado.
2. **Segredo de servidor nunca vira `NEXT_PUBLIC_*`.** Tudo com esse prefixo é
   embutido no JavaScript que qualquer visitante baixa.
3. **Ambientes não compartilham credencial.** Banco de staging é outro banco, não
   outro schema.
4. **`ENCRYPTION_KEY` é para sempre.** Rotacionar exige decifrar e recifrar tudo
   que já está guardado, e isso ainda não existe.

Para começar: `cp .env.example .env` e preencha. O `.env.example` tem os nomes
todos, sem nenhum valor.
