# Frente 1 — Modelo Mental do Produto Manychat

> Referência conceitual da **categoria**, não projeto para copiar.
> Nível de evidência geral: `E1/E2` (Help Center indexado + fontes secundárias).
> Nada aqui autoriza qualquer capacidade técnica — isso é decidido pela Frente 2.

---

## 1. O que o produto é

Plataforma de **automação de conversas em canais de mensagem de terceiros** (Instagram DM,
Facebook Messenger, WhatsApp, e-mail/SMS em alguns planos), operada por não-programadores,
via um **editor visual de fluxos**.

Público: criadores de conteúdo, infoprodutores, e-commerce, agências, times de social media,
suporte/vendas de PMEs. O comprador típico quer **transformar engajamento público
(comentário, story, reel) em conversa privada** e depois em lead/venda.

Proposta de valor central, reduzida ao osso:

> *"Alguém interagiu comigo em público → eu respondo em privado, automaticamente,
> em segundos, e capturo essa pessoa como contato segmentável."*

Todo o resto (inbox, analytics, tags, sequências) existe para sustentar esse loop.

---

## 2. O modelo mental (a cadeia canônica)

Esta é a espinha dorsal que a DM FLOW precisa reproduzir:

```
evento externo (webhook do canal)
  → normalização em evento interno
  → resolução de tenant + canal + conta conectada
  → resolução/criação de Contact (identidade por canal)
  → matching de Trigger (qual automação publicada responde a isso?)
  → avaliação de Conditions/Filters de entrada
  → criação de Execution (instância viva do fluxo para aquele contato)
  → loop do motor: executar Node → persistir estado → decidir próximo Node
       ├─ Send Message  → chamada à API do canal (sujeita ao Capability Engine)
       ├─ Condition     → ramificação por tag/campo/estado
       ├─ Delay         → suspende a Execution e reagenda
       ├─ Action        → tag, custom field, webhook externo, notificação
       └─ End
  → registro de ExecutionStep (log por passo) + métricas
  → analytics agregado + inbox atualizado
```

Duas observações que a maioria dos clones erra:

1. **Execution é um objeto durável de longa vida**, não uma função. Um Delay de 3 dias
   significa que a Execution fica dormente por 3 dias e precisa acordar exatamente onde parou.
2. **Trigger matching acontece contra a versão PUBLICADA da automação**, não contra o rascunho.
   Editar um fluxo não pode quebrar execuções em voo.

---

## 3. Decomposição funcional observada

### 3.1 Flow Builder
- Canvas com nodes e conexões; ponto de entrada ("Starting Step") onde se anexam triggers.
- Tipos de node observados: mensagem de texto, mídia (imagem/vídeo), linha de botões
  quick-reply, condição (if/then), delay, ação (tag / custom field), passo de integração
  (e-mail, webhook, Calendly), passo de IA.
- Rascunho vs publicado; validação antes de publicar.

### 3.2 Triggers
Separados por canal. Para Instagram, os observáveis:
- **Comentário em post/reel** — com lista de keywords incluídas, keywords excluídas,
  ou "qualquer comentário"; alvo é um post/reel específico ou todos.
- **Story reply** — usuário responde ao story (texto ou reação em emoji).
- **Story mention** — usuário menciona a conta no story dele.
- **Keyword em DM** — palavra-chave recebida na DM.
- **Default reply** — captura qualquer DM que não deu match em nada.
- **Conversation starters / Ice breakers** — sugestões de abertura no início da conversa.
- Triggers não-canal: entrada manual, ação de outro fluxo, evento de integração.

### 3.3 Conditions
Segmentação inline no fluxo: ramifica por tag, custom field, system field, canal, origem,
horário, estado de assinatura. Mesmo motor de filtro usado por segmentos e broadcasts.

### 3.4 Delay / Smart Delay
- Delay por duração (minutos/horas/dias) ou até uma data.
- **Janela de continuação**: opção de só retomar dentro de um intervalo de horário
  (ex.: 08:00–22:00). Isso é um requisito real e não trivial — o scheduler precisa
  entender fuso horário do workspace e/ou do contato.

### 3.5 Contacts
Pessoa que conversou com a conta em algum canal. Multi-canal (mesma pessoa pode existir em
Messenger, Instagram, WhatsApp). Carrega system fields, custom fields, tags, histórico,
origem, última interação, status de assinatura.

### 3.6 Tags & Custom Fields
- **Tag**: rótulo booleano ("Interessado no Produto X", "Participou do Webinar").
  Adicionada/removida por ação de fluxo; base para segmentação e para opt-out.
- **Custom Field**: slot tipado de dado por contato (texto, número, data, booleano).
  Também existem campos de escopo de conta/fluxo em alguns produtos da categoria.

### 3.7 Segments
Filtro salvo e reutilizável construído sobre tags + custom fields + system fields.
Reutilizado em conditions, regras e broadcasts. **Ponto arquitetural:** um único motor
de predicado precisa servir os três lugares.

### 3.8 Sequences & Broadcasts
- **Sequence**: série de mensagens espaçadas no tempo após entrada.
- **Broadcast**: envio pontual para um segmento.
- ⚠️ Ambos são **envios iniciados pelo negócio**, e é exatamente aí que a política da
  plataforma externa morde mais forte (janela de mensagens). Ver Frente 2.

### 3.9 Inbox / Live Chat
Caixa unificada multi-canal, com pastas por atribuição, atribuição a agentes, tags,
troca automação↔humano, e analytics de time (tempo de resposta, volume, distribuição de carga).
Assentos de Inbox são cobrados/limitados por membro.

### 3.10 Papéis e permissões
Cinco papéis observados: **Owner**, **Admin**, **Editor**, **Inbox Agent**, **Viewer** —
com escopos distintos (billing, clonagem de conta, criação de template, edição de automação,
somente conversas, somente leitura). Isso é um bom ponto de partida de RBAC.

### 3.11 Templates
Estruturas de automação empacotadas e instaláveis (compartilháveis entre contas).
**Regra derivada:** template guarda lógica, nunca credencial nem ID de conta externa.

### 3.12 Dev tools
- **External Request**: passo de HTTP request arbitrário (GET/POST/PUT/DELETE, body JSON)
  para integrar com qualquer sistema quando não há integração nativa. Recurso de plano pago.
- API própria do produto + integração via Zapier/Make.

### 3.13 Analytics
Por automação, por node, por trigger; além de analytics de Inbox (performance de time).

---

## 4. O que a DM FLOW precisa herdar (e o que não)

**Herdar (é o que define a categoria):**
o loop público→privado, o Flow Builder, o modelo Contact/Tag/CustomField/Segment,
Execution durável com delay, Inbox, RBAC por papel, templates de lógica, analytics por node.

**Não herdar:** identidade visual, textos, ícones, layout pixel-perfect, nomenclatura
proprietária desnecessária ("Smart Delay", "Growth Tools", "Starting Step" etc.).
A DM FLOW usa vocabulário genérico da categoria (Trigger, Action, Condition, Delay, Node, Edge).
