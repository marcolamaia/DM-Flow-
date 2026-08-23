# Segurança da DM FLOW

O que está implementado, o que foi decidido conscientemente não fazer, e o que
ainda falta. Nada aqui é aspiração — cada item descreve o código que existe.

---

## Senhas

- **Argon2id**, com `memoryCost` 19 MiB, `timeCost` 2, `parallelism` 1
- Nunca em texto puro, em lugar nenhum
- O hash **nunca sai pela API**. Toda leitura de usuário nomeia as colunas em vez de devolver a linha inteira, e há teste procurando `$argon2` na resposta
- Login errado e conta inexistente custam o mesmo tempo: quando o e-mail não existe, uma verificação falsa é executada mesmo assim, senão o tempo de resposta vira uma lista de quem tem conta
- Trocar a senha encerra **todas** as sessões, em todos os aparelhos

## Sessões

- Token opaco em cookie `httpOnly` — JavaScript não alcança. Sem isso, qualquer XSS vira tomada de conta
- `Secure` em produção, `SameSite=lax`
- Token **rotacionado** a cada uso
- **Reuso detectado**: se um token antigo reaparece, todas as sessões daquele usuário são encerradas, porque token antigo reaparecendo significa que alguém copiou
- Conta bloqueada é verificada a cada requisição, não só no login: bloqueio que espera o cookie vencer não é bloqueio

## Autorização

- Decidida **num guard só**. Controller nunca inspeciona papel. Isso mantém "quem pode fazer isto?" num arquivo legível em vez de espalhado em condicionais que divergem
- Papéis de plataforma são **separados** dos papéis de workspace. Ser dono do próprio workspace não diz nada sobre ler a cobrança de outro cliente
- Rota administrativa sem permissão declarada é **recusada**, não exposta: um endpoint novo que esqueça o decorator falha fechado
- Para quem não é admin, a resposta é **404, não 403** — um 403 confirmaria que o painel existe
- Ações que mexem em dinheiro, acesso ou conta exigem motivo, verificado **antes** da ação

## Isolamento entre clientes

Três camadas, porque a primeira sozinha depende de ninguém esquecer:

1. `AuthGuard` resolve o workspace e confere que o usuário pertence a ele
2. Guard no Prisma intercepta consulta em modelo com dono e confere o filtro em tempo de execução
3. Teste que varre o código atrás de consulta sem filtro e **quebra o build** se achar uma não justificada por escrito

Já pegou seis casos durante o desenvolvimento do painel administrativo.

Falta a quarta camada: Row Level Security no Postgres (fila #24).

## Segredos

- Tokens de canal e segredo de TOTP com **AES-256-GCM**
- Token nunca aparece inteiro na interface, em nenhuma tela
- Nenhum `.env` versionado; `.gitignore` cobre os três padrões
- `.env.example` só com nomes
- Logs **nunca** registram senha, token completo, chave do Stripe nem segredo da Meta

## Entrada e rede

- Todo corpo de requisição validado com Zod antes de chegar no serviço
- **Proteção contra SSRF** no bloco de requisição HTTP: endereços privados, loopback e link-local recusados, com 8 testes
- Limite de requisições **global**, contando sempre pelo endereço de origem; uma credencial apresentada só adiciona um balde mais apertado, nunca substitui
- Helmet ligado
- CORS restrito à origem do frontend
- Assinatura do webhook do Stripe verificada **sobre os bytes crus**, nunca sobre o corpo já interpretado

---

## Decisões conscientes

### Sem token anti-CSRF

O cookie usa `SameSite=lax`, que barra o caso clássico, e a API fica em origem
separada com CORS restrito. Um token anti-CSRF seria uma camada a mais.

**Está registrado aqui como decisão, não como esquecimento.** Se a API e o
frontend passarem a dividir a mesma origem, ou se `SameSite` precisar afrouxar
por qualquer motivo, esta decisão precisa ser revista antes.

### `@nestjs/core` — aviso que não nos alcança

O `pnpm audit` aponta `@nestjs/core <=11.1.17` (gravidade média). O aviso é
sobre `SseStream._transform()`, que interpola `message.type` e `message.id` na
saída de **Server-Sent Events** sem limpar quebra de linha.

**A DM FLOW não usa Server-Sent Events em lugar nenhum.** O tempo real é feito
por WebSocket (`inbox.gateway.ts`). Verificado:

```
grep -rn "@Sse|SseStream|text/event-stream" apps/api/src   # nenhum resultado
```

A correção existe só na linha 11.x, e subir de Nest 10 para 11 é uma troca de
versão maior que atravessa todos os módulos. Fazer isso por um aviso que
comprovadamente não nos alcança seria trocar risco real por risco imaginário.

**Fica assim até:** a DM FLOW passar a usar SSE, ou aparecer outro motivo para
subir de versão maior. Aí sobe junto.

---

## Dependências

Corrigido nesta passada:

| Pacote | De | Para | Por quê |
|---|---|---|---|
| `nodemailer` | 7.x | 9.0.5 | Gravidade alta, e é código de **produção** — envia verificação de e-mail e redefinição de senha |

Depois da atualização os 133 testes da API continuam passando, incluindo os 12
que exercitam o envio de e-mail de verdade.

O que sobra, e por que não é urgente:

| Pacote | Gravidade | Onde entra | Situação |
|---|---|---|---|
| `vitest`, `vite`, `esbuild` | crítica/alta | só desenvolvimento | Não vai para produção |
| `sharp`, `postcss` | alta | transitivo do `next` | Sai quando o Next atualizar |
| `multer` | alta | transitivo do `@nestjs/platform-express` | **Não há upload hoje**. Vira urgente no dia que houver (fila #25) |
| `@nestjs/core` | média | direto | Não nos alcança — ver acima |
| `qs`, `body-parser` | média/baixa | transitivo do express | Sai com o Nest |

---

## O que ainda falta

| # | Item | Fila |
|---|---|---|
| 1 | Row Level Security no Postgres, como quarta camada de isolamento | #24 |
| 2 | Sessões visíveis para o próprio usuário, com revogação | #38 |
| 3 | Reautenticação antes de ação sensível | #38 |
| 4 | Validação de upload (tipo, tamanho, dono) quando houver upload | #25 |
| 5 | Rotação programada de segredos | — |

---

## Ao encontrar uma falha

Não abra issue pública. Escreva para o responsável pelo projeto com o que
encontrou e como reproduzir.
