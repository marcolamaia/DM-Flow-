# Auditoria do projeto DM FLOW

Levantada em 23/08/2026 sobre o commit `b56e64b`, varrendo o repositório inteiro.
Tudo aqui foi medido no código, não lembrado: cada número veio de um comando que
está descrito ao lado dele, e cada lacuna foi conferida abrindo o arquivo.

Onde escrevi "funciona", quer dizer que existe backend, persistência,
autorização e teste. Onde não tem uma dessas coisas, está dito qual falta.

---

## 1. O tamanho da coisa

| Área | Linhas | Arquivos |
|---|---|---|
| `packages/shared/src` — regras de domínio | 5.218 | 25 |
| `apps/api/src` — backend | 17.768 | 112 |
| `apps/web/src` — frontend | 10.223 | 46 |
| `packages/db` — schema e migrations | 88.220¹ | 13 |

¹ inclui o cliente Prisma gerado, que não é código escrito à mão.

- **137 rotas** de API em **21 controllers**
- **37 modelos** no banco, **5 migrations** aplicadas
- **22 páginas** no frontend
- **19 arquivos de teste**, somando **222 testes** (89 no shared, 133 na API)
- **45 verificações** rodando em navegador de verdade (`scripts/admin-ui-check.mjs`, `scripts/password-recovery-check.mjs`)

---

## 2. O que existe e funciona de ponta a ponta

Estes têm backend, banco, autorização, tratamento de erro e teste. Foram
verificados rodando, não só lidos.

| Módulo | Como sei que funciona |
|---|---|
| Cadastro, login, sessão | 12 testes de integração; sessão em cookie httpOnly/SameSite, rotação de token, detecção de reuso |
| Isolamento entre clientes | Teste que varre o código atrás de consulta sem filtro de workspace e **falha o build** se achar uma não justificada. Já pegou 6 casos meus durante esta fase |
| Verificação de e-mail | 12 testes; e-mail real via SMTP, token com prazo, uso único |
| Limite de requisições | 9 testes; conta sempre pelo endereço de origem, credencial só adiciona um balde mais apertado |
| Workspaces e papéis | Autorização decidida num guard só, nunca no controller |
| Automações e versões | Versão publicada é imutável; validação antes de publicar |
| Flow Builder | Portas tipadas como fonte única; canvas com mover, conectar, desconectar, duplicar, desfazer; posição persiste no banco |
| Motor de execução | Postgres é a verdade, Redis só transporte; lock otimista + lock no Redis; execução parada numa pergunta tem prazo |
| Filas e workers | BullMQ com retry, backoff e fila de mortos |
| Idempotência | Evento do Stripe gravado pelo id dele antes de ser aplicado; webhook da Meta com registro próprio |
| Cobrança Stripe | Assinatura do webhook verificada sobre os bytes crus; plano nunca liberado porque o navegador chegou em `/success` |
| Painel administrativo | 4 fases, 49 testes; papéis separados dos do workspace, motivo obrigatório, trilha só de leitura |
| Camada de métricas | Definição única, testada por um teste que proíbe uma segunda forma de calcular receita |

---

## 3. O que é só visual

**Nada.** Varri o repositório atrás dos padrões clássicos:

```
grep -rn "Math.random" apps/api/src apps/web/src packages/shared/src   # 5 ocorrências
grep -rn "setTimeout" apps/web/src                                      # 2 ocorrências
grep -rn "const mock|const fake|const dummy|sampleData"                 # 0 ocorrências
grep -rn "TODO|FIXME|HACK|XXX"                                          # 0 ocorrências
```

As 5 ocorrências de `Math.random` são legítimas: id de bloco novo no canvas
antes de salvar (3), sorteio do bloco de randomizador (1), token de lock no
Redis (1). Os 2 `setTimeout` são temporização de interface — apagar o aviso de
"salvo" e enquadrar o canvas.

`localStorage` guarda **só preferência**: idioma, tema e qual workspace estava
aberto. Nenhum dado de produto passa por ele.

