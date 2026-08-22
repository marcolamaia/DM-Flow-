# MASTER PROMPT — CONSTRUIR A "DM FLOW"

> **Nota de idioma:** esta é a edição em português brasileiro. A edição completa em inglês
> está em `MASTER_PROMPT.en.md`. As duas são normativas e mantidas em sincronia.
> Use a que preferir — não misture as duas.

---

## 0. QUEM VOCÊ É E O QUE É ESTE DOCUMENTO

Você é um agente de engenharia full-stack sênior. Você vai construir a **DM FLOW**, uma
plataforma SaaS multi-tenant de automação de conversas no Instagram (com Facebook Messenger e
WhatsApp planejados como canais posteriores).

Este documento é a sua **especificação completa**. Ele é autossuficiente: você não deve
precisar de nenhuma outra entrada para saber o que construir, como pesquisar, o que está
proibido de inventar e em qual ordem entregar.

**Leia este documento inteiro antes de escrever uma única linha de código.**

Este documento foi escrito por um agente que **não conseguiu abrir a documentação oficial da
Meta** (o ambiente de pesquisa bloqueou `developers.facebook.com`). Isso não é uma falha do
plano — é exatamente a razão pela qual a FASE 0 existe e é obrigatória. Toda afirmação sobre
plataforma externa neste documento está rotulada como **hipótese que você precisa validar**,
nunca como fato.

---

## 1. DIRETRIZES PRIMÁRIAS (violar qualquer uma é falha de build)

### DP-1 — Nunca invente comportamento de plataforma externa
Você não pode inventar, adivinhar, extrapolar ou "assumir razoavelmente" nada do seguinte para
Instagram, Messenger, WhatsApp ou qualquer produto Meta:

- caminhos de endpoint, métodos HTTP ou URLs base
- formato de payload de requisição ou resposta
- strings de permissão / escopo
- nomes de campos de webhook, nomes de eventos ou estrutura de payload
- rate limits, cotas ou qualquer número-limite
- janelas de mensagem ou suas durações
- tags de mensagem
- requisitos de tipo de conta
- regras de política

Se você não consegue confirmar na **documentação oficial e atual da Meta**, você não implementa.
Você marca como `PENDING_VALIDATION` em `docs/meta-capabilities.md`, constrói o sistema ao redor
sem aquilo, e segue em frente. Uma funcionalidade ausente é um resultado normal. Uma
funcionalidade fabricada é um defeito que vai falhar em produção, na frente de um cliente pagante.

### DP-2 — Documentação oficial vence tudo
Ordem de prioridade para qualquer afirmação sobre plataforma externa:

1. Documentação oficial de desenvolvedor da Meta e páginas oficiais de política — **única fonte aceitável**
2. Documentação oficial das tecnologias que nós escolhemos (Next.js, Prisma, BullMQ etc.)
3. *(não existe terceiro nível)*

Blogs, Medium, YouTube, Reddit, StackOverflow, páginas de marketing de vendors, documentação de
concorrentes e **este próprio documento** **não** são fontes aceitáveis para uma capacidade da
Meta. Podem ser usados apenas para descobrir *onde procurar* — nunca como base de decisão de
implementação.

Se uma fonte secundária divergir da documentação oficial, a oficial vence e você registra a
divergência em `docs/known-limitations.md`.

### DP-3 — Negar por padrão
O sistema precisa ser arquitetado de forma que **uma capacidade não validada seja uma capacidade
indisponível**. Não "disponível e tomara que funcione". Indisponível. Invisível na UI. Rejeitada
pelo motor.

Esta é a consequência arquitetural mais importante da DP-1. É implementada pelo **Capability
Engine** (§7). Se você construir o Capability Engine corretamente, a DP-1 passa a ser imposta
estruturalmente em vez de ser uma regra que você precisa lembrar.

### DP-4 — Somente mecanismos autorizados
A DM FLOW integra com plataformas externas **exclusivamente** através de APIs oficiais,
documentadas e sancionadas, com autorização OAuth adequada do dono da conta.

Categoricamente proibido, sem exceção, sem "só para testar", sem "temporariamente":

- scraping de qualquer superfície do Instagram/Meta
- automação de navegador / browser headless dirigindo uma sessão logada
- armazenar ou usar senha de usuário final de conta Meta
- reuso de cookie de sessão, sessões roubadas ou emprestadas
- endpoints privados/internos obtidos por engenharia reversa
- bibliotecas não oficiais que emulam o cliente mobile ou web
- qualquer técnica cujo propósito seja burlar rate limit, detecção ou revisão

Se uma funcionalidade desejável só pode existir por um dos meios acima, essa funcionalidade
**não existe na DM FLOW**. Documente em `docs/known-limitations.md` na seção
"Deliberadamente não construído".

### DP-5 — Registre a data e a versão
Toda capacidade externa que você validar precisa ser registrada com:
- a URL exata da documentação que você leu
- a data em que você leu
- a versão da API que aquela documentação descreve

APIs mudam. Uma capacidade validada há oito meses voltou a ser hipótese.

### DP-6 — Nunca fabrique métricas
Analytics só pode exibir números derivados de dados que a DM FLOW realmente observou e
armazenou. Nada de alcance estimado, nada de impressões inferidas, nada de gráfico placeholder
com dados de exemplo indo para produção. Se uma métrica não pode ser calculada a partir de dado
real, ela não existe no produto.

### DP-7 — Pergunte, não adivinhe, em ambiguidade de produto
Se este documento for ambíguo sobre **comportamento de produto**, escolha a opção coerente mais
simples, implemente, e registre a decisão em `docs/architecture.md` na seção "Assumptions".
Se este documento for ambíguo sobre **comportamento de plataforma externa**, vale a DP-1: pare e
valide. Nunca resolva uma ambiguidade externa escolhendo.

---

## 2. VISÃO DO PRODUTO

### 2.1 O que a DM FLOW é

A DM FLOW transforma **engajamento público em conversa privada, automaticamente**.

Alguém comenta num post, responde um story, menciona a conta ou manda uma DM. A DM FLOW
reconhece esse evento e executa uma automação visual que o dono da conta construiu — enviando
uma resposta, aplicando tag, ramificando conforme o que já se sabe sobre a pessoa, esperando, e
continuando. Toda pessoa tocada vira um **Contact** persistente e segmentável, de propriedade
do negócio.

### 2.2 Para quem é

- Criadores e infoprodutores que monetizam audiência no Instagram
- E-commerce e negócios locais que vendem e atendem por DM
- Agências e times de social media gerenciando múltiplas contas de clientes
- Times de suporte e vendas que precisam de um inbox compartilhado em cima da automação

### 2.3 Proposta de valor

1. **Velocidade** — resposta em segundos, não em horas, a qualquer hora.
2. **Captura** — o engajamento deixa de ser efêmero e vira um registro de contato próprio.
3. **Segmentação** — tags e campos personalizados tornam a audiência endereçável.
4. **Visibilidade** — o operador vê o que rodou, o que funcionou e o que falhou, passo a passo.
5. **Segurança** — o produto se recusa a montar automações que a plataforma puniria.

O ponto 5 é diferencial, não limitação. Concorrentes deixam o usuário montar fluxos que falham
em silêncio ou que fazem a conta ser restringida. A DM FLOW avisa o usuário *antes* de ele montar.

### 2.4 Limites explícitos do produto (diga isso ao usuário, na UI)

- A DM FLOW não pode iniciar conversa com alguém que não interagiu antes, se a plataforma
  proibir. ⟨VALIDAR: H23⟩
- O histórico de conversa da DM FLOW começa quando a conta é conectada, e pode não refletir o
  histórico completo visível no app do Instagram. ⟨VALIDAR: H18⟩
- A DM FLOW não pode garantir entrega fora da janela de mensagens da plataforma. ⟨VALIDAR: H04⟩
- A DM FLOW não é um cliente de Instagram. Ela não navega, não segue, não curte e não posta em
  nome do usuário, a menos que uma API oficial validada suporte e o usuário tenha autorizado.

Esses limites vão no conteúdo de ajuda do produto e nos empty states. Ser honesto aqui evita o
pior desfecho de suporte que existe: o usuário achar que a ferramenta quebrou, quando na verdade
a plataforma nunca permitiu aquilo.

### 2.5 O que a DM FLOW não é

O Manychat é **referência conceitual da categoria de produto** — nada além disso.
Não copie código, identidade visual, textos, logo, ícones, ilustrações, assets, layouts ou
nomes proprietários de funcionalidade. Use o vocabulário genérico da categoria: workflow
builder, node, edge, trigger, action, condition, delay, inbox, contact, segment, analytics.

Projete a arquitetura, a UX, a hierarquia de informação e a linguagem visual próprias da DM FLOW.

---

## 3. AS TRÊS CAMADAS (classifique toda funcionalidade antes de construir)

Antes de implementar qualquer coisa, decida a qual camada aquilo pertence. Essa classificação
muda como você constrói, como você testa, e se você pode sequer entregar aquilo.

### CAMADA 1 — Funcionalidade interna da DM FLOW
Totalmente sob nosso controle. Sem dependência externa. Construa com confiança.

Dashboard · workspaces · usuários · papéis · permissões · base de contatos · tags ·
campos personalizados · segmentos · flow builder · versionamento de fluxo · motor de automação ·
condições · delays · analytics interno · histórico de execução · logs · audit log ·
templates · configurações · billing · notificações · i18n

### CAMADA 2 — Funcionalidade dependente de API externa
Cada uma exige validação na FASE 0 antes da implementação.

Conectar conta (OAuth) · receber DM · enviar DM · receber comentário · responder comentário ·
private reply de comentário para DM · eventos de story reply · eventos de story mention ·
enviar mídia · quick replies / botões · ice breakers · ler histórico de conversa ·
extensão de janela para atendimento humano

Construa tudo isso **atrás de uma interface de provider** (§8) e **atrás do Capability Engine**
(§7). Nunca chame uma API externa direto de um service, controller ou node do motor.

### CAMADA 3 — Proibida ou indisponível
Nunca construída, nunca simulada, nunca "contornada".

Qualquer coisa da DP-4 · broadcast frio, se a plataforma proibir ⟨VALIDAR: H23/H24⟩ ·
qualquer funcionalidade que exija endpoint privado · qualquer funcionalidade que só funcione
fingindo ser um usuário humano

Quando um usuário pedir uma funcionalidade de Camada 3, a resposta do produto é uma explicação
honesta de por que ela não existe, não uma imitação degradada.

---

## 4. FASE 0 — VALIDAÇÃO OBRIGATÓRIA DE CAPACIDADES (faça primeiro, antes de qualquer código de integração)

Você pode construir o scaffolding de Camada 1 em paralelo, mas **nenhuma linha de código de
Camada 2 existe antes que sua linha em `docs/meta-capabilities.md` esteja preenchida com uma
leitura real da documentação oficial.**

### 4.1 URLs de documentação para ler

Abra e leia cada uma. Elas foram confirmadas como existentes num índice de busca em 2026-08-22,
mas seu conteúdo **não** foi lido. Verifique se ainda resolvem; se alguma der 404, encontre o
equivalente atual e registre a mudança.

**Instagram Platform — fundação**
- `https://developers.facebook.com/docs/instagram-platform`
- `https://developers.facebook.com/docs/instagram-platform/overview/`
- `https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login`
- `https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login`

**Messaging**
- `https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/`
- `https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/conversations-api/`
- `https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/ice-breakers/`
- `https://developers.facebook.com/docs/messenger-platform/instagram/features/private-replies/`
- `https://developers.facebook.com/docs/messenger-platform/instagram/features/story-mention/`
- `https://developers.facebook.com/docs/messenger-platform/conversations/`

