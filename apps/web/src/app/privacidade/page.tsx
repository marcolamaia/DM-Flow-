import { LegalPage, Preencher, Section } from '@/components/legal/legal-page';

export const metadata = {
  title: 'Política de privacidade — DM FLOW',
  description: 'Quais dados a DM FLOW guarda, por quanto tempo e o que você pode pedir.',
};

/**
 * Escrita a partir do que o banco de dados realmente guarda, não de um modelo
 * genérico. Cada campo citado aqui existe no schema.
 *
 * Onde a plataforma ainda NÃO faz algo, está escrito que não faz. Uma política
 * que promete exclusão automática que nenhum código executa é uma declaração
 * falsa num documento jurídico — pior do que não ter política.
 */
export default function PrivacidadePage() {
  return (
    <LegalPage title="Política de privacidade" updatedAt="23 de agosto de 2026">
      <p>
        Esta política explica quais dados a DM FLOW guarda, por que guarda, por quanto tempo, e o
        que você pode pedir a qualquer momento.
      </p>

      <Section title="Quem é o responsável">
        <p>
          <Preencher>RAZÃO SOCIAL</Preencher>, inscrita no CNPJ sob o nº{' '}
          <Preencher>CNPJ</Preencher>, com sede em <Preencher>ENDEREÇO COMPLETO</Preencher>.
        </p>
        <p>
          Contato para assuntos de privacidade: <Preencher>E-MAIL DE CONTATO</Preencher>.
        </p>
      </Section>

      <Section title="Há dois tipos de pessoa nesta política">
        <p>
          Isto importa porque os dados e os direitos são diferentes para cada uma.
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Você, cliente da DM FLOW.</strong> Criou uma conta aqui para automatizar as
            conversas do seu negócio.
          </li>
          <li>
            <strong>Os contatos do seu cliente.</strong> Pessoas que mandaram mensagem para o
            Instagram <em>dele</em>. A DM FLOW guarda os dados delas{' '}
            <strong>em nome do cliente</strong>, seguindo as instruções dele. Perante essas
            pessoas, quem responde pelo uso dos dados é o cliente; a DM FLOW é a ferramenta.
          </li>
        </ul>
      </Section>

      <Section title="O que guardamos sobre você, cliente">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Nome e e-mail</li>
          <li>Sua senha, guardada apenas como <strong>hash Argon2id</strong> — nunca em texto legível, e nem nós conseguimos lê-la</li>
          <li>Foto de perfil, se você colocar uma</li>
          <li>Idioma escolhido</li>
          <li>Se o segundo fator está ativo, e o segredo dele <strong>cifrado</strong></li>
          <li>Data do último acesso e datas de criação e alteração da conta</li>
          <li>Suas sessões abertas, com endereço de origem e navegador</li>
          <li>Registro das ações administrativas feitas na sua conta</li>
        </ul>
      </Section>

      <Section title="O que guardamos sobre os contatos">
        <p>
          Somente o que os canais oficiais entregam e o que o cliente decide registrar:
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Nome de exibição, nome de usuário e foto, quando o canal fornece</li>
          <li>Identificador da pessoa naquele canal</li>
          <li>Mensagens trocadas nas conversas</li>
          <li>Etiquetas e campos personalizados que o cliente criou</li>
          <li>Estado de consentimento, quando registrado</li>
          <li>Primeira e última interação</li>
        </ul>
        <p>
          <strong>Não coletamos nada por fora das APIs oficiais.</strong> Sem raspagem de dados,
          sem automação de navegador, sem uso de API não oficial. A plataforma é construída para
          recusar qualquer coisa que a API oficial não permita — o que ela não autoriza, aqui
          simplesmente não acontece.
        </p>
      </Section>

      <Section title="Pagamento">
        <p>
          Pagamentos são processados pelo <strong>Stripe</strong>. Número de cartão, código de
          segurança e dados bancários <strong>nunca passam pelos nossos servidores</strong> e nunca
          são guardados por nós. Guardamos apenas o identificador da sua assinatura no Stripe, o
          plano e a situação da cobrança.
        </p>
      </Section>

      <Section title="Por quanto tempo guardamos">
        <p>
          Enquanto sua conta existir. Se você excluir a conta, os dados são apagados, salvo o
          mínimo que a lei obrigue a manter (registros fiscais, por exemplo).
        </p>
        <p className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-[14px]">
          <strong>Aviso honesto sobre o estado atual:</strong> os planos preveem janelas de
          retenção diferentes para o histórico de execução das automações, mas{' '}
          <strong>essa exclusão automática ainda não está implementada</strong>. Hoje o histórico é
          mantido enquanto a conta existir. Esta política será atualizada quando o descarte
          automático passar a funcionar — e não antes.
        </p>
      </Section>

      <Section title="Com quem compartilhamos">
        <p>Apenas com quem é necessário para a plataforma funcionar:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li><strong>Meta</strong> — para enviar e receber mensagens pelos canais oficiais</li>
          <li><strong>Stripe</strong> — para processar pagamentos</li>
          <li><strong>Provedor de hospedagem</strong> — onde a plataforma roda</li>
          <li><strong>Provedor de e-mail</strong> — para enviar confirmação, convite e redefinição de senha</li>
        </ul>
        <p>
          <strong>Não vendemos dados. Não cedemos dados para publicidade de terceiros.</strong>
        </p>
      </Section>

      <Section title="Seus direitos (LGPD)">
        <p>Você pode, a qualquer momento, pedir:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Confirmação de que tratamos dados seus</li>
          <li>Acesso aos dados</li>
          <li>Correção de dado incompleto ou errado</li>
          <li>Exclusão dos dados</li>
          <li>Portabilidade</li>
          <li>Informação sobre com quem compartilhamos</li>
        </ul>
        <p className="rounded-lg border border-warning/40 bg-warning/5 p-3 text-[14px]">
          <strong>Aviso honesto sobre o estado atual:</strong> ainda não existe um botão na
          plataforma para exercer esses direitos sozinho. Hoje o pedido é feito por e-mail para{' '}
          <Preencher>E-MAIL DE CONTATO</Preencher> e atendido manualmente, dentro do prazo legal.
          A tela para fazer isso sem depender de nós está no plano de trabalho.
        </p>
        <p>
          Se você é <strong>contato de um cliente</strong> nosso e quer exercer seus direitos, fale
          primeiro com a empresa que te mandou a mensagem — os dados são dela, e nós agimos por
          instrução dela. Se não conseguir, escreva para nós e ajudamos a localizar o responsável.
        </p>
      </Section>

      <Section title="Segurança">
        <p>O que está efetivamente implementado hoje:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Senha com Argon2id, nunca em texto legível</li>
          <li>Tokens de canal e segredo de segundo fator cifrados com AES-256-GCM</li>
          <li>Sessão em cookie inacessível a JavaScript, com rotação e detecção de reuso</li>
          <li>Isolamento entre contas verificado em três camadas, uma delas por teste automático que impede publicar código que vaze dados entre clientes</li>
          <li>Limite de tentativas para conter ataque de força bruta</li>
          <li>Registros do sistema nunca gravam senha, token completo ou chave de pagamento</li>
        </ul>
        <p>
          Nenhum sistema é imune. Se descobrirmos um incidente que possa gerar risco a você,
          comunicaremos você e a ANPD conforme a lei exige.
        </p>
      </Section>

      <Section title="Cookies">
        <p>
          Usamos o mínimo. Um cookie de sessão, para manter você conectado, e preferências guardadas
          no seu próprio navegador — idioma, tema e qual conta estava aberta. Não usamos cookie de
          publicidade nem de rastreamento de terceiros.
        </p>
      </Section>

      <Section title="Mudanças nesta política">
        <p>
          Se algo mudar de forma relevante, avisamos por e-mail antes de valer. A data no topo
          sempre reflete a última alteração.
        </p>
      </Section>
    </LegalPage>
  );
}
