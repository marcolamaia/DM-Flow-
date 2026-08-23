# Arquitetura da DM FLOW

## O formato

Monólito modular. Um backend, um frontend, um worker, um banco. Nada aqui pede
microserviço, e separar serviços sem necessidade concreta troca um problema
fácil (uma função chamando outra) por um difícil (duas máquinas discordando).

```
NAVEGADOR
   │  cookie httpOnly, nunca token em JavaScript
   ▼
apps/web — Next.js 15 · React 19 · Tailwind · React Flow
   │  fetch com credenciais
   ▼
apps/api — NestJS 10
   │
   ├── RateLimitGuard    global; conta sempre pelo endereço de origem
   ├── AuthGuard         identidade → tenant → autorização, nesta ordem
   ├── AdminGuard        concessão relida do banco a cada requisição
   │
   ├── Domínio
   │     auth · workspaces · contacts · automations · engine · channels
   │     billing · inbox · analytics · admin · webhooks
   │
   ├── Capability Engine   nega por padrão
   └── Prisma 6            com guard de vazamento entre clientes
        │
        ├──► PostgreSQL 16   fonte da verdade
        └──► Redis 7         transporte e locks, nunca verdade
                │
                ▼
        apps/api/worker      mesmo código, processo separado
        scheduler            dentro do worker
```

Quatro processos: `web`, `api`, `worker`, `scheduler`. O scheduler mora dentro
do worker porque separá-lo custaria um processo a mais sem resolver nada.

---

## As decisões que sustentam o resto

### Postgres é a verdade. Redis é transporte.

Toda execução tem linha no Postgres, inclusive o instante em que deve acordar
(`resumeAt`). O Redis carrega o trabalho e guarda locks. Perder o Redis atrasa
execuções; não as perde. O contrário — estado de execução só na fila — perde
conversa de cliente quando o Redis reinicia.

### Concorrência protegida duas vezes

Lock no Redis para o caso comum, e `lockVersion` otimista no Postgres para o
caso em que o lock falha. Duas defesas porque uma execução rodando duas vezes
manda duas mensagens para a mesma pessoa, e isso o cliente vê.

### Versão publicada é imutável

Publicar congela o grafo. Editar depois cria rascunho novo. Uma execução que
começou continua no grafo em que começou — senão alguém edita a automação no
meio da conversa e o contato recebe metade de um fluxo e metade de outro.

### Nada da Meta é presumido

O Capability Engine nega por padrão. Cada capacidade é declarada em separado —
`IG_RECEIVE_DM` e `CAP_IG_RECEIVE_QUICK_REPLY_PAYLOAD` são coisas diferentes,
porque receber uma mensagem não implica saber qual botão a causou. O que não
foi confirmado na documentação oficial fica marcado como não confirmado e não
é implementado.

### Autorização num lugar só

Controller nunca inspeciona papel. Quem decide é o guard. Isso mantém a
resposta a "quem pode fazer isto?" num arquivo legível em vez de espalhada em
condicionais que divergem com o tempo.

### Papéis de plataforma ≠ papéis de workspace

Ser dono do próprio workspace não diz nada sobre poder ler a cobrança de outro
cliente. São duas tabelas, dois conjuntos de permissão, dois guards.

### Definição única de cada métrica

Existe **um** lugar que transforma preço de plano em receita recorrente. Um
teste falha o build se aparecer um segundo. MRR do painel e MRR do relatório
são o mesmo número porque são a mesma conta.

### Falha barulhenta, nunca degradação silenciosa

- Produção se recusa a subir com `MAIL_TRANSPORT=log`
- Motivo obrigatório é checado **antes** da ação, não depois
- Reembolso é recusado quando não há cobrança configurada
- Reconciliação diz quando não conseguiu comparar, em vez de reportar zero divergências
- Intervalo de cobrança desconhecido levanta erro em vez de virar mensal

---

## Isolamento entre clientes

Três camadas, porque a primeira sozinha depende de alguém não esquecer:

1. **AuthGuard** resolve o workspace a partir do cabeçalho e confere que o
   usuário pertence a ele.
2. **Guard no Prisma** intercepta consulta em modelo com dono e verifica o
   filtro em tempo de execução.
3. **Teste que varre o código** procurando consulta sem filtro de workspace e
   **quebra o build** se achar uma que não esteja justificada por escrito. Já
   pegou seis casos durante o desenvolvimento do painel.

Falta a quarta: Row Level Security no Postgres (fila #24).

---

## Camadas de dados

| Onde | Guarda o quê | Sobrevive a reinício |
|---|---|---|
| PostgreSQL | Tudo que é verdade | Sim |
| Redis | Filas, locks, contadores de limite | Não, e não precisa |
| Cookie do navegador | Só o token de sessão | Sim |
| `localStorage` | Idioma, tema, workspace aberto | Sim, e nada de produto |

O event store (`DomainEvent`) é separado das tabelas de estado atual de
propósito: "quantos cancelaram em março e quanto valiam" é uma pergunta que o
estado atual não responde, porque a linha que responderia já foi alterada.

---

## Para onde vai

| Mudança | Situação |
|---|---|
| PostgreSQL → CockroachDB | Fila #45. Compatível na linha, mas SERIALIZABLE muda o comportamento de transação em conflito |
| Heroku com `Procfile` | Fila #46 |
| Login com Google | Fila #47 |
| Messenger, Facebook, WhatsApp | Fila #48 |
| Armazenamento de objeto para mídia | Fila #25 |

O formato não muda. Continua monólito modular.