**Webhooks**
- `https://developers.facebook.com/docs/instagram-platform/webhooks`
- `https://developers.facebook.com/docs/graph-api/webhooks/reference/instagram`
- `https://developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-instagram/`

**Política, limites, review**
- `https://developers.facebook.com/documentation/business-messaging/messenger-platform/policy`
- `https://developers.facebook.com/docs/graph-api/overview/rate-limiting/`
- `https://developers.facebook.com/docs/instagram-api/changelog/`
- Meta Platform Terms, Meta Developer Policies, Instagram Platform Policy — localize as URLs atuais
- Documentação de Meta App Review e Business Verification — localize as URLs atuais

### 4.2 ⚠️ Primeira coisa a resolver: qual árvore de documentação é canônica

A indexação de busca revelou **os mesmos assuntos em dois caminhos diferentes**:

```
developers.facebook.com/docs/instagram-platform/webhooks
developers.facebook.com/documentation/instagram-platform/webhooks

developers.facebook.com/docs/messenger-platform/instagram/features/ice-breakers/
developers.facebook.com/documentation/business-messaging/instagram-messaging/features/ice-breakers
```

Isso sugere que a Meta está migrando `/docs/` → `/documentation/`, e as duas árvores podem
divergir. **Determine qual é a atual e registre a resposta no topo de `docs/meta-capabilities.md`.**
Construir contra uma árvore desatualizada é um modo de falha real e silencioso.

### 4.3 Perguntas que a FASE 0 precisa responder

Responda cada uma com citação. "Eu acho" não é resposta. Se uma pergunta não puder ser
respondida pela documentação oficial, a resposta é `NOT_CONFIRMED` e toda funcionalidade que
depende dela não é construída.

**Autenticação e contas**
1. Quais caminhos de API existem hoje, e o que cada um suporta?
2. Quais tipos de conta podem ser usados (Business / Creator / Pessoal), e há paridade de features?
3. Página do Facebook vinculada é obrigatória? Para qual caminho? Para quais features?
4. Quais são as strings exatas de permissão para: ler DMs, enviar DMs, ler comentários,
   responder comentários, private replies?
5. Quais tipos de token existem, qual o tempo de vida, e exatamente como são renovados?
6. O que precisa ser solicitado junto numa única submissão de App Review?
7. O que pode ser testado sem App Review, e com quantos usuários de teste?

**Webhooks**
8. Qual é a lista autoritativa de campos de webhook do Instagram disponíveis hoje?
9. Para cada campo de que precisamos: nome exato, formato exato de payload, garantias de entrega.
10. Como a autenticidade do webhook é verificada — nome exato do header, algoritmo, e segredo?
11. Qual é a resposta exigida (status code, body, tempo) a uma entrega de webhook?
12. Qual é o comportamento de retry quando falhamos em responder?
13. O campo `live_comments` ainda existe, ou foi deprecado? Em qual versão?

**Mensagens**
14. Qual é o endpoint e o payload exatos para enviar mensagem?
15. Quais tipos de mensagem são suportados **no Instagram especificamente** (não no Messenger)?
    Texto, imagem, vídeo, áudio, quick replies, botões, template genérico, compartilhamento de mídia?
16. Quais são os limites exatos: número de quick replies, contagem de caracteres, tamanho/formato de mídia?
17. Botões e quick replies renderizam em todas as superfícies do Instagram, ou só no app mobile?
18. Qual a duração da janela de mensagens, o que a reseta, e o que pode ser enviado dentro dela?
19. O que pode ser enviado **fora** da janela? Quais tags de mensagem existem hoje para Instagram?
20. Existe extensão de janela para agente humano no Instagram? Duração? Requisitos?
21. Um negócio pode iniciar conversa com um usuário que nunca mandou mensagem primeiro?

**Comentários e private replies**
22. Qual evento dispara quando alguém comenta num post ou reel?
23. Quanto tempo depois do comentário uma private reply ainda pode ser enviada?
24. Quantas private replies são permitidas por comentário — por app, por usuário, para sempre?
25. É exigida alguma interação adicional do usuário antes de uma private reply ser permitida?
26. A cobertura de comentários inclui reels? E inclui respostas a comentários (aninhados)?
27. Qual permissão é necessária para responder publicamente a um comentário, e ela é separada da de messaging?

**Stories**
28. Como chegam story replies e story mentions, e como são distinguidos no payload?
29. Existem janelas ou restrições separadas para conversas originadas de story?

**Histórico de conversa**
30. O que a Conversations API consegue retornar, e qual o limite real de detalhe de mensagem?
31. Conseguimos recuperar histórico anterior à conexão do nosso app com a conta?

**Limites**
32. Qual é o modelo real de rate limit? Por app, por conta, por endpoint?
33. Quais headers de resposta reportam o uso atual, para que os limites sejam descobertos em runtime?
34. Quais códigos de erro indicam throttling, e qual o backoff correto?

**Política**
35. Qual messaging automatizado é explicitamente proibido?
36. Informar ao usuário que ele fala com automação é recomendação ou requisito?
37. Quais são as consequências e mecanismos de enforcement para violações?

### 4.4 O formato de saída: `docs/meta-capabilities.md`

Este arquivo é a **única fonte da verdade** sobre o que a DM FLOW pode fazer. O Capability
Engine (§7) é alimentado por ele. Nada mais no código pode afirmar uma capacidade externa.

Uma linha por capacidade:

```markdown
### CAP_IG_SEND_TEXT

| Campo | Valor |
|---|---|
| Capability ID   | CAP_IG_SEND_TEXT |
| Canal           | instagram |
| Status          | AVAILABLE_OFFICIAL_API / AVAILABLE_WITH_RESTRICTIONS / REQUIRES_APP_REVIEW / REQUIRES_ADVANCED_ACCESS / DEPENDS_ON_ACCOUNT_TYPE / DEPENDS_ON_CHANNEL / NOT_AVAILABLE / NOT_CONFIRMED |
| Doc oficial     | <URL exata lida> |
| Data validação  | AAAA-MM-DD |
| Versão da API   | <versão que a doc descreve> |
| Permissões      | <strings exatas de escopo, ou NOT_CONFIRMED> |
| Tipos de conta  | <exato, ou NOT_CONFIRMED> |
| Endpoint        | <método + path exatos, ou NOT_CONFIRMED> |
| Pré-condições   | <estado da janela de mensagem, interação prévia etc.> |
| Limites         | <limites documentados exatos; anote se são descobertos em runtime> |
| Notas política  | <o que a política proíbe em torno disso> |
| Modos de erro   | <códigos de erro documentados e significados> |
| Confiança       | CONFIRMED / PARTIAL / UNCONFIRMED |
| Observações     | <ambiguidades, questões em aberto> |
```

**Regras deste arquivo:**
- Uma capacidade com `Status: NOT_CONFIRMED` **não pode** ser implementada, exposta na UI, nem
  referenciada por nenhum tipo de node.
- Uma linha com `Data validação` vazia é inválida.
- Revalidação é obrigatória se a linha tiver mais de 90 dias. Adicione um check de CI que
  **quebra o build** quando uma linha passar dessa idade. Isso transforma apodrecimento de
  documentação num evento visível e bloqueante.

### 4.5 Conflitos conhecidos entre fontes secundárias — resolva, não herde

A pesquisa que gerou este documento encontrou **fontes secundárias se contradizendo**.
Listadas aqui só para você saber quais números são minas terrestres. **Nenhum pode ser usado.**

| Assunto | Afirmações conflitantes encontradas | Ação |
|---|---|---|
| Rate limit de DM | 200/hora · 750/hora · 5.000/hora · 2 chamadas/s · 100 chamadas/s | Descobrir em runtime pelos headers de uso. Nunca hardcodar. |
| Private replies por comentário | "uma por comentário, para sempre" | Validar (P24). Tratar como tiro único até prova em contrário. |
| Janela de private reply | "7 dias" | Validar (P23). |
| Quantidade de quick replies | "até 13" | Validar (P16). |
| Ice breakers | "máx. 4" | Validar (P16/P20). |
| Histórico de conversa | "só as 20 mensagens mais recentes têm detalhe" | Validar (P30). Tem consequências graves para o Inbox. |
| Janela de agente humano | "7 dias via tag HUMAN_AGENT" | Validar (P20) — e validar se vale para Instagram. |
| Persistent menu no Instagram | afirmado por alguns vendors | Validar (P15). Pode não existir. |

---

## 5. ESCOPO E SEQUENCIAMENTO

Não tente construir tudo de uma vez. Entregue uma fatia vertical funcionando, depois alargue.

### MVP — um canal, um loop, bem feito
O objetivo do MVP é **um único loop confiável**: conectar Instagram → receber evento →
executar fluxo → enviar resposta → ver no analytics e no inbox.

- Auth: e-mail + senha, sessões, recuperação de senha, 2FA opcional
- Workspaces, membros, os 5 papéis, convites
- Conexão de conta Instagram via OAuth (o caminho que a FASE 0 validar)
- Ingestão de webhook: verificação de assinatura, deduplicação, persistência, fila
- Contacts com system fields, tags, custom fields
- Conversations e Messages (nosso próprio livro-razão)
- Flow Builder com: Trigger, Send Message (texto), Condition, Delay, Add Tag, Remove Tag,
  Set Custom Field, End
- Rascunho / publicação / versionamento
- Motor de automação com execuções duráveis e delays retomáveis
- Triggers: apenas os que a FASE 0 confirmar — realisticamente keyword em DM, default reply
  em DM, e comentário→private reply se validado
- Histórico de execução com detalhe por passo
- Analytics básico: execuções, conclusões, falhas, contagem por node
- Superfície de status de integração (§23)
- Taxonomia de erros (§24)
- Logs estruturados, métricas, traces
- i18n: en + pt-BR

### V1 — o produto vira competitivo
- Inbox compartilhado com atribuição, status, notas internas, handoff humano
- Nodes de mensagem rica: mídia, quick replies, botões — cada um gated pelo Capability Engine
- Triggers de story reply e story mention (se validados)
- Segments (filtros salvos) reutilizados em conditions e audiências
- Templates: exportar/importar lógica de automação
- Node de External Request com proteção contra SSRF
- Webhooks de saída e event bus para os clientes
- Analytics mais rico: funil por fluxo, drop-off por node, performance por trigger
- UI de audit log
- Analytics de performance de time no Inbox

### V2 — segundo canal
- Facebook Messenger, com matriz de capacidades **própria**, FASE 0 própria, provider próprio.
  Não reutilize as premissas do Instagram. Os canais são diferentes.
- Resolução de identidade de contato multi-conta e multi-canal
- Ramificação A/B e experimentos

### V3 — WhatsApp
- WhatsApp Business Platform (Cloud API): WABA, números de telefone, templates de mensagem e
  suas categorias de aprovação, janela de atendimento, requisitos de opt-in, quality rating,
  pricing.
- Este canal tem regras fundamentalmente diferentes — especialmente opt-in e templates.
  Exige passada de pesquisa própria, matriz própria e conceitos de UI próprios.
  **Não modele o WhatsApp como "Instagram com outro provider".**

### Futuro / adiado deliberadamente
- Nodes de resposta assistida por IA
- Marketplace público de templates
- Integrações nativas de e-commerce
- White-label para agências
- Apps mobile

---

## 6. ARQUITETURA E STACK (fixada — só divirja com justificativa escrita)

### 6.1 A stack

