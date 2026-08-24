# Kit da Meta — o que ter em mãos antes de abrir o painel

Para o Marcos. Objetivo: quando você abrir o painel de desenvolvedor da Meta,
não precisar parar no meio pra procurar nada.

**Endereço:** `developers.facebook.com`

---

## Por que eu não faço isso por você

Não é falta de vontade. São três motivos, e nenhum tem conserto do meu lado:

1. Eu rodo num servidor na nuvem, não no seu Mac. Não tenho como abrir o seu
   navegador.
2. Deste servidor, `developers.facebook.com` está bloqueado por política de rede.
   Testado de novo em 24/08/2026: não responde.
3. Criar o app exige entrar com o **seu** login do Facebook e aceitar os termos da
   Meta em nome da **sua** empresa. É ato jurídico com o seu CNPJ atrás — e a
   regra que você mesmo colocou no projeto diz que login da Meta só acontece pelo
   fluxo oficial, nunca por mim.

O que eu posso fazer é o que está abaixo: deixar tudo pronto pra colar, e te
guiar em tempo real pelas telas que você me mostrar.

---

## O que a Meta vai pedir, e o que responder

### Dados da empresa

| Campo | Valor |
|---|---|
| Razão social | `PREENCHER` |
| CNPJ | `PREENCHER` |
| Endereço | `PREENCHER` |
| E-mail de contato | `PREENCHER` |

Os mesmos que vão nas páginas de privacidade e termos. Use exatamente iguais nos
dois lugares — divergência entre o que a Meta tem e o que o site diz é motivo de
recusa na análise.

### Endereços do sistema

Estes eu tirei do código, não são chute. Trocar `SUA-API` e `SEU-SITE` pelos
endereços reais quando existirem.

| Para que serve | Endereço |
|---|---|
| Webhook (a Meta avisa aqui quando chega mensagem) | `https://SUA-API/webhooks/instagram` |
| Retorno do login (pra onde a Meta manda o usuário depois de autorizar) | `https://SUA-API/channels/callback/instagram` |
| Política de privacidade | `https://SEU-SITE/privacidade` |
| Termos de uso | `https://SEU-SITE/termos` |
| Exclusão de dados | `https://SEU-SITE/privacidade` |

### Token de verificação do webhook

Uma senha que **você inventa** e informa nos dois lados: no painel da Meta e na
variável `META_WEBHOOK_VERIFY_TOKEN` da Heroku. A Meta devolve esse valor pra
confirmar que o webhook é seu de verdade.

Não precisa ser bonito, precisa ser difícil de adivinhar. Gere um assim, no
Terminal do seu Mac:

```
openssl rand -hex 24
```

Guarde. Não me mande.

### O que sai de lá e vem pra cá

Terminando, a Meta te dá dois valores. Eles vão nas Config Vars da Heroku:

| Da Meta | Vai para |
|---|---|
| App ID | `META_APP_ID` |
| App Secret | `META_APP_SECRET` |

**O App Secret é senha.** Nunca me mande por aqui, nunca coloque em arquivo do
projeto, nunca em mensagem. Você cola direto no painel da Heroku.

---

## A ordem importa, e não é a que parece

Tem uma pegadinha de sequência aqui:

O app pode ser **criado** hoje. Mas a etapa em que a Meta liga o webhook precisa
que `https://SUA-API/webhooks/instagram` **exista, responda e esteja no ar** —
ela chama esse endereço na hora e espera resposta.

Ou seja: sem domínio e sem a plataforma publicada, você cria o app e para no meio.

Duas ordens possíveis:

**A — domínio primeiro** (menos idas e vindas)
1. Registrar o domínio
2. Subir na Heroku e apontar o domínio
3. Criar o app na Meta já com os endereços prontos
4. Pedir a análise

**B — começar agora** (adianta o relógio da Meta)
1. Criar o app hoje, sem os endereços
2. Registrar domínio e subir na Heroku em paralelo
3. Voltar ao painel da Meta e preencher os endereços
4. Pedir a análise

A **B** ganha tempo se a análise da Meta for o gargalo. A **A** dá menos trabalho.

---

## O que eu deliberadamente NÃO escrevi aqui

Nome de permissão, nome de produto, nome de botão, sequência de telas e prazo de
análise.

Não porque seja difícil — porque eu não consigo abrir a documentação oficial
deste ambiente, e escrever de memória seria inventar. A Meta muda esses nomes
com frequência, e um passo a passo errado faz você perder mais tempo do que não
ter passo a passo nenhum.

**Como resolvemos isso:** você abre o painel, tira print da tela, e eu te digo o
que preencher em cima do que está aparecendo de verdade. Sem chute.
