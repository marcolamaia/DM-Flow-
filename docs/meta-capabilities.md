# Capacidades da Meta — registro de validação

> **Status: NENHUMA LINHA VALIDADA.** Última tentativa: 2026-08-22.

Este é o arquivo mais importante do repositório. O Capability Engine é alimentado
por ele. Nada no código pode afirmar uma capacidade externa que não esteja aqui.

## Por que está vazio

O ambiente de construção teve `developers.facebook.com` bloqueado pela política de
egress. Foi impossível ler a documentação oficial. Em vez de preencher com valores
plausíveis, todas as linhas ficaram `NOT_CONFIRMED` — que é o comportamento correto
e o que os testes exigem.

## Como preencher (FASE 0)

1. Ler as páginas listadas em `MASTER_PROMPT.pt-BR.md` §4.1.
2. Resolver primeiro: a Meta migrou `/docs/` → `/documentation/`; determinar qual
   árvore é canônica hoje e anotar aqui.
3. Responder às 37 perguntas de §4.3, cada uma com citação.
4. Preencher uma linha por capacidade no formato abaixo.
5. Trocar o status em `packages/shared/src/capabilities.ts`.
6. Implementar os métodos correspondentes em `LiveInstagramProvider`.

Nada além disso destrava uma capacidade. Não existe variável de ambiente.

## Árvore de documentação canônica

| Campo | Valor |
|---|---|
| Árvore canônica | `NOT_CONFIRMED` |
| Verificado em | — |

## Formato de cada linha

```markdown
### CAP_IG_SEND_TEXT

| Campo | Valor |
|---|---|
| Capability ID   | CAP_IG_SEND_TEXT |
| Canal           | instagram |
| Status          | NOT_CONFIRMED |
| Doc oficial     | <URL exata lida> |
| Data validação  | AAAA-MM-DD |
| Versão da API   | <versão que a doc descreve> |
| Permissões      | <strings exatas, ou NOT_CONFIRMED> |
| Tipos de conta  | <exato, ou NOT_CONFIRMED> |
| Endpoint        | <método + path exatos, ou NOT_CONFIRMED> |
| Pré-condições   | <janela, interação prévia etc.> |
| Limites         | <documentados; anotar se descobertos em runtime> |
| Notas política  | <o que a política proíbe> |
| Modos de erro   | <códigos documentados> |
| Confiança       | CONFIRMED / PARTIAL / UNCONFIRMED |
```

## Estado atual

| Capability ID | Status | Pergunta que bloqueia |
|---|---|---|
| CAP_IG_CONNECT_ACCOUNT | NOT_CONFIRMED | P1–P7: caminho de auth, escopos, tipos de conta, tokens |
| CAP_IG_RECEIVE_DM | NOT_CONFIRMED | P8–P12: nome do campo, payload, header de assinatura |
| CAP_IG_SEND_TEXT | NOT_CONFIRMED | P14, P18, P19: endpoint, janela, o que sai fora dela |
| CAP_IG_SEND_MEDIA | NOT_CONFIRMED | P15, P16: tipos e tamanhos aceitos |
| CAP_IG_SEND_QUICK_REPLIES | NOT_CONFIRMED | P16, P17: quantidade e onde renderiza |
| CAP_IG_SEND_BUTTONS | NOT_CONFIRMED | P15, P17: existe no Instagram? |
| CAP_IG_RECEIVE_COMMENT | NOT_CONFIRMED | P22, P26: evento, reels, comentários aninhados |
| CAP_IG_REPLY_COMMENT_PUBLIC | NOT_CONFIRMED | P27: permissão específica |
| CAP_IG_SEND_PRIVATE_REPLY | NOT_CONFIRMED | P23, P24, P25: janela, tentativas por comentário |
| CAP_IG_RECEIVE_STORY_REPLY | NOT_CONFIRMED | P28, P29 |
| CAP_IG_RECEIVE_STORY_MENTION | NOT_CONFIRMED | P28 |
| CAP_IG_RECEIVE_LIVE_COMMENT | NOT_CONFIRMED | P13: descontinuado? |
| CAP_IG_SET_ICE_BREAKERS | NOT_CONFIRMED | P15, P20 |
| CAP_IG_READ_CONVERSATIONS | NOT_CONFIRMED | P30, P31: quanto histórico é recuperável |
| CAP_IG_HUMAN_AGENT_WINDOW | NOT_CONFIRMED | P20: existe para Instagram? |

## Números que NÃO podem ser usados

Fontes secundárias divergiram entre si durante a pesquisa. Nenhum destes entra em código:

| Assunto | Valores conflitantes encontrados |
|---|---|
| Rate limit de DM | 200/h · 750/h · 5.000/h · 2 req/s · 100 req/s |
| Private replies por comentário | "uma, para sempre" |
| Janela de private reply | "7 dias" |
| Quick replies | "até 13" |
| Ice breakers | "máx. 4" |
| Histórico | "só as 20 mais recentes" |

O rate limiter deve se auto-ajustar pelos headers de uso da resposta, nunca por
constante fixa.