| Camada | Escolha | Justificativa |
|---|---|---|
| Linguagem | TypeScript, estrito | Um modelo de tipos do node do canvas até o payload do provider |
| Frontend | Next.js (App Router) + React | Shell com SSR, server components para listas pesadas |
| UI | Tailwind + primitivos Radix + design system próprio | Acessibilidade real sem visual reconhecível de terceiro |
| Canvas | React Flow (`@xyflow/react`) | Pan/zoom/handles/minimap já resolvidos; não reinvente |
| Dados no client | TanStack Query | Cache e invalidação sem store global |
| Backend | NestJS | Módulos e DI importam com providers plugáveis e um motor |
| Banco | PostgreSQL 16+ | Transações, JSONB, índices parciais/GIN, `FOR UPDATE SKIP LOCKED` |
| ORM | Prisma + SQL cru onde precisar | Migrations tipadas; SQL cru para analytics e locks |
| Cache/locks | Redis | Dedupe, locks distribuídos, contadores de rate, presence |
| Filas | BullMQ | Backoff, **delayed jobs** (exigidos pelos nodes de Delay), DLQ |
| Realtime | WebSocket + adapter Redis | Inbox ao vivo, status de execução |
| Storage | S3-compatível + URLs pré-assinadas | Nunca proxiar mídia pelo app server |
| Nossa auth | Cookie de sessão httpOnly + refresh rotativo; TOTP opcional | JWT em localStorage é caminho de XSS para takeover |
| Segredos | AES-256-GCM, envelope encryption, chave em KMS | Tokens de canal são a joia da coroa |
| Observabilidade | OpenTelemetry + Pino (JSON) + Sentry | O trace precisa atravessar webhook → fila → execução → chamada de API |
| Testes | Vitest, Supertest, Playwright, Testcontainers | Postgres e Redis reais nos testes de integração |
| Deploy | Docker; processos separados `web`, `api`, `worker`, `scheduler` | Ver 6.2 |

### 6.2 Topologia de processos — isto não é negociável

Rode **quatro tipos de processo separados**:

```
web        frontend Next.js
api        API HTTP + receptor de webhook + gateway WebSocket
worker     consumidores BullMQ: processamento de evento, execução de fluxo, chamadas externas
scheduler  timers: acordar execuções em delay, refresh de token, jobs de retenção, health checks
```

O receptor de webhook nunca pode compartilhar thread pool com a execução de fluxo. Se uma
automação lenta puder atrasar a resposta do webhook, então um pico de tráfego causa **perda de
entregas de webhook** — e uma entrega perdida é dado que não existe mais em lugar nenhum.
Isolamento aqui é propriedade de correção, não otimização.

### 6.3 Caminho de requisição de um evento de entrada

```
Meta → POST /webhooks/instagram
         ├─ verificar assinatura                    (401 se inválida)
         ├─ persistir payload cru em WebhookEvent   (append-only)
         ├─ enfileirar job com o id do WebhookEvent
         └─ retornar 200 imediatamente              (alvo < 200ms, sempre)
                    ↓
worker → deduplicar por id de evento do provider (Redis SETNX + unique constraint no banco)
       → normalizar em NormalizedEvent interno
       → resolver workspace / conta conectada / canal
       → resolver ou criar Contact + Conversation + Message
       → casar triggers publicados
       → criar Execution(s)
       → rodar o loop do motor
```

O handler HTTP faz **três** coisas: verificar, persistir, enfileirar. Qualquer lógica além
disso pertence ao worker.

---

## 7. O CAPABILITY ENGINE (o coração da DP-1 e da DP-3)

Este é o subsistema interno mais importante da DM FLOW. Construa cedo — antes do Flow Builder,
antes de qualquer provider — porque todo o resto depende dele.

### 7.1 O que ele faz

Ele responde uma única pergunta, em três momentos diferentes, com a mesma lógica:

> **"Esta ação é permitida, agora, para este canal, conta, contato e estado de conversa?"**

- **Em tempo de design** — o Flow Builder pergunta para decidir quais nodes mostrar e quais
  configurações permitir. O usuário não pode conseguir desenhar um fluxo impossível.
- **Em tempo de publicação** — a validação de fluxo pergunta para rejeitar um fluxo que
  referencia uma capacidade que não está mais disponível (permissão revogada desde a criação).
- **Em tempo de execução** — o motor pergunta imediatamente antes de executar um node de ação.

A mesma função de decisão serve aos três. Divergência entre regra de design e regra de runtime
é uma categoria de bug que produz fluxos que parecem válidos e falham em silêncio em produção.

### 7.2 Entradas de uma decisão de capacidade

```
capabilityId          ex.: CAP_IG_SEND_QUICK_REPLIES
channel               instagram | messenger | whatsapp
connectedAccount      tipo de conta, escopos concedidos, estado do token, status de app review
conversationState     timestamp da última mensagem de entrada, estado da janela, evento de origem
originEvent           o que iniciou esta execução (comentário / DM / story reply / manual)
actionContext         ex.: o id do comentário, e se a private reply já foi usada
now                   timestamp (janelas dependem do tempo)
```

### 7.3 Saída

Nunca um booleano. Uma decisão estruturada:

```ts
type CapabilityDecision =
  | { allowed: true; constraints?: CapabilityConstraint[] }
  | { allowed: false; reason: CapabilityDenialReason; userMessage: LocalizedMessage;
      remediation?: Remediation }

type CapabilityDenialReason =
  | 'NOT_VALIDATED'            // sem linha confirmada no registro de capacidades
  | 'MISSING_PERMISSION'       // escopo não concedido
  | 'ACCOUNT_TYPE_UNSUPPORTED'
  | 'APP_REVIEW_REQUIRED'
  | 'ADVANCED_ACCESS_REQUIRED'
  | 'OUTSIDE_MESSAGING_WINDOW'
  | 'ONE_SHOT_ALREADY_USED'    // ex.: private reply já enviada para este comentário
  | 'TOKEN_INVALID'
  | 'RATE_LIMITED'
  | 'POLICY_PROHIBITED'
```

`userMessage` é o que o operador vê. Precisa explicar a causa em linguagem simples e, quando
possível, oferecer `remediation` (reconectar a conta, solicitar a permissão, esperar o contato
responder). Nunca exponha erro cru do provider ao operador.

### 7.4 O registro de capacidades

Capacidades são **dado, não código**. Alimente-as a partir de `docs/meta-capabilities.md` para
um registro versionado (um manifesto TypeScript/JSON commitado, carregado no boot e cacheado).

Cada entrada carrega: id, canal, status, escopos exigidos, tipos de conta exigidos, requisitos
de janela, semântica de tiro único, limites documentados, data de validação e URL da doc.

**Regra dura:** uma capacidade cujo status não seja um dos status "disponíveis" resolve para
`allowed: false, reason: 'NOT_VALIDATED'` — sempre, em todo lugar, sem flag de override.
Não existe variável de ambiente que desligue isso. Se alguém precisar contornar, a ação
correta é validar a capacidade e atualizar o registro.

### 7.5 Estado da janela de mensagem como conceito de domínio de primeira classe

Como as regras de janela governam se uma ação é legal, o sistema precisa saber sempre o estado
de janela de uma conversa. Modele explicitamente em `Conversation`:

```
lastInboundAt          quando o contato nos mandou mensagem pela última vez
windowState            OPEN | EXTENDED | CLOSED | UNKNOWN
windowExpiresAt        calculado a partir de regras validadas — nunca de constante adivinhada
windowBasis            qual regra validada produziu isso (referência ao registro)
```

`windowExpiresAt` precisa derivar do registro de capacidades **validado**. Se a regra de janela
for `NOT_CONFIRMED`, `windowState` é `UNKNOWN` e o envio é negado. Esse é o comportamento
correto: recusar enviar é recuperável, enviar violando política pode não ser.

---

## 8. CAMADA DE INTEGRAÇÃO META (providers)

### 8.1 A regra

Nenhuma chamada à API da Meta pode se originar em qualquer lugar que não seja dentro de um
provider. Nem em controller, nem em service, nem em node do motor, nem em script. Faça grep do
cliente HTTP no código: todo resultado precisa estar dentro de `src/providers/`.

### 8.2 Interface de provider

Cada canal implementa uma interface comum. **A interface é definida pelo nosso domínio, não
pelo formato da API da Meta** — é isso que permite adicionar canais sem reescrever o motor.

```ts
interface ChannelProvider {
  readonly channel: Channel

  // ---- Autorização
  getAuthorizationUrl(params: AuthStartParams): string
  completeAuthorization(callback: AuthCallbackParams): Promise<ConnectedAccountDraft>
  refreshCredentials(account: ConnectedAccount): Promise<CredentialRefreshResult>
  revoke(account: ConnectedAccount): Promise<void>
  getAccountHealth(account: ConnectedAccount): Promise<AccountHealth>

  // ---- Webhooks
  verifyWebhookSignature(rawBody: Buffer, headers: Headers): boolean
  handleVerificationChallenge(query: Record<string, string>): string | null
  normalizeWebhook(raw: unknown): NormalizedEvent[]

  // ---- Ações de saída (cada uma passa pelo Capability Engine antes de ser chamada)
  sendMessage(ctx: SendContext, message: OutboundMessage): Promise<SendResult>
  replyToComment?(ctx: CommentContext, body: string): Promise<SendResult>
  sendPrivateReply?(ctx: CommentContext, message: OutboundMessage): Promise<SendResult>

  // ---- Leituras
  fetchConversations?(account: ConnectedAccount, cursor?: string): Promise<Page<RemoteConversation>>
  fetchMessages?(account: ConnectedAccount, conversationId: string, cursor?: string): Promise<Page<RemoteMessage>>

  // ---- Introspecção
  describeCapabilities(account: ConnectedAccount): Promise<CapabilitySnapshot>
}
```

Métodos opcionais (`?`) existem porque **nem todo canal suporta toda ação**, e um canal precisa
poder declarar honestamente que não suporta. Nunca implemente um método fingindo.

### 8.3 Restrições de implementação

- Métodos são implementados **apenas** para capacidades validadas na FASE 0. Um método não
  validado lança `CapabilityNotValidatedError` — ele não "tenta mesmo assim".
- Todos os caminhos de endpoint, strings de escopo, nomes de campo e strings de versão vivem em
  **um único arquivo de constantes por provider**, cada um anotado com a URL da doc e a data de
  validação. Nunca inline.
- A versão da API é explícita e configurável. Nunca chame endpoint sem versão.
- Toda chamada de provider passa por um cliente HTTP compartilhado com: timeout, política de
  retry que distingue erro retentável de terminal, circuit breaker, rate limiter alimentado
  pelos headers de resposta, e log completo de request/response **com segredos redigidos**.
- Toda chamada de provider emite um span OpenTelemetry com canal, capability id, id da conta
  e resultado.

### 8.4 Rate limiting: descubra, não hardcode

A pesquisa encontrou fontes secundárias divergindo por um fator de 25 nos limites de envio do
Instagram. Portanto:

- Faça parse dos headers de uso da plataforma em toda resposta e armazene o uso atual por conta.
- Implemente um limiter token-bucket cuja capacidade é **ajustada a partir dos headers
  observados**, partindo de um piso deliberadamente conservador.
- Em erro de throttling, faça backoff exponencial com jitter e baixe o teto local.
- Exponha o uso atual por conta conectada na UI, para o operador ver a folga.

Uma constante hardcodada tirada de um blog vai ou estrangular clientes sem necessidade ou fazer
a conta deles ser sinalizada. As duas coisas são piores que um limiter auto-ajustável.

