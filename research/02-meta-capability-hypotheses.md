# Frente 2 — Capacidades da Meta: HIPÓTESES, não fatos

> ⚠️ **LEIA `research/00-research-log.md` PRIMEIRO.**
> `developers.facebook.com` esteve **bloqueado** nesta sessão. Nenhuma linha abaixo é `E0 — PRIMARY`.
> Este arquivo é um **checklist de investigação** para a FASE 0 do Master Prompt.

---

## 1. URLs oficiais canônicas descobertas (confirmadas como existentes no índice)

A IA construtora deve abrir **todas** estas páginas, na ordem, antes de escrever código de integração.

### 1.1 Instagram Platform — base
| # | URL | O que extrair |
|---|---|---|
| M01 | `https://developers.facebook.com/docs/instagram-platform` | Mapa completo do produto; quais APIs existem hoje |
| M02 | `https://developers.facebook.com/docs/instagram-platform/overview/` | Modelo de acesso, tipos de conta, visão de permissões |
| M03 | `https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login` | Caminho de auth "Instagram Login" (Business Login) |
| M04 | `https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login` | Caminho de auth "Facebook Login" (via Página) |

### 1.2 Messaging
| # | URL | O que extrair |
|---|---|---|
| M05 | `https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/` | Endpoint real de envio, tipos de mensagem, limites |
| M06 | `https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/conversations-api/` | Leitura de conversas/histórico e seus limites |
| M07 | `https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/ice-breakers/` | Ice breakers: formato, quantidade máxima |
| M08 | `https://developers.facebook.com/docs/messenger-platform/instagram/features/private-replies/` | Private reply: janela, limite por comentário, endpoint |
| M09 | `https://developers.facebook.com/docs/messenger-platform/instagram/features/story-mention/` | Story mention: payload e comportamento |
| M10 | `https://developers.facebook.com/docs/messenger-platform/instagram/features/ice-breakers/` | Variante Messenger-platform de ice breakers |
| M11 | `https://developers.facebook.com/docs/messenger-platform/conversations/` | Conversations API (Messenger + IG) |

### 1.3 Webhooks
| # | URL | O que extrair |
|---|---|---|
| M12 | `https://developers.facebook.com/docs/instagram-platform/webhooks` | **Lista autoritativa de campos de webhook do Instagram** |
| M13 | `https://developers.facebook.com/docs/graph-api/webhooks/reference/instagram` | Referência de payloads por campo |
| M14 | `https://developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-instagram/` | Setup, verify token, assinatura |
| M15 | `https://developers.facebook.com/docs/instagram-messaging/webhooks/` | Webhooks específicos de messaging |

### 1.4 Políticas, limites, review
| # | URL | O que extrair |
|---|---|---|
| M16 | `https://developers.facebook.com/documentation/business-messaging/messenger-platform/policy` | **Política de messaging** — janelas, tags, o que é proibido |
| M17 | `https://developers.facebook.com/docs/graph-api/overview/rate-limiting/` | Modelo de rate limiting (BUC, headers de uso) |
| M18 | `https://developers.facebook.com/docs/instagram-api/changelog/` | Changelog / deprecações / versão corrente |
| M19 | Meta Platform Terms + Developer Policies (a IA deve localizar a URL corrente) | Base contratual, proibições |
| M20 | Instagram Platform Policy (a IA deve localizar a URL corrente) | Regras específicas do canal |

### 1.5 ⚠️ Achado estrutural: dois espaços de URL coexistem

O índice retornou o **mesmo assunto** em dois caminhos diferentes:

- `developers.facebook.com/docs/instagram-platform/webhooks`
- `developers.facebook.com/documentation/instagram-platform/webhooks`
- `developers.facebook.com/docs/messenger-platform/instagram/features/ice-breakers/`
- `developers.facebook.com/documentation/business-messaging/instagram-messaging/features/ice-breakers`

Isso indica **migração em andamento da documentação da Meta** (`/docs/` → `/documentation/`),
possivelmente com conteúdo divergente entre as duas árvores.
**Tarefa obrigatória da FASE 0:** determinar qual árvore é canônica hoje e registrar a decisão.
Usar a árvore errada é um vetor real de implementar comportamento obsoleto.

---

## 2. Tabela de hipóteses a validar

Legenda de evidência: `E1` indexado / `E2` secundário / `E3` conflitante / `E4` desconhecido.
**Status de disponibilidade de TODAS as linhas nesta sessão: `NÃO FOI POSSÍVEL CONFIRMAR`.**

