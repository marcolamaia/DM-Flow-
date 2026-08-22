# DM FLOW

Plataforma SaaS multi-tenant de automação de conversas para Instagram. Transforma
comentário, story reply e menção em conversa privada automatizada, e guarda cada
pessoa tocada como contato segmentável do negócio.

Cobrança por assinatura via Stripe, com plano gratuito limitado e **suspensão
automática por inadimplência** que para as automações sem apagar nada.

---

## ⚠️ Leia antes de conectar uma conta real

**Nenhuma capacidade do Instagram foi validada contra a documentação oficial da
Meta.** O ambiente onde a plataforma foi construída teve `developers.facebook.com`
bloqueado. Em vez de preencher endpoints e permissões com valores plausíveis, o
projeto deixou tudo marcado como não confirmado e **impede** o uso em conta real:

- `LiveInstagramProvider` recusa toda chamada com `CapabilityNotValidatedError`.
- O Capability Engine nega qualquer capacidade não validada, sem flag de override.
- Testes automatizados falham se alguém marcar algo como disponível sem validar.

A plataforma inteira funciona hoje através de um **provider simulado** que reproduz
a forma de uma integração real — webhooks assinados, OAuth com tela de consentimento,
rate limiting por conta, ids de entrega, falhas realistas — sem inventar nada sobre
a Meta. Capacidades servidas pelo simulador são marcadas `SANDBOX_SIMULATED`, o que
descreve **o nosso código**, não o que a plataforma real permite.

Para habilitar conta real: execute a FASE 0 do `MASTER_PROMPT.pt-BR.md` (§4),
preencha `docs/meta-capabilities.md` e implemente `LiveInstagramProvider`.
Nada mais no código precisa mudar — o motor só conhece a interface.

---

## Rodando

Requisitos: Node 22+, pnpm 10+, Docker (ou Postgres 16 e Redis 7 locais).

```bash
pnpm install

docker compose up -d              # Postgres + Redis
cp .env.example .env
# gere os segredos:
sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -hex 32)|" .env
sed -i "s|^ENCRYPTION_KEY=.*|ENCRYPTION_KEY=$(openssl rand -hex 32)|" .env

pnpm --filter @dmflow/shared build
pnpm db:generate && pnpm --filter @dmflow/db deploy
pnpm db:seed
```

Em três terminais:

```bash
pnpm dev:api       # http://localhost:4000
pnpm dev:worker    # filas + scheduler
pnpm dev:web       # http://localhost:3000
```

Entre com as credenciais que o seed imprime (`demo@dmflow.app`), e dispare um
evento simulado:

```bash
pnpm --filter @dmflow/api simulate:comment "quero o link"
pnpm --filter @dmflow/api simulate:dm "qual o preço?"
pnpm --filter @dmflow/api simulate:story "amei isso"
```

O comentário casa o gatilho da automação semeada, roda o fluxo, envia a resposta
privada, aplica a tag e grava o score. Veja em **Automações → execuções**, em
**Conversas** e em **Relatórios**.

## Testes

```bash
pnpm test          # 73 testes + paridade de i18n
```

Os testes de integração rodam contra Postgres e Redis reais, não mocks: isolamento
de tenant, idempotência e rejeição de assinatura são exatamente as coisas sobre as
quais um mock mentiria com prazer.

## Estrutura

```
apps/api        NestJS — HTTP, webhooks, WebSocket, worker, scheduler
apps/web        Next.js — interface, Flow Builder (React Flow)
packages/shared domínio: erros, RBAC, planos, capacidades, predicados, grafo
packages/db     Prisma — 34 tabelas, migrations
docs/           arquitetura, segurança, limitações, registro de capacidades
```

## Documentação

| Arquivo | Conteúdo |
|---|---|
| `docs/architecture.md` | Topologia, caminho de um evento, decisões e o porquê |
| `docs/meta-capabilities.md` | **Registro de validação — hoje vazio de propósito** |
| `docs/known-limitations.md` | O que o produto não faz e por quê |
| `docs/security.md` | Controles implementados e endurecimento pendente |
| `MASTER_PROMPT.pt-BR.md` | Especificação completa (também em inglês) |
| `research/` | Pesquisa Manychat × Meta que originou o projeto |

## Billing

Sem `STRIPE_SECRET_KEY` a plataforma roda completa: planos e quotas são aplicados,
o checkout aplica o plano localmente e diz claramente que nada foi cobrado. Uma
instalação self-hosted ou pré-lançamento não deve ficar inutilizável por falta de
uma chave.

Com Stripe configurado: falha de pagamento move o workspace para `PAST_DUE` e inicia
a carência (`BILLING_GRACE_DAYS`, padrão 7). Passada a carência, o sweep agendado
**suspende** o workspace — automações param numa ação deliberada, e leitura,
exportação e pagamento continuam abertos. Pagamento confirmado reativa
automaticamente.

```bash
pnpm --filter @dmflow/api billing:check   # demonstra o ciclo completo
```