---

## 9. MODELO DE DADOS MULTI-TENANT

### 9.1 Regras de tenancy

- `Workspace` é a fronteira de tenant. **Toda** tabela escopada por tenant carrega `workspaceId`.
- Habilite **Row Level Security** do PostgreSQL em toda tabela de tenant, com políticas ligadas
  a uma variável de sessão setada por requisição/job. Filtragem só na aplicação está a um
  `where` esquecido de distância de um vazamento entre tenants.
- Todo caminho de query escopado por tenant precisa ter teste que afirma que o workspace B não
  consegue ler as linhas do workspace A.
- Chaves primárias: UUID v7 (ordenável por tempo, evita hotspot de índice, não enumerável).
- Todos os timestamps `timestamptz`, armazenados em UTC. Fuso do workspace é questão de exibição
  e agendamento, guardado em `Workspace`.
- Soft-delete (`deletedAt`) para entidades de usuário; hard-delete só para apagamento LGPD (§19).

### 9.2 Entidades

Valide e melhore este modelo — ele é um ponto de partida forte, não um schema finalizado.

**Identidade e tenancy**
- `User` — id, email (citext, único), passwordHash (argon2id), name, avatarUrl, locale,
  totpSecret (cifrado), emailVerifiedAt, lastLoginAt, timestamps
- `Workspace` — id, name, slug, timezone, locale, planId, status, timestamps
- `WorkspaceMember` — id, workspaceId, userId, role, invitedBy, joinedAt; unique(workspaceId, userId)
- `Invitation` — id, workspaceId, email, role, token (com hash), expiresAt, acceptedAt
- `Session` — id, userId, refreshTokenHash, userAgent, ip, expiresAt, revokedAt

**Conexão de canal**
- `ConnectedAccount` — id, workspaceId, channel, externalAccountId, username, displayName,
  avatarUrl, accountType, grantedScopes (text[]), accessTokenEnc, refreshTokenEnc,
  tokenExpiresAt, status, lastHealthCheckAt, lastErrorCode, connectedByUserId, timestamps;
  unique(channel, externalAccountId) — uma conta externa, um workspace
- `ChannelSubscription` — id, connectedAccountId, webhookFields (text[]), subscribedAt,
  status, lastVerifiedAt

**Pessoas e conversas**
- `Contact` — id, workspaceId, primaryChannel, displayName, avatarUrl, locale, timezone,
  status (ACTIVE / UNSUBSCRIBED / BLOCKED), source, firstSeenAt, lastInteractionAt,
  consentState, consentUpdatedAt, timestamps
- `ContactIdentity` — id, workspaceId, contactId, channel, connectedAccountId,
  externalUserId, username, timestamps; unique(channel, connectedAccountId, externalUserId).
  **Separada de Contact para que uma pessoa possa ser unificada entre canais depois.**
- `Conversation` — id, workspaceId, contactId, connectedAccountId, channel,
  externalConversationId, status (OPEN / SNOOZED / CLOSED), assigneeId, lastInboundAt,
  lastOutboundAt, windowState, windowExpiresAt, windowBasis, unreadCount, timestamps
- `Message` — id, workspaceId, conversationId, direction (INBOUND / OUTBOUND),
  externalMessageId, senderType (CONTACT / AUTOMATION / AGENT / SYSTEM), senderUserId,
  contentType, content (jsonb), attachments (jsonb), status (QUEUED / SENT / DELIVERED /
  FAILED), failureCode, executionId, sentAt, timestamps;
  unique(workspaceId, externalMessageId) quando externalMessageId não é nulo
- `ConversationNote` — id, workspaceId, conversationId, authorUserId, body, timestamps

**Segmentação**
- `Tag` — id, workspaceId, name, color, description; unique(workspaceId, name)
- `ContactTag` — contactId, tagId, appliedAt, appliedBy (jsonb: usuário ou automação);
  primary key(contactId, tagId)
- `CustomField` — id, workspaceId, key, label, type (TEXT / NUMBER / BOOLEAN / DATE /
  DATETIME / SELECT), options (jsonb), scope (CONTACT), timestamps; unique(workspaceId, key)
- `CustomFieldValue` — id, workspaceId, contactId, customFieldId, value (jsonb);
  unique(contactId, customFieldId)
- `Segment` — id, workspaceId, name, filter (jsonb — a AST do predicado), timestamps

**Automação**
- `Automation` — id, workspaceId, name, description, status (DRAFT / PUBLISHED / PAUSED /
  ARCHIVED), publishedVersionId, draftVersionId, folderId, createdBy, timestamps
- `AutomationVersion` — id, workspaceId, automationId, versionNumber, graph (jsonb),
  schemaVersion, publishedAt, publishedBy, changelog, validationReport (jsonb).
  **Imutável depois de publicada.**
- `Trigger` — id, workspaceId, automationId, automationVersionId, type, channel,
  connectedAccountId, config (jsonb), matchPriority, enabled, timestamps
- `Node` e `Edge` — podem ser tabelas normalizadas ou viver dentro de
  `AutomationVersion.graph` como JSONB. **Recomendação: JSONB dentro da versão.** Uma versão
  publicada precisa ser um snapshot atômico e imutável; linhas normalizadas dificultam isso e
  compram pouco, já que o grafo é sempre lido inteiro. Indexe o que precisar consultar (tipos de
  trigger, referências de capacidade) em colunas separadas ou numa tabela de projeção.

**Execução**
- `Execution` — id, workspaceId, automationId, automationVersionId, contactId,
  conversationId, triggerId, triggerEventId, status (RUNNING / WAITING / COMPLETED /
  FAILED / CANCELLED), currentNodeId, variables (jsonb), resumeAt, attemptCount,
  startedAt, finishedAt, lastError (jsonb), timestamps
- `ExecutionStep` — id, workspaceId, executionId, nodeId, nodeType, sequence, status,
  input (jsonb), output (jsonb), errorCode, errorDetail (jsonb), startedAt, finishedAt,
  durationMs
- `IdempotencyRecord` — id, workspaceId, scope, key, resultRef, createdAt, expiresAt;
  unique(workspaceId, scope, key). **É isto que protege ações de tiro único como private replies.**

**Eventos e integrações**
- `WebhookEvent` — id, workspaceId (nulo até ser resolvido), channel, providerEventId,
  receivedAt, rawPayload (jsonb), signatureValid, status (RECEIVED / PROCESSING / PROCESSED /
  FAILED / DISCARDED), processedAt, attemptCount, lastError, dedupeKey;
  unique(channel, providerEventId). **Append-only.** É esta tabela que torna o replay possível.
- `OutboundWebhook` — id, workspaceId, url, secret (cifrado), events (text[]), enabled, timestamps
- `OutboundWebhookDelivery` — id, workspaceId, outboundWebhookId, eventType, payload (jsonb),
  responseStatus, attemptCount, nextAttemptAt, status
- `Integration` — id, workspaceId, type, name, config (jsonb, segredos cifrados), status, timestamps
- `AutomationTemplate` — id, workspaceId (nulo para global), name, description, category,
  graph (jsonb), requiredCapabilities (text[]), createdBy, visibility, timestamps

**Governança**
- `AuditLog` — id, workspaceId, actorType (USER / SYSTEM / AUTOMATION), actorUserId, action,
  entityType, entityId, before (jsonb), after (jsonb), ip, userAgent, createdAt.
  **Append-only, nunca atualizado nem deletado por código de aplicação.**
- `ApiKey` — id, workspaceId, name, keyHash, prefix, scopes (text[]), lastUsedAt, expiresAt,
  revokedAt, createdBy
- `DataSubjectRequest` — id, workspaceId, contactId, type (EXPORT / ERASURE), status,
  requestedAt, completedAt, requestedBy, artifactRef

### 9.3 Indexação e retenção

- Indexe toda foreign key usada em caminho quente.
- Índices compostos que casam com padrões reais de acesso:
  `(workspaceId, lastInteractionAt DESC)` em Contact,
  `(workspaceId, status, assigneeId)` em Conversation,
  `(conversationId, createdAt DESC)` em Message,
  `(workspaceId, automationId, startedAt DESC)` em Execution,
  `(status, resumeAt)` em Execution — este dirige o scheduler.
- Particione ou faça roll temporal das tabelas append-only de alto volume (`WebhookEvent`,
  `ExecutionStep`, `Message`) desde o primeiro dia. Retrofit de particionamento sob carga dói.
- A política de retenção é configurável por workspace e imposta por job agendado (§19).

---

## 10. INGESTÃO DE EVENTOS

### 10.1 Recepção

```
POST /webhooks/:channel
  1. Ler o body CRU — verificação de assinatura exige os bytes exatos.
     Configure o framework para preservar o buffer bruto antes do parse de JSON.
  2. Verificar assinatura via provider.verifyWebhookSignature().
     Inválida → 401, logar, não processar, não retentar.
  3. Inserir WebhookEvent (append-only) com rawPayload e providerEventId.
     Unique constraint em (channel, providerEventId) torna insert duplicado inofensivo.
  4. Enfileirar { webhookEventId } na fila de ingestão.
  5. Retornar 200. Alvo p99 < 200ms.

GET /webhooks/:channel
  Handshake de verificação, via provider.handleVerificationChallenge().
```

**Nunca** faça lógica de negócio no handler HTTP. Se o passo 4 falhar, ainda assim retorne 200 —
o evento está persistido e um job de reconciliação vai pegá-lo. Retornar não-200 faz a
plataforma retentar, o que é aceitável, mas persistir-e-falhar-ao-enfileirar não pode perder
o evento.

### 10.2 Processamento

```
worker:
  1. Carregar WebhookEvent, marcar PROCESSING (com lock otimista em attemptCount)
  2. Deduplicar: Redis SETNX no dedupeKey com TTL, respaldado pela unique constraint do banco
  3. provider.normalizeWebhook(raw) → NormalizedEvent[]
     Uma única entrega pode conter múltiplos eventos lógicos. Trate cada um independentemente.
  4. Para cada NormalizedEvent:
       resolver ConnectedAccount pelo id externo de conta → workspace
       conta desconhecida → status DISCARDED com motivo (NÃO entre em loop de erro)
       resolver/criar Contact + ContactIdentity
       resolver/criar Conversation; atualizar lastInboundAt e estado da janela
       persistir Message se o evento carregar uma
       emitir evento de domínio interno
  5. Casamento de triggers (§12.1)
  6. Marcar PROCESSED
```

### 10.3 Requisitos de confiabilidade

- **Idempotência** — processar o mesmo `WebhookEvent` duas vezes precisa produzir o mesmo
  estado final e não pode enviar uma segunda mensagem. Garantido por `IdempotencyRecord` no
  nível da ação, não só por dedupe na ingestão. Dedupe pode falhar; idempotência no ponto do
  efeito colateral não pode ser pulada.
- **Retries** — backoff exponencial com jitter. Distinga retentável (rede, 5xx, throttling) de
  terminal (assinatura inválida, conta desconhecida, payload malformado, permissão revogada).
  Nunca retente um erro terminal.
- **Dead-letter queue** — após o máximo de tentativas, mova para DLQ com contexto completo.
  Profundidade da DLQ é métrica de alerta. Forneça UI admin para inspecionar e reenfileirar.
- **Timeouts** — toda chamada externa e todo job com timeout explícito. Um job sem timeout é um
  job que pode travar um worker para sempre.
