# DM FLOW — Research Log & Evidence Policy

**Data da pesquisa / Research date:** 2026-08-22
**Executor:** Claude (Claude Code, sessão remota)
**Objetivo:** produzir um Master Prompt para outra IA construir a DM FLOW.

---

## 1. Restrição crítica desta sessão (LEIA ANTES DE CONFIAR EM QUALQUER LINHA)

Esta sessão rodou atrás de um **proxy de egress com política restritiva**.

Resultado dos testes de alcance (2026-08-22):

| Domínio | WebFetch | curl | Resultado |
|---|---|---|---|
| `developers.facebook.com` | ❌ | ❌ 403 CONNECT | **BLOQUEADO** |
| `developers.meta.com` | ❌ | ❌ | **BLOQUEADO** |
| `graph.facebook.com` | ❌ | ❌ | **BLOQUEADO** |
| `transparency.meta.com` | ❌ | ❌ | **BLOQUEADO** |
| `help.manychat.com` | ❌ | ❌ | **BLOQUEADO** |
| `manychat.com` | ❌ | ❌ | **BLOQUEADO** |
| `api.manychat.com` | ❌ | ❌ | **BLOQUEADO** |
| `en.wikipedia.org` (controle) | ❌ | ❌ | **BLOQUEADO** |
| `WebSearch` (motor de busca) | ✅ | — | **FUNCIONA** |

**Consequência direta:** foi **impossível ler a documentação oficial da Meta página por página**
nesta sessão. Toda informação sobre a Meta abaixo veio de:
(a) títulos e URLs reais indexados de `developers.facebook.com` retornados pelo WebSearch, e
(b) resumos de snippets, incluindo fontes secundárias (blogs de vendors, agregadores).

**Portanto: nenhuma linha sobre capacidade da Meta neste repositório é um fato confirmado.**
Todas são **hipóteses de pesquisa** que a IA construtora é obrigada a revalidar contra a
documentação oficial ao vivo antes de escrever qualquer linha de código de integração.

Isso não enfraquece o Master Prompt: o Master Prompt foi desenhado justamente para que a
validação primária seja a **primeira tarefa obrigatória** da IA construtora (FASE 0), com
formato de registro definido. A matriz pré-populada serve como *checklist de investigação*,
não como especificação técnica.

### Como remover esta limitação
Liberar `developers.facebook.com`, `developers.meta.com` e `help.manychat.com` na
política de egress do ambiente (Claude Code on the web → configuração do Environment →
network policy). Depois disso, re-rodar a FASE 0 do Master Prompt.

---

## 2. Escala de nível de evidência usada neste repositório

Toda afirmação sobre plataforma externa carrega um destes rótulos:

| Rótulo | Significado |
|---|---|
| `E0 — PRIMARY` | Lido diretamente na documentação oficial da Meta/Manychat. **Nesta sessão: nenhuma linha atingiu E0.** |
| `E1 — INDEXED` | Título/URL de página oficial confirmado no índice de busca; conteúdo apenas parcialmente visto via snippet. |
| `E2 — SECONDARY` | Afirmado por fonte terceira (blog de vendor, doc de concorrente, artigo). Não confiável para decisão técnica. |
| `E3 — CONFLICTING` | Fontes secundárias divergem entre si. **Sinal vermelho.** |
| `E4 — UNKNOWN` | Não foi possível obter nenhuma informação. |

E toda capacidade carrega um destes status de disponibilidade (taxonomia pedida pelo usuário):

- `DISPONÍVEL PELA API OFICIAL`
- `DISPONÍVEL COM RESTRIÇÕES`
- `EXIGE APP REVIEW`
- `EXIGE ADVANCED ACCESS`
- `DEPENDE DO TIPO DE CONTA`
- `DEPENDE DO CANAL`
- `NÃO DISPONÍVEL PELA API ATUAL`
- `NÃO FOI POSSÍVEL CONFIRMAR`

Nesta sessão, **a maioria esmagadora das linhas Meta termina em `NÃO FOI POSSÍVEL CONFIRMAR`**
por causa da restrição da seção 1, mesmo quando fontes secundárias soam confiantes.

---

## 3. Exemplo concreto de por que fontes secundárias não servem

Pergunta: *qual é o rate limit de envio de DM no Instagram?*

Respostas encontradas em fontes secundárias diferentes, no mesmo dia:

- "200 mensagens/hora" (blog de vendor A)
- "750 chamadas/hora para private replies em posts e reels" (blog de vendor B)
- "5.000 DMs/hora" (blog de vendor C, no próprio título)
- "2 chamadas/segundo por conta profissional para Conversations API" (blog de vendor D)
- "100 chamadas/segundo para mensagens com texto/links/reações/stickers" (blog de vendor D)
- "200 chamadas/hora por usuário — Business Use Case limit" (blog de vendor E)

Status: `E3 — CONFLICTING`. Nenhum desses números pode entrar em código.
A IA construtora deve ler `https://developers.facebook.com/docs/graph-api/overview/rate-limiting/`
e a página de rate limits específica do Instagram Messaging, registrar a data e a versão da API,
e **derivar os limites em runtime a partir dos headers de uso da própria API** em vez de
hardcodar constantes.

Segundo exemplo: *quantas private replies posso enviar por comentário?*
Fonte secundária afirma "uma por comentário, para sempre" e "até 7 dias após o comentário".
Status: `E2 — SECONDARY`. Plausível, não confirmado. Vai para o checklist da FASE 0.

---

## 4. Método aplicado

1. Frente 1 — modelo mental do produto Manychat (o que a categoria precisa ter).
2. Frente 2 — tentativa de validação primária na Meta → **bloqueada**; degradada para
   descoberta de URLs canônicas + snippets.
3. Cruzamento Manychat × Meta → matriz em `research/03-matrix.md`.
4. Decisão de stack → `research/04-stack-decision.md`.
5. Conversão de tudo em Master Prompt (`MASTER_PROMPT.en.md` / `MASTER_PROMPT.pt-BR.md`).

O passo 3 produziu a decisão arquitetural mais importante do projeto:
**o produto precisa de um Capability Engine dirigido por dados (deny-by-default)**, porque
a fronteira do que a Meta permite é instável, varia por canal/conta/permissão/janela e
não pôde sequer ser lida com segurança aqui. Hardcodar capacidades seria o erro fatal.
