# Como rodar a DM FLOW no seu computador

Guia para quem não é programador. São 3 passos e leva cerca de 15 minutos na
primeira vez (a maior parte é o computador baixando coisas sozinho).

---

## Passo 1 — Instalar o Docker Desktop

O Docker é um programa que roda a plataforma inteira sem você precisar instalar
banco de dados, servidor, nada. Instala uma vez e pronto.

1. Acesse **https://www.docker.com/products/docker-desktop/**
2. Baixe a versão do seu sistema (Mac ou Windows) e instale como qualquer programa.
3. **Abra o Docker Desktop** e espere o ícone da baleia ficar verde/estável.
   Ele precisa estar aberto enquanto você usa a DM FLOW.

> No Windows ele pode pedir para ativar o WSL2 e reiniciar o computador. Aceite.

---

## Passo 2 — Baixar o código

**Opção A — pelo site do GitHub (mais simples):**

1. Abra: **https://github.com/marcolamaia/DM-Flow-/tree/claude/dm-flow-master-prompt-pmxmab**
2. Botão verde **`Code`** → **`Download ZIP`**
3. Descompacte o ZIP numa pasta fácil de achar, como a Área de Trabalho.

**Opção B — pelo terminal (se você já usa git):**

```bash
git clone -b claude/dm-flow-master-prompt-pmxmab https://github.com/marcolamaia/DM-Flow-.git
```

---

## Passo 3 — Ligar

Primeiro você precisa abrir o terminal **dentro da pasta do projeto**. O jeito
mais fácil, que funciona sempre:

**No Mac:**

1. Aperte `Command` + `barra de espaço`, digite **Terminal** e aperte Enter.
2. Na janela preta que abrir, digite `cd ` — a letra c, a letra d e **um espaço**.
3. **Arraste a pasta do projeto** de dentro do Finder para essa janela preta.
   O caminho da pasta aparece sozinho.
4. Aperte Enter.

**No Windows:** abra a pasta, clique na barra de endereço lá em cima, apague o
que estiver escrito, digite `cmd` e aperte Enter.

Agora cole este comando e aperte Enter:

```bash
docker compose up
```

Na primeira vez ele vai baixar e montar tudo. **Pode demorar 10–15 minutos** e vai
escrever muita coisa na tela — é normal, deixe rodando.

Quando parar de rolar texto e você vir linhas com `dmflow api listening` e
`dmflow worker started`, está pronto.

### Abra no navegador

**http://localhost:3000**

Entre com:

| | |
|---|---|
| **E-mail** | `demo@dmflow.app` |
| **Senha** | `dmflow-demo-2026` |

---

## Testando de verdade

A conta já vem com um Instagram simulado conectado e uma automação publicada:
*quem comenta "quero" recebe o link no direct.*

Para simular alguém comentando no seu post, abra **outro terminal** na mesma pasta
e rode:

```bash
docker compose exec api pnpm --filter @dmflow/api simulate:comment "quero o link"
```

Agora volte no navegador e veja:

- **Conversas** → apareceu uma conversa nova com a resposta automática enviada
- **Contatos** → a pessoa virou contato, com a tag *Lead quente* e score 80
- **Automações** → abra o fluxo e veja o desenho dele
- **Relatórios** → os números subiram

Outros eventos que você pode simular:

```bash
docker compose exec api pnpm --filter @dmflow/api simulate:dm "qual o preço?"
docker compose exec api pnpm --filter @dmflow/api simulate:story "amei isso"
```

---

## Para desligar

No terminal onde está rodando, aperte **Ctrl + C**.

Para ligar de novo depois, é só `docker compose up` outra vez — bem mais rápido,
porque já está tudo baixado. **Seus dados continuam salvos.**

Se quiser apagar tudo e começar do zero:

```bash
docker compose down -v
```

---

## Se der errado

| O que aparece | O que fazer |
|---|---|
| `docker: command not found` | O Docker Desktop não está instalado ou não está aberto. Abra ele e tente de novo. |
| `Cannot connect to the Docker daemon` | O Docker Desktop está fechado. Abra e espere o ícone estabilizar. |
| `port is already allocated` | Alguma coisa já usa a porta 3000 ou 5432. Feche o outro programa, ou me avise que eu troco as portas. |
| A tela fica em branco no navegador | Espere mais um pouco: o site é o último a subir. Recarregue depois de 30 segundos. |
| Qualquer outro erro | **Copie as últimas 20 linhas do terminal e me mande.** Eu corrijo. |

---

## Sobre os e-mails

Rodando na sua máquina, a plataforma **não envia e-mail de verdade**. Ela escreve
a mensagem no log e devolve o link direto na tela. Isso vale para:

- confirmação de e-mail no cadastro,
- convite de pessoa para o workspace,
- redefinição de senha.

Na prática: quando você criar a conta, vai aparecer um aviso amarelo no topo
pedindo para confirmar o e-mail. Clique em **Reenviar e-mail** — o link de
confirmação sai no log do servidor. Sem confirmar, você navega normalmente, mas
não consegue publicar automação nem conectar conta.

Quando for colocar no ar de verdade, é só preencher no `.env`:

```
MAIL_TRANSPORT=smtp
SMTP_URL=smtps://usuario:senha@smtp.seuprovedor.com:465
MAIL_FROM=nao-responda@seudominio.com
```

A API **não sobe em produção** sem isso. É de propósito: um sistema que engole a
redefinição de senha em silêncio é pior do que um que avisa que está mal
configurado.

---

## Uma coisa importante sobre o Instagram

O Instagram que vem ligado é **simulado**. Ele reproduz fielmente o formato de uma
integração real — webhooks assinados, autorização, limites de envio, erros — mas
não conversa com o Instagram de verdade.

Isso é de propósito. Para conectar uma conta real é preciso primeiro validar, na
documentação oficial da Meta, quais são os endpoints, permissões e limites de
verdade. Enquanto isso não for feito, a plataforma **se recusa** a usar conta real,
em vez de tentar adivinhar e falhar na frente de um cliente pagante.

Está tudo explicado em `docs/known-limitations.md`.
