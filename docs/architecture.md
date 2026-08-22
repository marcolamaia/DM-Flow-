# Arquitetura — DM FLOW

> Última atualização: 2026-08-22

## 1. Visão

DM FLOW transforma engajamento público (comentário, story, menção) em conversa
privada automatizada, e guarda cada pessoa tocada como um contato segmentável do
negócio. É multi-tenant: vários clientes pagam por mês, cada um com seu workspace.

## 2. Topologia de processos

Quatro processos, deliberadamente separados:

```
web        Next.js (App Router) — interface
api        NestJS — HTTP, webhooks de entrada, WebSocket
worker     BullMQ — ingestão, execução de fluxos, webhooks de saída
scheduler  roda dentro do worker — acorda delays, varre inadimplência, limpeza
```

**Por que `api` e `worker` são processos distintos:** o endpoint de webhook precisa
responder em milissegundos ou a plataforma para de entregar. Se uma automação lenta
pudesse ocupar o mesmo pool de threads, um pico de tráfego viraria **perda de
eventos** — e um evento perdido não existe em lugar nenhum.

## 3. Caminho de um evento

```
Meta/simulador → POST /webhooks/instagram
   ├─ verifica assinatura sobre os BYTES CRUS      (401 se inválida)
   ├─ grava WebhookEvent (append-only)
   ├─ enfileira e responde 200                     (alvo p99 < 200ms)
   ↓
worker
   ├─ deduplica (Redis SETNX + unique constraint no banco)
   ├─ normaliza via provider → NormalizedEvent
   ├─ resolve conta conectada → workspace
   ├─ resolve/cria Contact + ContactIdentity + Conversation
   ├─ persiste Message e atualiza estado da janela
   ├─ casa triggers (especificidade → prioridade → data de criação)
   └─ cria Execution e roda o motor
```

## 4. Decisões e o porquê

| Decisão | Motivo |
|---|---|
| **Postgres é a verdade, Redis é transporte** | Um delay de 3 dias não pode viver só numa fila. Provado: `FLUSHALL` + restart do worker e a execução retomou no node exato. |
| **Lock otimista além do lock do Redis** | Locks expiram no meio de um passo; número de versão não mente. Dois workers na mesma execução enviariam a mensagem duas vezes. |
| **AutomationVersion imutável após publicar** | Editar um fluxo não pode alterar execuções em voo. Cada execução fica presa à versão em que começou. |
| **Capability Engine com uma única função de decisão** | Se regra de design-time e run-time morarem em código separado, elas divergem — e o resultado é um fluxo que parece válido no editor e falha em silêncio em produção. |
| **Deny-by-default sem flag de override** | Capacidade não validada é indisponível. O único caminho é validar e atualizar o registro. |
| **Grafo persistido em schema próprio** | Trocar a biblioteca de canvas não pode invalidar os fluxos dos clientes. |
| **Predicado compilado para SQL** | Avaliar em memória exigiria carregar todos os contatos para filtrar um segmento. |
| **Idempotência no ponto do efeito colateral** | Dedupe na ingestão pode falhar; a garantia real precisa estar onde a mensagem sai. |
| **SWC como runtime de dev e de teste** | esbuild não emite `emitDecoratorMetadata` e o Nest injeta `undefined` silenciosamente. |

## 5. Stack

TypeScript estrito · Next.js 15 · NestJS 10 · PostgreSQL 16 · Prisma 6 · Redis 7 ·
BullMQ · React Flow · Tailwind + Radix · Socket.IO · Stripe · Pino · Vitest.

## 6. Premissas registradas

- **Janela de mensagens no simulador:** 24h a partir da última mensagem do contato.
  É comportamento do *nosso* simulador, não uma afirmação sobre a Meta. Para conta
  real o estado fica `UNKNOWN` e o envio é bloqueado até a FASE 0 validar a regra.
- **Comentário não abre janela.** Responder a comentário em privado é tratado como
  mecanismo de tiro único ligado ao evento de origem, não como envio em janela.
- **Histórico começa na conexão da conta.** A plataforma não entrega o que veio
  antes, e a UI diz isso em vez de parecer que faltam mensagens.
