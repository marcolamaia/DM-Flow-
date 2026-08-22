# DM FLOW — Master Prompt

Este repositório **não contém a plataforma DM FLOW**. Ele contém a pesquisa e o **Master Prompt**
que será entregue a uma IA de desenvolvimento para que ela construa a DM FLOW.

## O que tem aqui

| Arquivo | O que é |
|---|---|
| **`MASTER_PROMPT.pt-BR.md`** | 🇧🇷 O entregável principal, em português. Copie e cole numa IA de programação. |
| **`MASTER_PROMPT.en.md`** | 🇺🇸 O mesmo entregável, em inglês. As duas versões são normativas e equivalentes. |
| `research/00-research-log.md` | Método, **limitações desta pesquisa**, e a escala de nível de evidência. **Leia primeiro.** |
| `research/01-manychat-product-model.md` | Frente 1 — decomposição do modelo mental do Manychat |
| `research/02-meta-capability-hypotheses.md` | Frente 2 — hipóteses sobre a Meta + URLs canônicas a validar |
| `research/03-matrix.md` | Matriz Manychat × capacidade real da Meta |
| `research/04-stack-decision.md` | Stack escolhida e justificada |

## ⚠️ Limitação que você precisa conhecer

A sessão de pesquisa que gerou este material rodou atrás de um proxy de egress que **bloqueou
`developers.facebook.com`, `manychat.com` e `help.manychat.com`**. Foi impossível ler a
documentação oficial da Meta página por página.

Por isso:

- **Nenhuma capacidade da Meta neste repositório é fato confirmado.** Todas são hipóteses
  rotuladas e endereçadas à FASE 0 do Master Prompt.
- O Master Prompt foi desenhado exatamente para essa realidade: a **primeira tarefa obrigatória**
  da IA construtora é validar tudo contra a documentação oficial ao vivo, e o produto é
  arquitetado com um **Capability Engine deny-by-default**, no qual uma capacidade não validada é
  estruturalmente indisponível — não "disponível e tomara que funcione".

Para eliminar a limitação: libere `developers.facebook.com`, `developers.meta.com` e
`help.manychat.com` na network policy do Environment e re-rode a FASE 0.

## Como usar

1. Escolha o idioma (`MASTER_PROMPT.pt-BR.md` ou `MASTER_PROMPT.en.md`).
2. Cole o arquivo inteiro numa IA de desenvolvimento (Claude Code, Codex ou equivalente).
3. Exija que ela execute a **FASE 0** e volte com o relatório de validação **antes** de escrever
   código de integração.
4. Só depois disso, autorize a FASE 1.

## Fontes usadas na pesquisa

Prioridade declarada: Meta for Developers → Manychat oficial → documentação oficial de outras
tecnologias. As páginas da Meta e do Manychat abaixo foram **identificadas como existentes**
via índice de busca, mas **não puderam ser abertas** nesta sessão (ver limitação acima).

### Meta for Developers — a validar na FASE 0
- https://developers.facebook.com/docs/instagram-platform
- https://developers.facebook.com/docs/instagram-platform/overview/
- https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/
- https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/conversations-api/
- https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/ice-breakers/
- https://developers.facebook.com/docs/instagram-platform/webhooks
- https://developers.facebook.com/docs/messenger-platform/instagram/features/private-replies/
- https://developers.facebook.com/docs/messenger-platform/instagram/features/story-mention/
- https://developers.facebook.com/docs/messenger-platform/instagram/features/ice-breakers/
- https://developers.facebook.com/docs/messenger-platform/conversations/
- https://developers.facebook.com/docs/graph-api/webhooks/reference/instagram
- https://developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-instagram/
- https://developers.facebook.com/docs/graph-api/overview/rate-limiting/
- https://developers.facebook.com/docs/instagram-api/changelog/
- https://developers.facebook.com/documentation/business-messaging/messenger-platform/policy
- https://developers.facebook.com/documentation/instagram-platform/webhooks
- https://developers.facebook.com/documentation/business-messaging/instagram-messaging/webhooks

### Manychat oficial — referência de produto (Frente 1)
- https://help.manychat.com/hc/en-us/articles/14281166306332-How-to-build-a-Manychat-automation
- https://help.manychat.com/hc/en-us/articles/14281170185628-How-to-set-custom-rules-with-Triggers-Conditions-and-Actions
- https://help.manychat.com/hc/en-us/articles/14281197046812-Smart-Delay
- https://help.manychat.com/hc/en-us/articles/14281142518556-Condition-Block
- https://help.manychat.com/hc/en-us/articles/14281110746012-Contacts-tab-Overview
- https://help.manychat.com/hc/en-us/articles/14281316989724-Instagram-Post-and-Reel-Comments-trigger
- https://help.manychat.com/hc/en-us/articles/13556930006428-Instagram-Story-Reply-Trigger
- https://help.manychat.com/hc/en-us/articles/14281309502108-Instagram-Story-Mention-Reply-trigger
- https://help.manychat.com/hc/en-us/articles/14281172274460-User-roles-and-team-management
- https://help.manychat.com/hc/en-us/articles/14281071969820-Manychat-Inbox-overview
- https://help.manychat.com/hc/en-us/articles/14281089062044-Live-Chat-analytics
- https://help.manychat.com/hc/en-us/articles/14281285374364-Dev-Tools-External-request
- https://help.manychat.com/hc/en-us/articles/14281199732892-How-to-send-messages-outside-the-24-hour-and-7-day-windows-in-Messenger-and-Instagram
- https://api.manychat.com/swagger

### Fontes secundárias encontradas — NÃO usadas como base técnica
Blogs de vendors e agregadores apareceram nas buscas e foram **descartados como fundamento**,
por divergirem entre si em números críticos (ver `research/00-research-log.md` §3). Estão
registrados na pesquisa apenas como evidência de que os números circulantes são conflitantes e
precisam de validação primária.
