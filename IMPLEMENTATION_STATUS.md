# Estado da implementação

Atualizado em 23/08/2026.

## O que "PRONTO" significa aqui

Um módulo só é marcado **PRONTO** quando todas estas coisas são verdade:

- [x] implementação concluída
- [x] banco conectado, quando precisa de banco
- [x] backend funcionando
- [x] frontend conectado, quando tem tela
- [x] autorização verificada no backend
- [x] tratamento de erro
- [x] estados de carregando e de vazio
- [x] validação
- [x] testes das partes críticas
- [x] documentação
- [x] nenhum dado falso essencial
- [x] nenhum segredo no código
- [x] build passando

**Ter tela não é estar pronto.** Um módulo com interface bonita e sem backend
fica em ANDAMENTO, não em PRONTO.

Legenda: **PRONTO** · **ANDAMENTO** · **BLOQUEADO** · **NÃO INICIADO**

---

## Fundação

| Módulo | Estado | O que falta |
|---|---|---|
| Monorepo, TypeScript estrito, build | **PRONTO** | — |
| Schema do banco e migrations | **PRONTO** | 37 modelos, 5 migrations |
| Pacote de domínio compartilhado | **PRONTO** | 89 testes |
| Configuração, logs estruturados, erros catalogados | **PRONTO** | — |
| Isolamento entre clientes | **PRONTO** | Guard em execução + teste que quebra o build |

## Contas e acesso

| Módulo | Estado | O que falta |
|---|---|---|
| Cadastro e login | **PRONTO** | — |
| Sessão, rotação, detecção de reuso | **PRONTO** | — |
| Verificação de e-mail | **PRONTO** | 12 testes, e-mail real |
| Workspaces e papéis | **PRONTO** | — |
| Convites | **PRONTO** | — |
| Recuperar senha | **PRONTO** | Corrigido na auditoria: telas criadas e 15 checagens em navegador |
| **Trocar a própria senha** | **ANDAMENTO** | Rota existe, nenhuma tela chama |
| **Segundo fator (TOTP)** | **ANDAMENTO** | Login aceita o código; **não existe tela para ativar** |
| Sessões visíveis e revogação | **NÃO INICIADO** | Fila #38 |
| Trocar e-mail, excluir conta | **NÃO INICIADO** | Fila #39 |
| **Login com Google** | **BLOQUEADO** | Precisa de `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` |

## Produto

| Módulo | Estado | O que falta |
|---|---|---|
| Automações: criar, editar, duplicar, publicar, pausar | **PRONTO** | — |
| Versionamento imutável após publicar | **ANDAMENTO** | Backend pronto; sem tela de histórico e restaurar |
| Flow Builder | **PRONTO** | Canvas completo, portas tipadas, validação, testado em navegador |
| Motor de execução | **PRONTO** | Durável, com lock duplo |
| Filas, workers, retry, fila de mortos | **PRONTO** | — |
| Idempotência | **PRONTO** | Stripe e Meta |
| **Contatos** | **ANDAMENTO** | Tela só lê. **12 rotas de escrita sem interface** |
| **Etiquetas, campos, segmentos** | **ANDAMENTO** | Backend completo. **8 rotas sem interface** |
| Inbox e conversas | **ANDAMENTO** | Envio e leitura funcionam; atribuir e mudar status sem tela |
| **Chaves de API** | **ANDAMENTO** | 3 rotas sem interface |
| **Webhooks de saída** | **ANDAMENTO** | 5 rotas sem interface |
| **Modelos de automação** | **ANDAMENTO** | 3 rotas sem interface |
| Pastas de automação | **NÃO INICIADO** | Fila #41–43 |
| Upload de mídia | **NÃO INICIADO** | Hoje só por URL. Fila #25 |

## Integrações

| Módulo | Estado | O que falta |
|---|---|---|
| Capability Engine | **PRONTO** | Nega por padrão; nada da Meta presumido |
| Camada de canais | **PRONTO** | Abstração pronta |
| Instagram — simulador | **PRONTO** | Exercita o produto inteiro sem a Meta |
| **Instagram — ao vivo** | **BLOQUEADO** | `developers.facebook.com` inacessível deste ambiente. Provider ao vivo recusa tudo por projeto |
| **Messenger, Facebook, WhatsApp** | **BLOQUEADO** | Mesma razão. Fila #48 |
| Webhooks da Meta | **PRONTO** | Recebe, valida, grava, enfileira |

## Cobrança

| Módulo | Estado | O que falta |
|---|---|---|
| Planos e cotas | **PRONTO** | Cota checada no servidor, no ponto de criação |
| Checkout Stripe | **PRONTO** | Plano só liberado pelo webhook |
| Webhook do Stripe | **PRONTO** | Assinatura verificada sobre bytes crus |
| Portal do cliente | **PRONTO** | — |
| Inadimplência e suspensão | **PRONTO** | Tolerância antes de suspender |
| **Cobrança ao vivo** | **BLOQUEADO** | Precisa das chaves do Stripe. Roda em modo local hoje |

## Painel administrativo

| Módulo | Estado | O que falta |
|---|---|---|
| Papéis, permissões, auditoria | **PRONTO** | 16 testes |
| Camada de métricas | **PRONTO** | Definição única, protegida por teste |
| Visão geral, contas, assinaturas | **PRONTO** | 20 testes + navegador |
| Financeiro, webhooks, reconciliação | **PRONTO** | 18 testes + navegador |
| Produto, feature flags, limites | **NÃO INICIADO** | Fila #36 |
| Operações, infraestrutura, alertas | **NÃO INICIADO** | Fila #37 |

## Qualidade e operação

| Módulo | Estado | O que falta |
|---|---|---|
| Testes | **ANDAMENTO** | 222 testes + 45 no navegador. Falta cobrir contatos e inbox |
| Limite de requisições | **PRONTO** | — |
| Logs estruturados | **PRONTO** | Nunca registram senha nem token |
| Trilha de auditoria | **PRONTO** | Só leitura, sem rota que edite |
| **Dependências vulneráveis** | **ANDAMENTO** | 27 avisos. `nodemailer` é o único em código de produção |
| **CI** | **NÃO INICIADO** | Fila #26 |
| **Deploy na Heroku** | **NÃO INICIADO** | Fila #46 |
| **CockroachDB** | **BLOQUEADO** | Precisa de cluster |
| Row Level Security | **NÃO INICIADO** | Fila #24 |
| Backup e restauração | **NÃO INICIADO** | Fila #49 |

---

## O que está bloqueado, e por quê

| # | Bloqueio | Quem destrava |
|---|---|---|
| 45 | CockroachDB — não há cluster, e o egress deste ambiente é bloqueado | Marcos cria o cluster |
| 47 | Login com Google — sem credenciais | Marcos cria no Google Cloud Console |
| 48 | Canais da Meta — `developers.facebook.com` inacessível por política de rede | Depende do ambiente |
| — | Stripe ao vivo — sem chaves | Marcos cria a conta |

Nada disso impede o resto. Enquanto estiverem bloqueados, o trabalho segue no
que não depende deles.
