# Matriz Manychat × Capacidade Real da Meta (Instagram)

> Coluna "Pode ser reproduzida?" nesta sessão só pode assumir três valores honestos:
> **SIM (interno)** = não depende de API externa;
> **DEPENDE** = depende de validação da FASE 0;
> **NÃO** = proibido por técnica/política independentemente da validação.

| # | Funcionalidade observada | Canal | Camada | API oficial correspondente (hipótese) | Pode ser reproduzida? | Restrição / o que valida |
|---|---|---|---|---|---|---|
| 1 | Flow Builder visual (nodes/edges) | — | L1 | — | **SIM (interno)** | Nenhuma. 100% nosso. |
| 2 | Rascunho + publicação + versionamento | — | L1 | — | **SIM (interno)** | Nenhuma. |
| 3 | Contacts, Tags, Custom Fields, Segments | — | L1 | — | **SIM (interno)** | Dados **derivados** de eventos que a API entregar. |
| 4 | Conditions / branching | — | L1 | — | **SIM (interno)** | Nenhuma. |
| 5 | Delay simples e delay com janela de horário | — | L1 | — | **SIM (interno)** | Precisa de fuso do workspace. |
| 6 | Analytics por automação / node / trigger | — | L1 | — | **SIM (interno)** | Só métricas derivadas de execuções reais. |
| 7 | Workspaces, papéis, RBAC, audit log | — | L1 | — | **SIM (interno)** | Nenhuma. |
| 8 | Templates de automação (lógica) | — | L1 | — | **SIM (interno)** | Nunca serializar credencial/ID externo. |
| 9 | External Request (HTTP node) | — | L1 | — | **SIM (interno)** | Exige SSRF guard (allow/deny list, sem IP privado). |
| 10 | Conectar conta Instagram (OAuth) | IG | L2 | OAuth Meta — M03/M04 | **DEPENDE** | H02, H03, H26. Qual caminho de auth. |
| 11 | Receber DM recebida | IG | L2 | Webhook de messages — M12 | **DEPENDE** | H09, H27. Nome do campo e payload. |
| 12 | Enviar DM (texto) | IG | L2 | Send/Messaging API — M05 | **DEPENDE** | H04, H19, H20, H23. Janela + limite + permissão. |
| 13 | Enviar mídia (imagem/vídeo/áudio) | IG | L2 | Messaging API — M05 | **DEPENDE** | H12, H19. Tipos suportados e limite próprio. |
| 14 | Quick replies / botões | IG | L2 | Messaging API — M05 | **DEPENDE** | H12, H13, H14, **H15 (não renderiza no desktop)**. |
| 15 | Trigger: keyword em DM | IG | L2+L1 | Webhook de messages + matching interno | **DEPENDE** | Matching é nosso; o evento é da API (H09). |
| 16 | Trigger: default reply (catch-all DM) | IG | L2+L1 | Idem | **DEPENDE** | Mesmo evento; regra de precedência é nossa. |
| 17 | Trigger: comentário em post/reel | IG | L2 | Webhook de comments — M12/M13 | **DEPENDE** | H09. Confirmar campo e se cobre reels. |
| 18 | **Comentário → DM privada** (o recurso-âncora) | IG | L2 | Private Replies — M08 | **DEPENDE** | **H07 (janela), H08 (1x por comentário)**. Recurso mais crítico do produto. |
| 19 | Responder ao comentário publicamente | IG | L2 | Comments API — M01/M13 | **DEPENDE** | Permissão distinta de messaging. Validar. |
| 20 | Trigger: story reply | IG | L2 | Webhook de messages — M09/M12 | **DEPENDE** | H11. Como distinguir de DM comum. |
| 21 | Trigger: story mention | IG | L2 | Webhook de messages — M09 | **DEPENDE** | H11. |
| 22 | Trigger: comentário em Live | IG | L2 | `live_comments` (?) — M12/M18 | **DEPENDE** | **H10 — pode estar deprecado.** Alto risco. Fora do MVP. |
| 23 | Ice breakers / conversation starters | IG | L2 | Ice Breakers — M07/M10 | **DEPENDE** | H16 (máx. 4?). |
| 24 | Persistent menu | IG | L2 | — | **DEPENDE** | **H17 — pode não existir no Instagram.** Não prometer. |
| 25 | Inbox com histórico completo da conversa | IG | L2 | Conversations API — M06 | **DEPENDE (provável limitação severa)** | **H18: detalhe só das ~20 mensagens mais recentes.** Ver nota abaixo. |
| 26 | Handoff automação → humano (7 dias) | IG | L2 | `HUMAN_AGENT` tag — M16 | **DEPENDE** | H05. Pode não existir no IG. |
| 27 | Broadcast para base fria | IG | L3 | — | **NÃO** | H23/H24: conversa precisa ser iniciada pelo usuário. |
| 28 | Sequência de nurture fora da janela | IG | L2/L3 | Tags de mensagem — M16 | **DEPENDE, provavelmente NÃO** | H06. Só com tag válida e motivo não-promocional. |
| 29 | Ler seguidores / DMs de terceiros / scraping | IG | **L3** | — | **NÃO** | Proibido. Sem exceção. |
| 30 | Login com senha do usuário / browser automation | IG | **L3** | — | **NÃO** | Viola Platform Terms e é vetor de ban. |
| 31 | Messenger (todo o conjunto) | FB | L2 | Messenger Platform | **FORA DO ESCOPO MVP** | Matriz própria, V2. |
| 32 | WhatsApp (todo o conjunto) | WA | L2 | Cloud API / WABA | **FORA DO ESCOPO MVP** | Matriz própria, V3. Regras totalmente distintas. |

---

## Nota crítica sobre a linha 25 (Inbox)

Se H18 se confirmar (histórico detalhado limitado às ~20 mensagens mais recentes por conversa
via API), então **o Inbox da DM FLOW não pode ser "espelho do Instagram"**. Ele precisa ser
**um livro-razão próprio**: cada mensagem que passa pelo nosso webhook ou pelo nosso envio é
persistida por nós, e o histórico exibido é *o nosso*, crescendo a partir do momento da conexão.

Isso muda o texto de UX ("Histórico desde a conexão da conta") e muda a retenção/LGPD.
É o tipo de decisão que precisa ser tomada **antes** de desenhar a tela, não depois.

## Nota crítica sobre a linha 18 (Comment → DM)

Este é **o recurso que vende o produto**. Se H08 estiver certo (uma private reply por comentário,
para sempre), então:
- reprocessar um evento **não pode** reenviar a private reply → idempotência é requisito de
  correção, não de performance;
- o produto precisa de um estado explícito `private_reply_used` por comentário;
- retry cego em erro de rede pode queimar a única chance → o retry precisa ser
  *condicional ao tipo de erro*, e o motor precisa distinguir "falhou antes de enviar" de
  "falhou depois de enviar".

Essa é a razão pela qual o Master Prompt trata idempotência como cláusula de primeira classe.