- **Event replay** — como `WebhookEvent` é append-only com payloads crus, você pode reprocessar
  um intervalo de tempo de um workspace depois de corrigir um bug. Construa isso como ferramenta
  admin desde o começo.
  ⚠️ O replay precisa rodar em modo que **suprime efeitos colaterais de saída por padrão**, com
  opt-in explícito para reenviar. Reprocessar um dia de eventos de comentário e reenviar toda
  private reply seria catastrófico e, se private replies forem de tiro único, irreversível.
- **Observabilidade** — conte recebidos / processados / falhos / descartados, e meça a latência
  recepção→processamento. Alerte em atraso de ingestão.

---

## 11. MOTOR DE AUTOMAÇÃO

### 11.1 Modelo de execução

Uma `Execution` é uma **máquina de estados durável**, persistida no Postgres. Não é chamada de
função, não é objeto em memória, e não é mensagem de fila. Um Delay de três dias significa que
a Execution dorme por três dias e retoma exatamente no node onde parou, atravessando deploys,
reinícios e flush do Redis.

```
loop:
  carregar Execution FOR UPDATE (lock de linha — um worker por execução, sempre)
  resolver o node atual a partir do grafo da AutomationVersion PUBLICADA
  criar ExecutionStep (status RUNNING)
  executar node:
      Trigger        → ponto de entrada, avaliar condições de entrada
      SendMessage    → perguntar ao Capability Engine → chamada de provider → persistir Message
      Condition      → avaliar predicado → escolher a edge de saída
      Delay          → status WAITING + resumeAt → agendar acordar → RETORNAR
      AddTag / RemoveTag / SetCustomField → mutar estado do contato
      Webhook        → HTTP de saída (com guarda SSRF)
      Branch         → divisão multi-caminho
      End            → status COMPLETED
  persistir resultado do ExecutionStep
  avançar currentNodeId
  se terminal → finalizar; senão → continuar o loop
```

### 11.2 Propriedades inegociáveis do motor

1. **Execuções rodam contra a versão publicada em que começaram.** Editar ou republicar uma
   automação nunca pode mutar uma execução em voo. É por isso que `AutomationVersion` é imutável
   após publicação.
2. **Um worker por execução por vez.** Use `SELECT … FOR UPDATE` (ou `SKIP LOCKED` ao reivindicar
   trabalho). Dois workers avançando a mesma execução vão enviar em duplicidade.
3. **Todo efeito colateral é idempotente.** Antes de qualquer ação de saída, grave um
   `IdempotencyRecord` chaveado por `(executionId, nodeId, chave invariante à tentativa)`. Se o
   registro existir com resultado, retorne aquele resultado em vez de reexecutar.
4. **Distinga "falhou antes do efeito colateral" de "falhou depois".** Um timeout de rede num
   envio é ambíguo: a mensagem pode ou não ter saído. Registre a intenção *antes* da chamada e
   reconcilie *depois*. Para capacidades de tiro único (private replies), um desfecho ambíguo
   precisa ser tratado como **usado**, não como retentável. Perder uma resposta é muito melhor do
   que queimar a única tentativa permitida ou mandar mensagem dobrada para um cliente.
5. **Orçamento de passos e proteção contra loop.** Limite passos por execução e detecte ciclos.
   O usuário pode, e vai, desenhar um loop infinito.
6. **Correção do Delay.** `resumeAt` fica no banco; o scheduler consulta
   `Execution WHERE status='WAITING' AND resumeAt <= now()`. Não dependa só de mensagem de fila
   adiada — Redis é transporte, Postgres é verdade. Se um Delay tiver janela de horário
   permitido, calcule o próximo instante válido usando o fuso do workspace (e do contato, se
   conhecido), incluindo transições de horário de verão.
7. **Cancelamento.** Execuções podem ser canceladas pelo operador, por descadastro do contato,
   por desconexão da conta, ou por uma nova execução as substituindo conforme política do fluxo.
8. **Política de concorrência por contato.** Decida e torne configurável: um contato pode estar
   em duas execuções da mesma automação ao mesmo tempo? Padrão: não — reentrada ou reinicia ou é
   ignorada, conforme configuração do fluxo. Entregue um padrão; deixe explícito na UI.
9. **Checagem de capacidade em runtime, não só em design time.** Permissões são revogadas,
   janelas fecham, tokens expiram entre a publicação e a execução. Cheque imediatamente antes de agir.
10. **Falha estruturada.** Um passo que falha registra um erro tipado (§24), nunca uma string solta.

### 11.3 Variáveis e expressões

- As `variables` da execução guardam dados do payload do trigger, campos do contato e saídas de passos.
- Conteúdo de mensagem suporta interpolação de campos de contato e variáveis.
- **O avaliador de expressões precisa ser um avaliador sandboxed e não-Turing-completo sobre uma
  AST com allow-list.** Nunca `eval`, nunca `new Function`, nunca uma linguagem de script
  completa. Isto é multi-tenant: uma expressão é entrada não confiável rodando nos nossos servidores.
- A resolução de variável indefinida tem comportamento definido e documentado (valor padrão ou
  falha do passo — escolha um, deixe visível no builder).

---

## 12. TRIGGERS E ACTIONS

### 12.1 Casamento de triggers

Quando um `NormalizedEvent` é resolvido, encontre triggers candidatos:

```
triggers WHERE workspaceId = ?
             AND channel = ?
             AND connectedAccountId IN (?, NULL)
             AND type = <tipo do evento>
             AND enabled = true
             AND automationVersionId = automation.publishedVersionId
```

Depois aplique, nesta ordem:
1. **Especificidade** — um trigger escopado a um post/keyword específico vence um catch-all.
2. **Prioridade explícita** — `matchPriority`, controlado pelo operador.
3. **Desempate determinístico** — data de criação. Nunca aleatório.

Defina e documente se um evento pode iniciar múltiplas automações. **Padrão: uma.**
O trigger de maior rank vence; os outros são registrados como "casou mas não rodou", para o
operador conseguir depurar por que o fluxo dele não disparou. Essa superfície de depuração
importa mais do que parece — "por que minha automação não rodou" é a principal pergunta de
suporte nesta categoria.

Triggers catch-all (default reply) só podem casar quando nenhum trigger específico casou.

### 12.2 Registro de triggers — popule SOMENTE a partir de capacidades validadas

Todo tipo de trigger precisa ser declarado com estes metadados antes de existir no produto:

```ts
interface TriggerDefinition {
  type: string                     // 'instagram.comment', 'instagram.dm.keyword', ...
  channel: Channel
  requiredCapabilities: string[]   // ids de capacidade que precisam estar AVAILABLE
  sourceWebhookField: string       // nome exato validado do campo — NUNCA adivinhado
  payloadSchema: JSONSchema        // formato exato validado do payload
  configSchema: JSONSchema         // o que o operador configura
  accountRequirements: string[]
  limitations: LocalizedText       // exibido no builder, no idioma do operador
  docReference: { url: string; validatedAt: string; apiVersion: string }
}
```

**Tipos candidatos de trigger, todos pendentes da FASE 0:**

| Candidato | Status até validar | Depende de |
|---|---|---|
| DM recebida — casamento por keyword | PENDING_VALIDATION | P8, P9, P14 |
| DM recebida — default/catch-all | PENDING_VALIDATION | P8, P9 |
| Comentário em post ou reel | PENDING_VALIDATION | P22, P26 |
| Story reply | PENDING_VALIDATION | P28 |
| Story mention | PENDING_VALIDATION | P28 |
| Comentário em Live | PENDING_VALIDATION — **pode estar deprecado** | P13 |
| Ice breaker / conversation starter selecionado | PENDING_VALIDATION | P15, P20 |
| Inscrição manual pelo operador | **DISPONÍVEL — Camada 1** | — |
| Tag adicionada ao contato | **DISPONÍVEL — Camada 1** | — |
| Chamada de API/webhook de entrada na DM FLOW | **DISPONÍVEL — Camada 1** | — |

Triggers de Camada 1 podem ser construídos imediatamente e são uma ótima forma de testar o motor
de ponta a ponta antes de existir qualquer integração com a Meta. **Faça isso.** Permite validar
o motor inteiro com zero dependência externa.

### 12.3 Registro de actions

Mesma disciplina. Toda ação declara:

```ts
interface ActionDefinition {
  type: string
  channel: Channel | 'internal'
  requiredCapabilities: string[]
  configSchema: JSONSchema
  preconditions: PreconditionRule[]   // ex.: janela de mensagem precisa estar OPEN
  idempotency: 'NONE' | 'PER_EXECUTION_NODE' | 'ONE_SHOT_GLOBAL'
  errorMapping: Record<string, InternalErrorCode>
  docReference?: { url: string; validatedAt: string; apiVersion: string }
}
```

**Ações internas (Camada 1 — construa agora):**
Add Tag · Remove Tag · Set Custom Field · Clear Custom Field · Branch · Condition · Delay ·
External HTTP Request · Emitir webhook de saída · Notificar membro do time · Atribuir conversa ·
Definir status da conversa · Descadastrar contato · Encerrar execução

**Ações de canal (Camada 2 — pendentes de validação):**
Enviar texto · Enviar mídia · Enviar quick replies · Enviar botões · Responder comentário
publicamente · Enviar private reply a um comentário · Definir ice breakers ·
Marcar como visto / indicador de digitando

Repare em `idempotency: 'ONE_SHOT_GLOBAL'` — reservado para ações como private replies, onde a
plataforma pode permitir exatamente uma tentativa por alvo, para sempre. Estas precisam de uma
chave de idempotência global escopada ao alvo (o id do comentário), não à execução. Duas
automações diferentes não podem cada uma queimar uma tentativa no mesmo comentário.

---

## 13. FLOW BUILDER

### 13.1 Canvas
- Pan, zoom (com ajustar-à-tela e zoom-na-seleção), minimapa, snap em grade
- Multi-seleção, seleção por caixa, copiar/colar, duplicar, alinhar/distribuir
- Teclado: deletar, desfazer (Cmd/Ctrl+Z), refazer, salvar, buscar nodes, navegar entre nodes
- Busca de node / paleta de comandos para adicionar nodes
- Auto-layout como ação explícita do usuário, nunca automático ao carregar (embaralharia um
  layout que o usuário arrumou de propósito)

### 13.2 Nodes
Trigger · Send Message · Condition · Branch · Delay · Add Tag · Remove Tag ·
Set Custom Field · HTTP Request · Notify · Assign · End

**Nodes dependentes de canal aparecem somente quando o Capability Engine permite para a conta
conectada.** Não apenas esmaecidos com um cadeado e um tooltip bonito — de fato filtrados da
paleta quando a capacidade é `NOT_VALIDATED`. Mostre capacidades indisponíveis-mas-conhecidas
(ex.: `APP_REVIEW_REQUIRED`) como desabilitadas, com motivo claro e link de remediação. A
diferença importa: "não verificamos se isso existe" e "isso existe mas você precisa de
aprovação" são mensagens diferentes para um operador.

### 13.3 Modelo de edição
- **Autosave do rascunho** com debounce; "Publicar" explícito para a versão ao vivo
- Atualizações locais otimistas; detecção de conflito se a mesma automação for editada em duas abas
- Undo/redo sobre uma pilha de comandos (não snapshots ingênuos de estado completo — o canvas
  fica grande)
- Histórico de versões com visualização de diff e restauração em um clique
- Estados de rascunho e publicado sempre claramente distinguidos na UI

### 13.4 Validação (roda continuamente, bloqueia a publicação)
- Trigger presente e configurado
- Sem nodes inalcançáveis; sem node sem caminho até um End
- Sem ciclos sem delay ou guarda de iteração limitada
- Toda configuração obrigatória de node preenchida
- **Todas as capacidades referenciadas atualmente disponíveis** — esta é a checagem que impede
  publicar um fluxo que vai falhar em runtime
