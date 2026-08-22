# Segurança — DM FLOW

> Última atualização: 2026-08-22

## Ativos mais sensíveis

1. **Tokens de canal.** Autorizam enviar mensagem como o negócio do cliente.
2. **Dados de usuários finais** que nunca se cadastraram na DM FLOW.
3. **Chaves de API** dos clientes.

## Controles implementados

| Área | Controle |
|---|---|
| Segredos em repouso | AES-256-GCM com IV aleatório por valor e tag de autenticação. Ciphertext diferente a cada chamada, payload adulterado é rejeitado — coberto por teste. |
| Tokens opacos | Sessão, convite, reset e API key gravados como SHA-256, nunca em claro. |
| Senhas | Argon2id (19 MiB, t=2, p=1). |
| Sessão | Cookie `httpOnly`, `SameSite=Lax`, `Secure` em produção. Rotação após 24h. Reuso de token revogado → todas as sessões do usuário são revogadas. |
| Enumeração de e-mail | Login sempre executa uma verificação Argon2 dummy; recuperação de senha sempre responde sucesso. |
| Autorização | Um único guard decide identidade, tenancy e permissão. Nenhum controller lê papel. Matriz por papel testada nos dois lados (permitido e negado). |
| Isolamento de tenant | `workspaceId` obrigatório no escopo + `assertTenant` em toda leitura por id vindo do cliente + varredura estática que reprova consulta em massa sem filtro de workspace, com justificativa escrita obrigatória para cada exceção. Cross-tenant responde `NOT_FOUND`, nunca `FORBIDDEN` — confirmar que o recurso existe alhures já é vazamento. |
| Webhooks de entrada | HMAC sobre os **bytes crus**, comparação em tempo constante, 401 sem assinatura válida. |
| Webhooks de saída | Assinados do mesmo jeito que exigimos na entrada, com backoff exponencial limitado. |
| SSRF (node HTTP) | Só https; DNS resolvido e o **IP resultante** validado contra faixas privadas, loopback, link-local e metadados; IPv4-mapped IPv6 coberto; redirect revalidado salto a salto; headers próprios nunca encaminhados. |
| Injeção SQL | Predicados compilados com parâmetros vinculados; nomes de coluna vêm de allow-list e campo desconhecido é **rejeitado**, não escapado. |
| Expressões | Interpolação é substituição de caminho, não linguagem. Acesso a `__proto__`, `prototype` e `constructor` bloqueado — testado. |
| Logs | Redação no próprio logger, não no call site. |
| Stripe | Assinatura verificada sobre bytes crus; evento gravado pelo id do Stripe antes de ser aplicado, então redelivery não aplica upgrade duplicado. |
| Auditoria | `AuditLog` append-only; falha de escrita nunca derruba a ação descrita. |

## Endurecimento pendente

| Item | Por que ainda não está |
|---|---|
| Row Level Security | Exige role de banco sem `BYPASSRLS` e `SET LOCAL app.workspace_id` por transação. O isolamento atual é de aplicação, com testes que provam o bloqueio entre tenants — mas RLS é defesa em profundidade e deve ser adicionada antes de produção. |
| Rotação de chave de cifra | O formato já carrega prefixo de versão (`v1.`); falta o job de recifragem. |
| Rate limiting por IP/rota | Configurado no env, ainda não aplicado como guard global. |
| Verificação de e-mail obrigatória | Campo existe; fluxo de envio não. |
| Varredura de segredos no CI | Pipeline ainda não criado. |

## Resposta a incidente

1. Revogar tokens do canal afetado (`DELETE /channels/:id` destrói o token guardado).
2. Revogar sessões: `Session.updateMany({ revokedAt })` para o usuário ou workspace.
3. Revogar API keys pelo painel.
4. `AuditLog` e `WebhookEvent` são append-only e reconstroem a linha do tempo.
