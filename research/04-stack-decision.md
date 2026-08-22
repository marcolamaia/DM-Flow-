# Decisão de Stack — DM FLOW

Stack **fixada** (decisão minha, a pedido do usuário), com justificativa por escolha.
A IA construtora deve seguir, e só divergir com justificativa escrita em `docs/architecture.md`.

| Camada | Escolha | Por quê (e o que foi descartado) |
|---|---|---|
| Linguagem | **TypeScript** (estrito) em todo o stack | Um só modelo de tipos do node do canvas até o payload do provider. Descartado Python/Go: perderia tipos compartilhados no ponto mais frágil (schema de node). |
| Frontend | **Next.js (App Router) + React** | SSR para o app shell, RSC para listas pesadas (contatos, inbox), rotas de API para BFF. |
| UI | **Tailwind CSS + Radix UI** (primitivos sem estilo) + design system próprio | Radix entrega acessibilidade real (foco, ARIA, teclado) sem impor visual — requisito de "design próprio". Descartado MUI/AntD: estética reconhecível de terceiro. |
| Canvas do Flow Builder | **React Flow (@xyflow/react)** | Padrão da categoria, resolve pan/zoom/handles/minimap. Descartado canvas próprio: meses de trabalho para reinventar o resolvido. |
| Estado de servidor no client | **TanStack Query** | Cache, invalidação e revalidação; evita Redux global. |
| Backend | **NestJS** (Node, TS) | Módulos, DI e testabilidade — importa muito num sistema com providers plugáveis e um motor de execução. Descartado Express puro: vira spaghetti nesse tamanho. |
| Banco | **PostgreSQL 16+** | Transações fortes (o motor precisa), JSONB (grafo do fluxo, payload de webhook), índices parciais/GIN, `SELECT … FOR UPDATE SKIP LOCKED` para trabalho concorrente. |
| ORM | **Prisma** (+ SQL cru onde precisar) | Migrations versionadas e tipos gerados. SQL cru liberado para analytics e locks. |
| Cache / locks / dedupe | **Redis** | Dedupe de webhook, distributed lock, contadores de rate limit, presence do inbox. |
| Filas / jobs | **BullMQ** sobre Redis | Retry com backoff, delayed jobs (essencial para o node Delay), DLQ, repeatable jobs. Descartado SQS: delayed job de dias + DLQ + inspeção local ficam mais simples aqui. |
| Realtime | **WebSocket** (Socket.IO ou ws) com adapter Redis | Inbox ao vivo, status de execução, presence de agente. |
| Storage | **S3-compatível** (S3/R2) + URLs pré-assinadas | Mídia de mensagens e uploads. Nunca servir mídia pelo app server. |
| Auth (nossa) | **Sessão httpOnly + refresh rotativo**, TOTP 2FA opcional | Descartado JWT em localStorage: XSS vira takeover. |
| Auth (Meta) | **OAuth server-side**, tokens cifrados no banco | Ver seção de segurança do Master Prompt. |
| Cifra de segredos | **AES-256-GCM** com chave em KMS/Secrets Manager, envelope encryption | Token de canal é o ativo mais sensível do produto. |
| Observabilidade | **OpenTelemetry** → traces/métricas; **Pino** (JSON) → logs; **Sentry** → erros | Trace precisa atravessar webhook → fila → execução → chamada de API. |
| Testes | **Vitest** (unit), **Supertest** (API), **Playwright** (E2E), **Testcontainers** (PG+Redis reais), **Pact ou snapshot de contrato** (providers) | Ver seção de testes. |
| Deploy | **Docker** + orquestrador (ECS/Fly/Railway/K8s); processos separados: `web`, `api`, `worker`, `scheduler` | Worker **nunca** no mesmo processo do HTTP: um pico de fila não pode derrubar o webhook (perder webhook = perder cliente). |
| CI | GitHub Actions: typecheck → lint → unit → integration → build → migrations | — |

## Três decisões que merecem destaque

1. **Processos separados `api` / `worker` / `scheduler`.**
   O endpoint de webhook da Meta precisa responder rápido e sempre. Se ele compartilhar
   pool com o motor de execução, uma automação lenta causa timeout no webhook, e webhook
   perdido é dado perdido para sempre.

2. **Postgres como fonte da verdade da Execution, Redis só como transporte.**
   Redis pode perder dados. Uma execução pausada por 3 dias não pode viver só na fila:
   o estado mora no Postgres, a fila só carrega o ponteiro.

3. **React Flow, mas com o grafo persistido em formato próprio.**
   O JSON salvo no banco é **nosso schema versionado**, não o formato interno do React Flow.
   Se um dia trocarmos a biblioteca de canvas, os fluxos dos clientes continuam válidos.