| ID | Hipótese a validar | Ev. | Onde validar | Pergunta que a FASE 0 deve responder |
|---|---|---|---|---|
| H01 | Só contas **Profissionais** (Business/Creator) têm acesso à API; conta pessoal não tem | E2 | M02 | Quais tipos de conta exatamente? Creator tem paridade com Business? |
| H02 | Existem dois caminhos de auth: Instagram Login e Facebook Login, com **conjuntos de features diferentes** | E2 | M03/M04 | Qual caminho suporta messaging + comments + private replies simultaneamente? |
| H03 | O caminho Facebook Login exige Página do Facebook vinculada | E2 | M04 | Ainda é obrigatório? Muda por feature? |
| H04 | Janela de **24h** para mensagem livre após mensagem do usuário; reset a cada resposta dele | E2 | M16 | Confirmar duração, o que reseta, e o que conta como "livre" |
| H05 | Tag **`HUMAN_AGENT`** estende a janela para **7 dias**, só para resposta de agente humano | E2 | M16 | Existe no Instagram (não só Messenger)? Exige feature/permissão extra? |
| H06 | Fora da janela só é possível enviar via tags/templates aprovados | E2/E3 | M16 | Quais tags existem HOJE para Instagram especificamente? |
| H07 | **Private reply** a comentário: possível até **7 dias** após o comentário | E2 | M08 | Confirmar a janela real |
| H08 | **Uma única** private reply por comentário, para sempre | E2 | M08 | Confirmar; é por comentário, por usuário, ou por app? |
| H09 | Webhook de comentário existe e entrega o comentário em posts/reels | E1 | M12/M13 | Nome exato do campo e shape exato do payload |
| H10 | Existe campo de webhook para **live comments** (introduzido ~2021, v14.0) | E2 | M12/M18 | Ainda existe? Foi deprecado? Em qual versão? |
| H11 | Story **reply** e story **mention** chegam pelo webhook de mensagens (não por campo próprio) | E2 | M09/M12 | Como distinguir os dois no payload? |
| H12 | Envio suporta: texto, mídia, **quick replies**, template genérico, botões | E2/E3 | M05 | Quais desses valem no **Instagram** (vários docs citados são de Messenger)? |
| H13 | Quick replies limitadas a **13** botões | E2 | M05 | Número real; e limite de caracteres |
| H14 | Template genérico até **10** cards; botões máx. **3** por card | E2 | M05 | Vale no Instagram? |
| H15 | Botões/quick replies **não renderizam no Instagram web/desktop**, só no app | E2 | M05 | Confirmar — impacta expectativa do usuário no Flow Builder |
| H16 | **Ice breakers**: máximo **4** perguntas | E2 | M07 | Número real; é por conta ou por app? |
| H17 | **Persistent menu** existe para Instagram | E2/E4 | M05/M07 | Existe mesmo no IG ou só no Messenger? |
| H18 | Conversations API retorna todos os message IDs mas **detalhe só dos ~20 mais recentes** | E2 | M06 | Confirmar — **isso limita drasticamente o Inbox** |
| H19 | Rate limits de messaging | **E3** | M17 + M05 | Números reais. Fontes divergem em 25x (200/h vs 5000/h). **Nunca hardcodar.** |
| H20 | Permissões nomeadas `instagram_business_basic` e `instagram_business_manage_messages` | E2 | M02/M03 | Strings exatas hoje; `instagram_basic` foi mesmo deprecada? |
| H21 | Advanced Access exige **App Review + Business Verification** | E2 | M02 + M19 | Confirmar o fluxo e o que deve ser submetido junto |
| H22 | Sem App Review, dá para testar com um número limitado de usuários de teste | E2 | M02 | Qual limite exatamente? |
| H23 | Conversa deve ser **iniciada pelo usuário**; o negócio não abre conversa fria | E2 | M16 | Confirmar — **isso mata "broadcast frio" como feature** |
| H24 | Broadcast/sequência para base fria de Instagram é inviável pela política | E2 | M16 | Confirmar. Se verdadeiro, marcar como CAMADA 3 no produto |
| H25 | Meta recomenda informar o usuário que ele fala com automação | E2 | M16 | É recomendação ou requisito? |
| H26 | Tokens: tipo, TTL e mecanismo de refresh por caminho de auth | E4 | M03/M04 | Crítico para o job de renovação |
| H27 | Assinatura de webhook via header (HMAC com app secret) | E2 | M14 | Nome exato do header e algoritmo |
| H28 | Publicação de mídia / leitura de insights são APIs **separadas** do messaging | E1 | M01 | Escopo de permissão adicional? Fora do MVP? |

---

## 3. Conclusão da Frente 2

Nada foi confirmado. Mas a pesquisa produziu três decisões de arquitetura **robustas
independentemente de qual seja a resposta**:

1. **Deny-by-default.** Se a capacidade não estiver registrada como validada, a UI não a oferece
   e o motor não a executa. Isso torna o produto seguro mesmo com conhecimento incompleto.
2. **Limites descobertos em runtime, não hardcodados.** Dado H19 (`E3 — CONFLICTING`),
   o rate limiter deve se auto-ajustar pelos headers de uso retornados pela API.
3. **A janela de mensagem é estado de domínio de primeira classe.** Dado H04/H05/H07/H23,
   "posso enviar para este contato agora?" é uma pergunta que o sistema precisa saber responder
   a qualquer instante, e não uma checagem espalhada por chamadas soltas.