Nenhuma métrica é inventada. O painel mostra zero quando é zero.

---

## 4. O que está incompleto — backend pronto, tela faltando

Esta é a lacuna real do projeto. Rodei o levantamento inverso (`scripts/`
abaixo): peguei as 137 rotas e procurei quem as chama no frontend.

**62 rotas têm tela. 75 não têm.** Destas 75, uma parte não precisa de tela
(saúde, webhook do Stripe, API pública, callback de canal). O resto é trabalho
que falta.

### 4.1 Recuperar a senha — estava quebrado, foi corrigido nesta auditoria

O pior achado, e o único que trancava gente de fora. Como era:

- `POST /auth/password/forgot` existia e funcionava
- O e-mail era enviado de verdade, apontando para `/reset-password?token=...`
- **A página `/reset-password` não existia**
- **A tela de login não tinha link "esqueci minha senha"**

Quem esquecesse a senha não tinha como voltar: o backend fazia a parte dele e o
link do e-mail levava a lugar nenhum. Mesma classe do convite quebrado
corrigido na fase anterior.

**Corrigido.** Foram criadas `/forgot-password` e `/reset-password`, e o link
foi para a tela de login. Verificado por uma bateria de 15 checagens em
navegador real (`scripts/password-recovery-check.mjs`), incluindo o que importa
de fato: a senha nova entra, a antiga não entra mais, o token não funciona duas
vezes e a resposta é idêntica para endereço cadastrado e não cadastrado.

### 4.2 Segundo fator — só metade

A tela de login **aceita** um código TOTP. Não existe nenhuma tela para
**ativar** o segundo fator. As três rotas (`/auth/totp/start`, `/confirm`,
`/disable`) nunca são chamadas por ninguém.

### 4.3 Trocar a própria senha

`POST /auth/password/change` existe. Nenhuma tela chama.

### 4.4 Contatos — 12 rotas sem tela

A tela de contatos hoje só **lista, busca e filtra**. O backend tem tudo:

```
GET/PATCH/DELETE /contacts/:id      criar, editar, excluir
POST/DELETE /contacts/:id/tags/:id  atribuir e remover etiqueta
POST /contacts/bulk/tag             etiquetar em massa
POST /contacts/import               importar
POST /contacts/export               exportar
POST /contacts/merge                juntar duplicados
```

### 4.5 Etiquetas, campos e segmentos — 8 rotas sem tela

Criar, renomear e excluir etiqueta; criar e excluir campo personalizado;
criar, editar, excluir e pré-visualizar segmento. Tudo pronto no backend, nada
na interface.

### 4.6 Chaves de API e webhooks de saída — 8 rotas sem tela

O cliente não consegue criar uma chave de API nem cadastrar um webhook de saída
pela interface, embora ambos funcionem.

### 4.7 Modelos de automação — 3 rotas sem tela

Listar, salvar e instalar modelo.

### 4.8 Outras

- Histórico de versões da automação e restaurar versão (`/automations/:id/versions`)
- Cancelar e inspecionar uma execução (`/executions/:id`, `/cancel`)
- Atribuir conversa, marcar como lida, mudar status (a tela do inbox faz parte disso, mas não tudo)
- Transferir a posse do workspace
- Registro de auditoria do próprio workspace (o cliente não vê o dele; só o admin vê o global)
- 5 relatórios de analytics que a tela não usa

### 4.9 Rotas que corretamente não têm tela

`/health/*`, `/billing/stripe/webhook`, `/channels/callback/:channel`,
`/v1/*` (API pública para o cliente integrar), `/sandbox/instagram/authorize`,
`/events/replay`. Estas são chamadas por máquina, não por gente.

---

## 5. Auditoria de botões

Percorri cada página contando elementos interativos e conferindo se cada um
chega no backend.