- Referências de variável resolvem
- Conteúdo de mensagem dentro dos limites validados de tamanho
- Erros e avisos distinguidos: erros bloqueiam a publicação, avisos não
- Clicar numa mensagem de validação foca e destaca o node problemático

### 13.5 Teste e depuração
- **Modo de teste**: rodar o fluxo contra um contato de teste designado, com o Capability Engine
  em modo estrito e chamadas de saída ou reais (para uma conta de teste) ou capturadas num painel
  de preview. Deixe inequivocamente óbvio qual dos dois está acontecendo.
- **Inspetor de execução ao vivo**: por execução, mostrar o caminho percorrido no grafo com
  tempos por node, entradas, saídas e erros — sobreposto no próprio canvas.
- O canvas de um fluxo publicado mostra contagens agregadas por node (quantos contatos chegaram,
  quantos falharam ali). É assim que operadores encontram drop-off.

---

## 14. INBOX

### 14.1 A restrição crítica de design

⚠️ A pesquisa sugere que a API de conversas da plataforma pode retornar **conteúdo detalhado
apenas de um número pequeno de mensagens recentes** por conversa ⟨VALIDAR: P30⟩. Se isso se
confirmar, então:

**O Inbox da DM FLOW não é um espelho do Instagram. É o nosso próprio livro-razão.**

Toda mensagem que recebemos via webhook e toda mensagem que enviamos é persistida por nós.
O histórico que exibimos é o histórico que registramos, começando no momento em que a conta
foi conectada.

Isso precisa estar dito com todas as letras na UI — uma linha de empty state tipo
*"O histórico começa quando você conectou esta conta"* — e refletido em
`docs/known-limitations.md`. Não deixe o usuário acreditar que faltam mensagens por causa de bug.

### 14.2 Funcionalidades
- Lista unificada de conversas entre contas conectadas, com atualização em tempo real por WebSocket
- Filtros: canal, status, responsável, tag, não lidas, estado de janela, período, busca
- Atribuição: a um membro ou time; fila de não atribuídas; regras de atribuição
- Status: aberta / adiada (com horário de retorno) / fechada
- Painel do contato ao lado da thread: identidade, tags, campos personalizados, origem, última
  interação, execuções ativas, e **estado atual da janela de mensagem com contagem regressiva**
- Notas internas (nunca enviadas ao contato — deixe isso visualmente inequívoco)
- Handoff humano: pausar automações desta conversa enquanto um humano atende, com retomada explícita
- Respostas prontas / salvas
- Indicadores de digitação e presença dos agentes

### 14.3 Envio a partir do Inbox
Todo envio manual passa pelo **mesmo Capability Engine** dos envios automatizados. Se a janela
estiver fechada, o compositor fica desabilitado com explicação clara e, onde existir mecanismo
validado (ex.: extensão para agente humano ⟨VALIDAR: P20⟩), ele é oferecido explicitamente com
suas condições declaradas — nunca aplicado em silêncio. Um operador precisa saber quando está
usando um mecanismo de exceção.

---

## 15. CONTATOS

- Lista com busca, filtros, segmentos salvos, ordenação, paginação, ações em massa
- Detalhe do contato: identidades por canal, tags, campos personalizados, histórico de conversa,
  histórico de execuções, origem, estado de consentimento, timeline de tudo que aconteceu
- Importação por CSV **somente onde houver base legal legítima** — e note que contatos importados
  geralmente não podem ser mensageados, porque enviar exige a janela da plataforma e o contato
  precisa ter iniciado. Diga isso durante a importação, ou você vai entregar uma funcionalidade
  que gera tickets de suporte e violação de política. ⟨VALIDAR: P21⟩
- Exportação (CSV/JSON), respeitando permissões e gerando entrada de audit log
- Mesclar contatos duplicados entre canais, com trilha de auditoria reversível
- Estado de descadastro/bloqueio que o motor **precisa** honrar antes de qualquer envio
- Caminho completo de exclusão para apagamento LGPD (§19)

---

## 16. ANALYTICS

Somente métricas reais e derivadas. Sem estimativas, sem placeholders.

**Nível de automação:** execuções iniciadas / concluídas / falhas / canceladas, taxa de
conclusão, duração mediana e p95, execuções ao longo do tempo, principais triggers.

**Nível de node:** entrou, saiu, falhou, drop-off entre nodes, tempo médio de permanência,
detalhamento de erros por node. Renderizado como sobreposição no canvas do fluxo.

**Nível de mensagem:** mensagens enviadas / entregues / falhas por tipo e por canal, motivos de
falha agrupados por código interno de erro, volume de entrada, taxa de resposta (contato
respondeu após nossa mensagem), tempo mediano até a primeira resposta.

**Contatos:** novos contatos ao longo do tempo, por origem, por trigger; distribuição de tags;
ativos vs descadastrados.

**Inbox:** conversas abertas/fechadas, tempo mediano de primeira resposta, tempo mediano de
resolução, volume por responsável, idade da fila.

**Saúde de integração:** erros de API por código, uso de rate limit ao longo do tempo, volume de
entregas de webhook e atraso de processamento, folga até expiração de token.

Notas de implementação: pré-agregue em tabelas de rollup via jobs agendados para qualquer coisa
que cubra intervalos longos. Não calcule dashboards com varredura ao vivo sobre `ExecutionStep`
— é a maior tabela do sistema. Defina toda métrica precisamente em `docs/analytics.md`;
definição ambígua de métrica destrói a confiança num dashboard mais rápido do que métrica ausente.

---

## 17. TEMPLATES

- Salvar a **lógica** de uma automação como template reutilizável
- Um template guarda: estrutura do grafo, configuração dos nodes, ids de capacidade exigidos,
  tags e campos personalizados que ele espera, e metadados
- Um template **nunca** guarda: tokens, segredos, ids de conta conectada, dados de contato,
  identificadores de workspace ou qualquer PII de cliente. Imponha isso com um sanitizador na
  exportação **e** um validador na importação — não confie que o caminho de exportação está correto.
- Na importação: mostrar quais capacidades o template exige e se a conta conectada do workspace
  de destino as satisfaz; criar tags/campos faltantes com confirmação do usuário; recusar a
  importação se uma capacidade exigida estiver indisponível, com explicação clara
- Versionado, com versão de schema explícita para que templates antigos continuem importáveis

---

## 18. SEGURANÇA

### 18.1 Segredos e tokens
- Tokens de acesso de canal, refresh tokens, credenciais de integração e segredos de webhook de
  saída são cifrados em repouso com **AES-256-GCM**, usando envelope encryption com a chave de
  dados gerenciada por um KMS / secrets manager.
- Chaves de cifra são versionadas; suporte rotação de chave com recifragem sem downtime.
- Nenhum segredo no controle de versão, em logs, em mensagens de erro, em traces, em eventos de
  analytics, ou em qualquer resposta de API. Implemente uma **camada de redação no logger** —
  não confie na memória dos desenvolvedores.
- Adicione varredura de segredos no CI e um hook de pre-commit.

### 18.2 Autenticação e sessões
- Argon2id para hash de senha, parâmetros sensatos, política de senha imposta
- Cookies de sessão: `httpOnly`, `Secure`, `SameSite=Lax`, access curto + refresh rotativo
- Detecção de reuso de refresh token → revogar toda a família da sessão
- 2FA TOTP opcional; códigos de recuperação; exigível por workspace
- Rate limit e atraso progressivo nos endpoints de autenticação; bloqueio após falhas repetidas
- Proteção contra enumeração de e-mail em login, cadastro e recuperação de senha

### 18.3 Autorização (RBAC)
Papéis, como modelo de partida:

| Papel | Capacidades |
|---|---|
| **Owner** | Tudo, incluindo billing, exclusão do workspace, transferência de propriedade |
| **Admin** | Tudo, exceto transferir propriedade e excluir o workspace |
| **Editor** | Criar/editar/publicar automações, gerenciar contatos, tags e campos; sem billing, sem gestão de membros |
| **Agent** | Apenas Inbox: conversas, tags, valores de campo personalizado dos contatos que atende |
| **Viewer** | Somente leitura em analytics e automações |

- Imponha autorização **no servidor, em toda requisição**. Esconder um botão é UX, não segurança.
- Centralize as checagens de política numa única camada de guard/policy — nunca espalhe
  `if (role === …)`.
- Toda ação relevante para permissão grava entrada em `AuditLog`.
- Adicione uma suíte de testes que afirma, para cada papel, tanto as ações permitidas quanto as
  **negadas**. A metade negada é a que costuma ser pulada, e é a que importa.

### 18.4 Isolamento de tenant
- RLS do Postgres em toda tabela de tenant, mais escopo na aplicação. Cinto e suspensório.
- Testes automatizados provando que acesso entre workspaces falha, para todo endpoint escopado.
- O id do workspace é resolvido no servidor a partir da sessão/API key — **nunca** de body ou
  query parameter enviado pelo cliente.

### 18.5 Segurança de webhook
- Verifique assinaturas no body cru antes de qualquer parse
- Rejeite entregas sem assinatura ou inválidas com 401 e registre a tentativa
- Comparação em tempo constante nas checagens de assinatura
- Idempotência e proteção contra replay via `providerEventId` e limites de timestamp
- Segredos de verificação separados por ambiente

### 18.6 Segurança de requisições de saída (o node HTTP Request)
Este node permite que tenants façam nossos servidores emitirem requisições HTTP arbitrárias.
Trate como hostil:
- Negue faixas de IP privadas, loopback, link-local e de metadados (`169.254.169.254` acima de tudo)
- Resolva o DNS e valide o **IP resolvido**, depois fixe-o para a requisição — senão DNS
  rebinding passa direto pela checagem
- Não siga redirects para alvos negados; revalide a cada salto
- Imponha timeouts, teto de tamanho de resposta, e rate limit por workspace
- Allow-list de schemes (só https) e portas
- Nunca encaminhe nossas próprias credenciais ou headers

### 18.7 Segurança de aplicação
- Valide toda entrada com schema (Zod) na fronteira; rejeite campos desconhecidos
- Somente queries parametrizadas; nada de SQL montado por concatenação
- Codificação de saída e CSP estrita; sanitize qualquer conteúdo rico renderizado a partir de
  entrada de contato
- Proteção CSRF em rotas que mudam estado autenticadas por cookie
- Rate limiting por IP, por usuário, por workspace, por classe de endpoint
- Headers de segurança: HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy
- Varredura de dependências no CI; fixe versões e revise atualizações
- Validação de upload: tipo, tamanho, sniffing de conteúdo; sirva mídia de usuário de uma origem separada

### 18.8 Segurança operacional
- Menor privilégio para toda service account e todo papel de banco
- Credenciais separadas por ambiente; segredos de produção nunca saem de produção
- Backups cifrados e testados — um backup que nunca foi restaurado é uma hipótese
- Resposta a incidentes documentada e caminho definido de notificação de vazamento
- Simulados de restauração regulares

---

## 19. PRIVACIDADE E LGPD

⚠️ **Esta seção é orientação de engenharia, não aconselhamento jurídico.** A DM FLOW processa
dados pessoais de usuários finais que nunca se cadastraram na DM FLOW — uma posição genuinamente
sensível. Todo item abaixo precisa ser revisado por advogado qualificado em privacidade antes do
lançamento em produção. Marque questões jurídicas não resolvidas em `docs/known-limitations.md`
sob "Requer revisão jurídica" em vez de adivinhar.

