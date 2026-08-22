# Limitações conhecidas — DM FLOW

> Última atualização: 2026-08-22

Este arquivo existe para que ninguém descubra um limite em produção.

## 1. Pendente de validação (FASE 0)

**Nenhuma capacidade do Instagram foi validada contra a documentação oficial da
Meta.** O ambiente onde esta plataforma foi construída teve
`developers.facebook.com` bloqueado pela política de egress.

Consequência prática, imposta em código e coberta por teste:

- Toda entrada do registro de capacidades para conta **real** está `NOT_CONFIRMED`.
- Nenhum escopo, endpoint, campo de webhook ou limite numérico foi inventado — os
  campos estão vazios, não preenchidos com algo plausível.
- `LiveInstagramProvider` recusa toda chamada com `CapabilityNotValidatedError`,
  retorna `false` na verificação de assinatura e normaliza nada.
- O Capability Engine nega qualquer capacidade não validada, sem flag de override.

Para destravar: executar a FASE 0 do `MASTER_PROMPT.pt-BR.md` (§4), preencher
`docs/meta-capabilities.md` e trocar o status das entradas correspondentes.

## 2. Limitação da plataforma (provável, a confirmar)

| Limitação | Efeito no produto | Pergunta da FASE 0 |
|---|---|---|
| Conversa precisa ser iniciada pelo usuário | Não existe broadcast frio. Contatos importados não podem ser mensageados até escreverem. | P21 |
| Janela de mensagens limitada | Envio fora da janela é bloqueado com explicação. | P18, P19 |
| Private reply possivelmente única por comentário | Tratada como tiro único: a tentativa é reservada **antes** da chamada. | P23, P24 |
| Histórico de conversa limitado via API | O Inbox é livro-razão próprio, começando na conexão da conta. | P30, P31 |
| `live_comments` pode ter sido descontinuado | Não implementado, não prometido. | P13 |
| Persistent menu pode não existir no Instagram | Não implementado. | P15 |

## 3. Deliberadamente não construído

- Scraping, automação de navegador, sessão emprestada, endpoint privado, biblioteca
  não oficial que emula o cliente. Nada disso existe no código e nada disso será
  aceito como solução para uma capacidade ausente.
- Endpoint público de envio direto de mensagem. A API pública cria contato e inicia
  automação; enviar passa obrigatoriamente pelo Capability Engine dentro de um fluxo,
  porque um endpoint de envio cru seria um contorno de toda regra de janela.

## 4. Limitações da implementação atual

| Item | Situação | Observação |
|---|---|---|
| Row Level Security no Postgres | **Não implementado** | O isolamento é feito na aplicação em três camadas: escopo obrigatório por `workspaceId`, `assertTenant` em toda leitura por id vindo do cliente, e um teste que varre o código e **reprova** qualquer consulta em massa sem filtro de workspace (`src/__tests__/tenant-scoping.test.ts`). Toda exceção legítima precisa de justificativa escrita, então um vazamento e uma varredura intencional não se parecem. RLS no banco exige um role sem `BYPASSRLS` e `SET LOCAL` por transação — segue pendente como defesa em profundidade. |
| Messenger e WhatsApp | Não implementados | Cada canal precisa da sua própria passada de validação e do seu próprio provider. `ProviderRegistry` recusa explicitamente. |
| Rollups de analytics | Consultas ao vivo | Corretas e indexadas, mas em volume alto devem virar tabelas de rollup agendadas. |
| Envio de e-mail | Não implementado | Convites e recuperação de senha devolvem o token na resposta em `development`; produção precisa de um provedor de e-mail. |
| Upload de mídia | Não implementado | Nodes de mídia aceitam URL; falta storage S3 com URLs pré-assinadas. |
| Undo/redo no builder | Não implementado | O canvas tem autosave e histórico de versões com restauração; falta a pilha de comandos. |

## 5. Requer revisão jurídica

Não são opiniões jurídicas — são pontos que precisam de advogado antes de produção:

- DM FLOW é operadora, controladora, ou ambas, em relação aos dados de usuários finais?
- Qual a base legal para tratar dados recebidos via plataforma?
- Que termos (DPA) precisam ser oferecidos aos clientes?
- Implicações de transferência internacional conforme a hospedagem escolhida.