| Página | Interações | Situação |
|---|---|---|
| `/login` | 1 formulário + link | **FUNCIONAL** |
| `/register` | 1 formulário | **FUNCIONAL** |
| `/verify-email` | 1 botão | **FUNCIONAL** |
| `/forgot-password` | 1 formulário | **FUNCIONAL** — criada nesta auditoria |
| `/reset-password` | 1 formulário | **FUNCIONAL** — criada nesta auditoria |
| `/accept-invite` | 4 ações | **FUNCIONAL** |
| `/dashboard` | leitura | **FUNCIONAL** |
| `/analytics` | leitura | **FUNCIONAL** |
| `/contacts` | busca + 2 filtros | **PARCIAL** — nenhuma ação de escrita (§4.4) |
| `/inbox` | 4 ações + envio | **FUNCIONAL** |
| `/automations` | 4 ações | **FUNCIONAL** |
| `/automations/[id]` | 22 ações | **FUNCIONAL** — canvas inteiro testado no navegador |
| `/settings` | 1 ação | **PARCIAL** — não troca senha nem ativa segundo fator (§4.2, §4.3) |
| `/settings/team` | 7 ações | **FUNCIONAL** |
| `/settings/channels` | 4 ações | **FUNCIONAL** |
| `/settings/billing` | 2 ações | **FUNCIONAL** |
| `/admin` e as 5 telas do painel | 10 ações | **FUNCIONAL** — 30 verificações em navegador |

**Nenhum botão quebrado ou puramente decorativo.** O que existe funciona; o
problema é o que não existe.

---

## 6. Problemas de segurança

### 6.1 Dependências vulneráveis — 27 avisos

```
pnpm audit  →  1 crítico | 10 alto | 14 médio | 2 baixo
```

| Gravidade | Pacote | Onde entra | Risco real aqui |
|---|---|---|---|
| Crítico | `vitest <3.2.6` | só desenvolvimento | Não vai para produção |
| Alto | `nodemailer <=9.0.0` | **usado direto** para enviar e-mail | **Este importa** |
| Alto | `multer <2.2.0` | via `@nestjs/platform-express` | Só se houver upload; hoje não há |
| Alto | `sharp`, `postcss` | via `next` | Build do frontend |
| Alto | `vite`, `esbuild` | só desenvolvimento | Não vai para produção |
| Médio | `@nestjs/core <=11.1.17` | direto | Atualizar |
| Médio | `qs`, `body-parser` | via express | Atualizar |

O único que exige atenção imediata é o **nodemailer**, porque é usado em
produção para enviar e-mail de verificação e de redefinição de senha.

### 6.2 CSRF sem defesa explícita

O cookie de sessão usa `SameSite=lax`, o que barra o caso clássico. Não existe
token anti-CSRF. Com `SameSite=lax` e a API em outro domínio (CORS restrito),
o risco é baixo — mas é uma defesa a menos, e deveria ser anotada como decisão
consciente em vez de omissão.

### 6.3 O que já está certo

- Senha com Argon2id, nunca em texto puro, hash nunca sai pela API (há teste procurando `$argon2` na resposta)
- Segredos com AES-256-GCM; token nunca aparece inteiro na interface
- Sessão em cookie httpOnly, `Secure` em produção, `SameSite=lax`
- Rotação de token de sessão e detecção de reuso
- Limite de requisições global, contando pelo endereço de origem
- Helmet ligado
- Proteção contra SSRF no bloco de requisição HTTP (8 testes)
- Isolamento entre clientes com guard em tempo de execução **e** teste que quebra o build
- Nenhum `.env` versionado; `.gitignore` cobre os três padrões
- Rotas administrativas respondem 404, não 403, para quem não é admin

---

## 7. Dívida técnica

1. **O arquivo do Flow Builder tem ~1.400 linhas.** Funciona e está testado, mas é grande demais para uma página. Pede quebra em partes.
2. **Sem pipeline de CI.** Os testes existem e passam; nada os roda automaticamente num pull request.
3. **`docker compose up` nunca rodou com sucesso** neste ambiente — o CDN de imagens do Docker Hub está bloqueado por política de rede. Não é problema do arquivo; é do ambiente. Continua sem verificação real.
4. **Sem Row Level Security no Postgres.** O isolamento hoje é da aplicação (guard + teste). Uma segunda camada no banco seria defesa em profundidade.
5. **Upload de mídia só por URL.** Não há armazenamento de arquivo.
6. **Nenhuma tela de erro global do frontend** (`error.tsx` do Next).