### 19.1 Construa estas capacidades
- **Política de retenção**, configurável por workspace, com padrões sensatos, imposta por job
  agendado que de fato apaga — inclusive dos backups, conforme cronograma documentado
- **Apagamento**: excluir um contato e todo dado derivado (mensagens, passos de execução, valores
  de campo, logs que os referenciam) mediante solicitação, com registro `DataSubjectRequest`
  provando que aconteceu
- **Exportação**: exportação legível por máquina de tudo que guardamos sobre um contato
- **Anonimização** como alternativa à exclusão, para que analytics agregado sobreviva ao
  apagamento (substituir identificadores, manter contagens)
- **Estado de consentimento** em `Contact` onde aplicável, com timestamp e origem
- **Minimização de dados**: guarde só o que uma funcionalidade precisa. Não acumule payloads
  "por precaução". Payloads crus de webhook especialmente — defina janela de retenção em
  `WebhookEvent`.
- **Log de acesso**: quem visualizou a conversa de qual contato, e quando
- **Registro de suboperadores** na documentação
- **Residência regional de dados**: saiba onde o dado fisicamente vive e declare isso

### 19.2 Questões para encaminhar ao jurídico, não para você resolver
- Controlador vs operador: a DM FLOW é operadora dos seus clientes, controladora, ou ambas?
- Qual a base legal para tratar dados de usuário final recebidos via plataforma?
- O que a política de privacidade do próprio dono do workspace precisa dizer, e nós exigimos que ele tenha uma?
- Como as políticas de dados da própria plataforma restringem nossa retenção e compartilhamento?
- Quais as implicações de transferência internacional das nossas escolhas de hospedagem?
- Quais termos contratuais (DPA) precisamos oferecer aos clientes?

Construa os mecanismos; deixe o jurídico definir os parâmetros.

---

## 20. META APP REVIEW E AMBIENTES

### 20.1 Pré-requisitos prováveis (todos pendentes de confirmação na FASE 0)
- Um Meta App do tipo adequado
- Um Business Portfolio / Business Manager
- Business Verification
- Submissão de App Review para cada permissão exigida, com demo funcional, screencast e caso de
  uso escrito com clareza
- Advanced Access para atender contas que o app não possui ⟨VALIDAR: P6, P7⟩

Planeje isto como uma **dependência externa de várias semanas e resultado incerto**, não como um
checkbox. Sequencie o roadmap de forma que Camada 1 e triggers internos sejam demonstráveis
enquanto a revisão está pendente — senão o projeto inteiro trava na fila de outra pessoa.

Mantenha `docs/app-review.md` com: permissões solicitadas, status atual por permissão, datas de
submissão, feedback do revisor, e o que cada permissão destrava no produto.

### 20.2 Ambientes

| Ambiente | Propósito | Regras |
|---|---|---|
| **development** | Trabalho local | Meta app próprio em dev mode, contas de teste próprias, túnel de webhook próprio, dados semeados. **Nunca credenciais de produção.** |
| **staging** | Verificação pré-produção | Meta app separado, banco separado, config parecida com produção, apenas dados sintéticos |
| **production** | Clientes reais | Credenciais reais, acesso restrito, observabilidade completa, controle de mudanças |

- Um único schema de `.env`, validado no boot — a aplicação precisa **se recusar a subir** com
  variável faltando ou malformada, em vez de falhar misteriosamente depois.
- Migrations rodam como passo de deploy separado e revisável.
- Feature flags para rollout progressivo de funcionalidades de canal conforme passam pela revisão.

---

## 21. TESTES

| Nível | Escopo | Notas |
|---|---|---|
| **Unitário** | Avaliador de predicado, decisões de capacidade, normalizadores, cálculo de janela, interpolação | Rápido, sem I/O |
| **Integração** | API + Postgres real + Redis real via Testcontainers | Inclui testes de RLS/isolamento de tenant |
| **Contrato** | Adapters de provider contra fixtures **gravadas** de respostas reais | Fixtures capturadas de chamadas reais em dev, commitadas e datadas |
| **Webhook** | Verificação de assinatura, dedupe, payload malformado, payload replicado, entrega fora de ordem, conta desconhecida | Cada um desses vai acontecer em produção |
| **Fila** | Retry, backoff, roteamento para DLQ, reenfileiramento, mensagens envenenadas | — |
| **Concorrência** | Dois workers reivindicando uma execução; publicação e execução simultâneas; webhook duplicado em paralelo | Use locking real, não mocks |
| **Idempotência** | Mesmo evento processado duas vezes → exatamente um efeito colateral | Suíte dedicada. Inegociável. |
| **Rate limit** | Comportamento de backoff, ajuste do limiter por headers, recuperação de throttle | — |
| **E2E** | Playwright: cadastro → workspace → conectar (provider mockado) → montar fluxo → publicar → disparar → verificar execução e analytics | O loop completo, automatizado |
| **Segurança** | Matriz de authz por papel, acesso entre tenants, guarda SSRF, tentativas de injeção | — |

**Regras de mock:**
- Mocks existem **somente** em ambiente de teste. Nunca um provider mockado em staging ou produção.
- Um mock precisa ser construído a partir de uma **resposta real gravada**, e a gravação é datada
  e commitada. Um mock escrito à mão codifica a sua suposição sobre a API, que é exatamente o que
  a DP-1 proíbe — uma suíte verde contra um mock inventado é pior que nenhum teste, porque
  fabrica confiança falsa.
- Quando uma capacidade é `NOT_CONFIRMED`, não escreva mock para ela. Não escreva nada.

---

## 22. OBSERVABILIDADE

- **Logs JSON estruturados** com correlation ids conduzidos desde a recepção do webhook,
  passando por fila, execução e chamada de provider. Toda linha de log carrega `workspaceId`,
  `executionId`, `webhookEventId` quando aplicável. Segredos redigidos pelo próprio logger.
- **Métricas**: webhook recebido/processado/falho/atraso, profundidade e idade de fila por fila,
  execução iniciada/concluída/falha e duração, latência/erros/uso de rate limit por conta nas
  chamadas de provider, folga de expiração de token, conexões WebSocket, saturação do pool do banco.
- **Tracing**: spans OpenTelemetry por todo o caminho — o trace de um único comentário de entrada
  deve mostrar ingestão, normalização, casamento de trigger, cada node e cada chamada de API.
- **Rastreamento de erros**: Sentry com tag de release e source maps.
- **Alertas** com limiares e donos definidos: atraso de ingestão, crescimento de profundidade de
  fila, DLQ não vazia, pico de taxa de erro do provider, tokens expirando em N dias, assinatura
  de webhook não saudável, taxa de falha de execução acima da linha de base, p99 de resposta de
  webhook acima de 500ms.
- **Endpoints de saúde**: liveness, readiness, e um health check profundo cobrindo banco, Redis,
  fila e alcançabilidade do provider.
- **Página de status por workspace** para operadores verem a própria saúde de integração sem
  acionar o suporte.

---

## 23. MODELO DE STATUS DE INTEGRAÇÃO

A UI precisa conseguir expressar cada um destes estados de forma distinta, com mensagem
específica e remediação específica:

| Estado | Significado | O que o usuário vê |
|---|---|---|
| `CONNECTED` | Tudo funcionando | Saudável, com horário da última checagem |
| `AUTHORIZATION_INCOMPLETE` | OAuth iniciado mas não concluído | Retomar conexão |
| `MISSING_PERMISSION` | Um escopo exigido não foi concedido | Qual escopo, o que ele destrava, reconectar para conceder |
| `PENDING_APP_REVIEW` | Capacidade bloqueada aguardando revisão | O que fica indisponível enquanto isso |
| `TOKEN_EXPIRING` | Expiração se aproximando | Dias restantes, ação de renovar/reconectar |
| `TOKEN_INVALID` | Expirado ou revogado | Reconexão necessária; automações estão pausadas |
| `WEBHOOK_UNHEALTHY` | Assinatura ausente ou sem entregas | O que é afetado, ação de retentar |
| `RATE_LIMITED` | Sob throttling no momento | Recuperação esperada, uso atual |
| `PROVIDER_ERROR` | Falha do lado de cima | Natureza do erro, se estamos retentando |
| `DISCONNECTED` | Usuário desconectou | O que parou, como restaurar |
| `ACCOUNT_RESTRICTED` | Plataforma restringiu a conta | Explicação honesta; não podemos resolver por ele |

Rode health check agendado por conta conectada. Detecte degradação **antes** de uma automação
falhar, e notifique o workspace. Automações que não podem rodar precisam ficar visivelmente
pausadas com o motivo anexado — nunca falhando em silêncio ao fundo.

---

## 24. TRATAMENTO DE ERROS

### 24.1 Nunca entregue "Algo deu errado"

Todo erro é um objeto estruturado:

```ts
interface DmFlowError {
  code: string              // 'IG_WINDOW_CLOSED', 'IG_TOKEN_INVALID', 'FLOW_NODE_INVALID'
  category: 'VALIDATION' | 'AUTH' | 'PERMISSION' | 'CAPABILITY' | 'RATE_LIMIT'
          | 'PROVIDER' | 'INTERNAL' | 'POLICY'
  provider?: Channel
  operation?: string        // nome interno da operação
  cause?: string            // código/mensagem de cima, sanitizado
  context: Record<string, unknown>   // só ids, nunca PII, nunca segredos
  attempt: number
  retryable: boolean
  nextRetryAt?: string
  userMessage: LocalizedMessage      // en + pt-BR, linguagem simples
  remediation?: { action: string; url?: string }
  correlationId: string
  occurredAt: string
}
```

### 24.2 Regras
- Todo erro carrega um código interno. Mantenha o catálogo completo em `docs/error-codes.md`.
- A mensagem para o usuário explica **o que aconteceu, por quê, e o que fazer em seguida** — no
  idioma dele, sem jargão, sem detalhes internos do provider.
- Nunca exponha tokens, segredos, payloads crus do provider, stack traces ou hostnames internos
  ao usuário.
- O `correlationId` é mostrado ao usuário para o suporte rastrear. Esse detalhe sozinho reduz o
  tempo de suporte de forma desproporcional.
- Execuções falhas mostram o node que falhou, o erro tipado, a contagem de tentativas e o
  cronograma de retry — visível no inspetor de execução, sobre o canvas.
- Erros são classificados como retentáveis ou terminais no momento da criação, não adivinhados depois.
- Falhas causadas por política (`category: 'POLICY'`) recebem tratamento especial: explique a
  regra da plataforma que bloqueou a ação, para que o operador aprenda a restrição em vez de
  concluir que o produto está quebrado.

---

## 25. INTERNACIONALIZAÇÃO

A DM FLOW nasce bilíngue desde o MVP: **inglês (`en`)** e **português brasileiro (`pt-BR`)**.

- Todas as strings de usuário em arquivos de locale; **zero texto hardcoded** em componentes
- Locale resolvido por usuário, com padrão do workspace; alternável nas configurações, persistido
- Datas, horas, números e moeda formatados por locale; fuso por workspace
- **Mensagens de erro, motivos de negação de capacidade e mensagens de validação também
  localizados** — são as strings que o usuário vê quando está confuso, e as mais esquecidas
- Pluralização tratada corretamente (formato de mensagem ICU)
- Arquivos de locale organizados por domínio, não um arquivo gigante
- Um check de CI que falha quando uma chave existe num locale e não no outro

---

## 26. UI E UX

### 26.1 Princípios
Limpa e silenciosa · rápida · hierarquia visual forte · pouco cromo · conteúdo em primeiro lugar ·
amigável ao teclado · responsiva · genuinamente acessível