---

## 8. Arquitetura atual

```
NAVEGADOR
   │
   ├─ Next.js 15 (App Router, React 19)          apps/web
   │
   ▼  fetch com cookie de sessão
NestJS 10                                        apps/api
   │
   ├─ AuthGuard          identidade → tenant → autorização, nesta ordem
   ├─ RateLimitGuard     global, conta pelo endereço de origem
   ├─ AdminGuard         concessão lida do banco a cada requisição
   │
   ├─ Serviços de domínio
   │     auth · workspaces · contacts · automations · engine
   │     channels · billing · inbox · analytics · admin
   │
   ├─ Capability Engine  nega por padrão; nada da Meta é presumido
   └─ Prisma 6 (com guard de vazamento entre clientes)
         │
         ▼
   PostgreSQL 16          fonte da verdade
   Redis 7 + BullMQ       só transporte e locks
         │
         ▼
   WORKER (mesmo código, processo separado)
   SCHEDULER (dentro do worker)
```

Regras que a arquitetura sustenta:

- **Postgres é a verdade, Redis é transporte.** Perder o Redis atrasa execuções, não as perde.
- **Nada da Meta é presumido.** O Capability Engine nega por padrão e cada capacidade é declarada em separado.
- **Falha barulhenta, nunca degradação silenciosa.** Produção se recusa a subir com `MAIL_TRANSPORT=log`. Reembolso é recusado quando não há cobrança configurada.

## 9. Arquitetura recomendada

Mudanças pedidas no prompt mestre novo, na ordem em que fazem sentido:

1. **CockroachDB no lugar do Postgres.** Compatível na linha, mas não é trocar string de conexão: Cockroach usa SERIALIZABLE, então conflito de transação vira **erro de retry** em vez de espera. O motor usa lock otimista e `FOR UPDATE`; os dois precisam ser revistos caso a caso e a suíte inteira precisa rodar contra o Cockroach antes de qualquer "funciona".
2. **Heroku** com `Procfile` separando `web`, `worker` e `release` (migrations).
3. **Login com Google** pelo fluxo oficial, com `state` e PKCE.
4. **Messenger, Facebook e WhatsApp Cloud API** — cada capacidade validada individualmente contra a documentação oficial.
5. **Armazenamento de objeto** para mídia, quando houver upload.

O monólito modular continua adequado. Nada aqui pede microserviço.

---

## 10. Plano de implementação

Em ordem de dano causado por não fazer:

| # | O que | Por que agora |
|---|---|---|
| ~~1~~ | ~~**Recuperar senha** (§4.1)~~ | **Feito durante esta auditoria** |
| 1 | Atualizar `nodemailer` e `@nestjs/core` (§6.1) | Vulnerabilidade em código de produção |
| 3 | Escrever ações de contatos, etiquetas e segmentos (§4.4, §4.5) | 20 rotas prontas sem porta de entrada |
| 4 | Trocar senha e ativar segundo fator (§4.2, §4.3) | Segurança que o cliente não consegue ligar |
| 5 | Pastas de automação (fila #41–43) | Já pedido |
| 6 | CI (#26) | Sem isso nada disto fica garantido |
| 7 | CockroachDB (#45) | Depende de cluster |
| 8 | Heroku (#46) | Depende de conta |
| 9 | Login com Google (#47) | Depende de credencial |
| 10 | Canais da Meta (#48) | Depende de acesso à documentação |

O estado por módulo, com o critério de pronto do prompt, está em
[`IMPLEMENTATION_STATUS.md`](./IMPLEMENTATION_STATUS.md).
A arquitetura em detalhe está em [`ARCHITECTURE.md`](./ARCHITECTURE.md).