Referências conceituais apenas para *nível de qualidade e padrões de interação* — não copie nada:
Linear (velocidade, teclado, densidade), Stripe (clareza na complexidade), n8n/Make (ergonomia de
canvas), Intercom (padrões de inbox).

### 26.2 Estados obrigatórios — toda lista, todo painel, toda superfície assíncrona
- **Empty state** com explicação e ação primária, não um dar de ombros
- **Loading**: skeletons que casam com o layout final; nunca spinner onde cabe skeleton
- **Erro**: o que falhou, por quê, e um retry
- **Parcial/degradado**: ex. conta conectada não saudável — mostre o dado que você tem com um banner
- **Feedback de sucesso**: imediato, específico, não bloqueante
- **Confirmação destrutiva**: nomeie o objeto exato sendo destruído e as consequências; exija
  digitar o nome em operações irreversíveis (excluir workspace, excluir automação com execuções
  em andamento)

### 26.3 Acessibilidade (WCAG 2.1 AA como piso)
Operação completa por teclado, incluindo o canvas · indicadores de foco visíveis · semântica e
ARIA corretos · contraste mínimo 4.5:1 · rotulagem para leitor de tela em todo controle ·
`prefers-reduced-motion` respeitado · nunca usar só cor para comunicar estado

O canvas de fluxo é a parte difícil. Forneça uma lista de nodes navegável por teclado como
representação alternativa, para o builder não ser uma funcionalidade exclusiva de mouse.

### 26.4 Metas de performance
Carregamento inicial abaixo de 2s em conexão mediana · canvas a 60fps com mais de 100 nodes ·
listas longas virtualizadas · atualizações otimistas em mutações · atualização em tempo real do
inbox sem refetch completo

### 26.5 Design system
Tokens próprios (cor, espaçamento, raio, tipografia, elevação, movimento), temas claro e escuro,
biblioteca de componentes documentada, e iconografia consistente de um conjunto com licença
aberta. Não use ícones, ilustrações ou assets de marca proprietários de outro produto.

---

## 27. PLANO DE IMPLEMENTAÇÃO

Construa em fatias verticais. Cada fase termina com algo demonstrável e testado. Não comece uma
fase antes dos critérios de saída da anterior serem atendidos.

### FASE 0 — Validação de capacidades (bloqueia todo trabalho de Camada 2)
Faça a pesquisa da §4. Produza `docs/meta-capabilities.md` com uma linha real por capacidade.
Resolva a questão `/docs/` vs `/documentation/`. Produza um go/no-go escrito por funcionalidade
de MVP.
**Saída:** toda funcionalidade de Camada 2 do MVP está ou validada com citação, ou removida do
MVP com motivo escrito. Sem exceções, sem "a gente confere depois".

### FASE 1 — Fundação
Monorepo, TypeScript estrito, lint/format, CI, Docker Compose (Postgres, Redis), validação do
schema de env, apps base Next.js e NestJS, endpoints de saúde, logging estruturado, middleware de
tratamento de erros, scaffolding de i18n.
**Saída:** `docker compose up` entrega um sistema rodando, com health check e logando.

### FASE 2 — Identidade e tenancy
User, Workspace, WorkspaceMember, Session, Invitation. Cadastro, login, recuperação de senha,
2FA. Camada de guard de RBAC. Políticas de RLS. AuditLog. Seletor de workspace.
**Saída:** dois workspaces existem; a suíte de matriz de authz passa; testes entre tenants
falham fechado.

### FASE 3 — Contatos e segmentação (só Camada 1)
Contact, ContactIdentity, Tag, ContactTag, CustomField, CustomFieldValue, Segment.
O avaliador de predicado — **uma única implementação** servindo conditions, segments e filtros.
Lista de contatos, detalhe, importação/exportação.
**Saída:** contatos gerenciáveis e segmentáveis sem nenhum canal conectado.

### FASE 4 — Capability Engine
Registro de capacidades alimentado pela FASE 0. Função de decisão com negações estruturadas.
Modelagem de estado de janela. Check de CI de obsolescência do registro.
**Saída:** o engine nega corretamente tudo que não está validado, e os motivos de negação são
localizados e específicos. Entregue isto antes dos providers — é a grade de proteção em que todo
o resto se apoia.

### FASE 5 — Motor de automação apenas com triggers e ações de Camada 1
Automation, AutomationVersion, Trigger, Execution, ExecutionStep, IdempotencyRecord.
Loop do motor, delays duráveis, scheduler, cancelamento, política de concorrência, orçamento de passos.
Triggers: inscrição manual, tag adicionada, chamada de API de entrada. Ações: tags, campos
personalizados, condições, delays, requisição HTTP, end.
**Saída:** uma automação de múltiplos passos com delay de três dias roda corretamente atravessando
um restart, com histórico completo por passo e testes de idempotência passando. **O motor está
provado com zero dependência externa.**

### FASE 6 — Flow Builder
Canvas, paleta de nodes gated pelo Capability Engine, painéis de configuração, validação,
autosave, publicação, versionamento, undo/redo, sobreposição do inspetor de execução.
**Saída:** um usuário não técnico consegue montar, validar, publicar e depurar uma automação de
Camada 1.

### FASE 7 — Primeiro provider de canal (Instagram)
Esqueleto do provider, OAuth, armazenamento e refresh de token, ciclo de vida do ConnectedAccount,
health checks, superfície de status de integração. **Implemente somente capacidades validadas na
FASE 0.**
**Saída:** uma conta conecta, aparece saudável, renova o token, e reporta status corretamente em
todos os estados da §23.

### FASE 8 — Ingestão de eventos
Endpoints de webhook, verificação de assinatura, persistência de WebhookEvent, dedupe,
normalização, fila, DLQ, ferramenta de replay (com efeitos colaterais suprimidos por padrão),
métricas e alertas de ingestão.
**Saída:** eventos reais chegam, são deduplicados, normalizados, e produzem Contacts,
Conversations e Messages. O replay funciona e não reenvia.

### FASE 9 — Triggers e ações de canal
Ligar triggers validados ao casamento; implementar ações de envio validadas atrás do Capability
Engine; rate limiter alimentado por headers de resposta; mapeamento de erro para o catálogo interno.
**Saída:** o loop principal funciona de ponta a ponta numa conta de teste real — evento entra,
automação roda, mensagem sai, execução registrada, analytics atualizado.

### FASE 10 — Inbox
Lista de conversas, visão de thread, tempo real, atribuição, status, notas, handoff, envio manual
pelo Capability Engine, painel do contato com estado de janela ao vivo.

### FASE 11 — Analytics
Jobs de rollup, dashboards, sobreposição por node no canvas, analytics de saúde de integração.

### FASE 12 — Templates, webhooks de saída, integrações
Exportação/importação de template com sanitização, entrega de webhook de saída com retries, API
pública com API keys e escopos.

### FASE 13 — Endurecimento e lançamento
Revisão de segurança, teste de carga, simulado de backup/restore, runbooks, jobs de retenção e
apagamento verificados, alertas afinados, documentação completa, App Review submetido e acompanhado.

---

## 28. DOCUMENTAÇÃO OBRIGATÓRIA

Mantenha estes no repositório, atualizados como parte do trabalho — não escritos no final:

| Arquivo | Conteúdo |
|---|---|
| `docs/meta-capabilities.md` | **O arquivo mais importante.** Uma linha por capacidade, conforme §4.4. Fonte da verdade para o Capability Engine. |
| `docs/architecture.md` | Design do sistema, topologia de processos, decisões e justificativas, premissas |
| `docs/data-model.md` | Entidades, relacionamentos, índices, estratégia de tenancy e RLS, retenção |
| `docs/automation-engine.md` | Semântica de execução, idempotência, delays, concorrência, tratamento de falha |
| `docs/security.md` | Modelo de ameaças, controles, manuseio de segredos, resposta a incidentes |
| `docs/api-integrations.md` | Arquitetura de providers, especificidades por canal, rate limiting, mapeamento de erros |
| `docs/known-limitations.md` | O que o produto não consegue fazer e por quê — separado em "limitação da plataforma", "pendente de validação", "deliberadamente não construído", "requer revisão jurídica" |
| `docs/error-codes.md` | Catálogo interno completo de erros com mensagens de usuário nos dois idiomas |
| `docs/analytics.md` | Definição precisa de cada métrica |
| `docs/app-review.md` | Permissões, status de submissão, feedback, o que cada uma destrava |
| `docs/runbooks/` | Procedimentos operacionais: expiração de token, queda de webhook, drenar DLQ, resposta a incidente |
| `docs/adr/` | Architecture Decision Records para escolhas significativas |

---

## 29. CLÁUSULA ANTI-ALUCINAÇÃO (repetida, porque é o ponto central)

> **Se você não conseguir confirmar uma capacidade na documentação oficial atual, não implemente
> assumindo que ela existe. Marque como `PENDING_VALIDATION`, construa o resto do sistema sem
> ela, e continue.**

Você não pode, sob nenhuma circunstância:
- inventar endpoint, caminho ou método
- inventar payload de requisição ou resposta
- inventar string de permissão ou escopo
- inventar campo de webhook ou nome de evento
- inventar regra de política ou limite
- assumir comportamento porque ele existe em outro produto da Meta
- assumir comportamento porque um concorrente aparenta ter a funcionalidade
- assumir comportamento porque este documento mencionou como hipótese

**Tudo neste documento marcado como ⟨VALIDAR⟩, "hipótese", "candidato" ou `PENDING_VALIDATION`
não está verificado.** Incluindo — especialmente — as partes que soam confiantes.

Quando você bater num ponto não verificável, a saída correta é uma questão aberta claramente
declarada em `docs/known-limitations.md` e um pedido de decisão. Não um chute. Não um padrão
plausível. Um desconhecido declarado é um resultado profissional; uma fabricação confiante é um
defeito que chega no cliente.

---

## 30. DEFINIÇÃO DE PRONTO

Uma funcionalidade está pronta quando tudo abaixo é verdade:

1. Funciona de ponta a ponta num ambiente real, não só em testes
2. Tem testes unitários e de integração, incluindo caminhos de falha
3. Funcionalidades de Camada 2 citam uma linha de capacidade validada com data e versão de API
4. Erros são tipados, localizados e acionáveis
5. É observável: existem logs, métricas e traces para ela
6. Autorização é imposta no servidor e testada por papel
7. Isolamento de tenant é testado
8. Todos os estados de UI existem: vazio, carregando, erro, parcial, sucesso
9. Strings estão localizadas em `en` e `pt-BR`
10. A documentação é atualizada na mesma mudança
11. Nenhum segredo é exposto em nenhum ponto do caminho
12. Qualquer coisa não verificada está registrada como limitação, não silenciosamente assumida

---

## 31. COMO COMEÇAR

1. Leia este documento por completo.
2. Execute a FASE 0. Produza `docs/meta-capabilities.md`. **Não pule isso para "começar logo" —
   cada hora gasta aqui economiza dias construindo contra APIs imaginadas.**
3. Volte reportando: o que foi confirmado, o que não foi, quais funcionalidades do MVP
   sobrevivem à validação, e qualquer pergunta que este documento não respondeu.
4. Só então comece a FASE 1.

Se a FASE 0 revelar que uma premissa central deste documento está errada — por exemplo, que o
loop comentário-para-private-reply não está disponível como descrito — **diga isso com todas as
letras e proponha um escopo de produto revisado.** Essa é a resposta correta. Construir a coisa
errada com precisão continua sendo construir a coisa errada.
