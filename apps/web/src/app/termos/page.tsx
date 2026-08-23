import { LegalPage, Preencher, Section } from '@/components/legal/legal-page';

export const metadata = {
  title: 'Termos de uso — DM FLOW',
  description: 'As regras de uso da DM FLOW, o que é proibido e como funciona a cobrança.',
};

export default function TermosPage() {
  return (
    <LegalPage title="Termos de uso" updatedAt="23 de agosto de 2026">
      <p>
        Ao criar uma conta na DM FLOW você concorda com estas regras. Elas são curtas de propósito.
      </p>

      <Section title="Quem oferece o serviço">
        <p>
          <Preencher>RAZÃO SOCIAL</Preencher>, CNPJ <Preencher>CNPJ</Preencher>, com sede em{' '}
          <Preencher>ENDEREÇO COMPLETO</Preencher>. Contato:{' '}
          <Preencher>E-MAIL DE CONTATO</Preencher>.
        </p>
      </Section>

      <Section title="O que a DM FLOW é">
        <p>
          Uma ferramenta para automatizar conversas em canais de mensagem, usando{' '}
          <strong>exclusivamente as APIs oficiais</strong> dos provedores. Você conecta suas
          próprias contas, monta seus fluxos e a plataforma os executa.
        </p>
        <p>
          A DM FLOW não é afiliada, patrocinada nem endossada pela Meta, pelo Instagram ou por
          qualquer outra plataforma citada.
        </p>
      </Section>

      <Section title="Sua conta">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Você é responsável por manter sua senha em segurança</li>
          <li>Recomendamos fortemente ativar a verificação em duas etapas</li>
          <li>Você responde pelo que é feito com a sua conta</li>
          <li>Você precisa ter idade legal para contratar</li>
          <li>Os dados de cadastro precisam ser verdadeiros</li>
        </ul>
      </Section>

      <Section title="O que é proibido">
        <p>
          Estas proibições não são formalidade. Violar qualquer uma delas leva à suspensão da conta,
          e algumas colocam em risco também as contas de Instagram conectadas — que são suas.
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Enviar mensagem não solicitada.</strong> Automação existe para responder quem
            procurou você, não para abordar quem nunca pediu contato. Isso viola as regras do
            próprio provedor.
          </li>
          <li>
            <strong>Contornar as regras do canal.</strong> Tentar burlar limite de envio, janela de
            atendimento ou qualquer restrição da plataforma de origem.
          </li>
          <li>
            <strong>Usar dados de terceiros sem base legal.</strong> Importar lista comprada,
            raspada ou obtida sem consentimento.
          </li>
          <li>
            <strong>Conteúdo ilegal, fraudulento ou enganoso</strong>, incluindo se passar por outra
            pessoa ou empresa.
          </li>
          <li>
            <strong>Tentar acessar dados de outro cliente</strong>, sondar falhas de segurança sem
            autorização ou sobrecarregar a plataforma de propósito.
          </li>
          <li>
            <strong>Revender acesso</strong> sem acordo escrito conosco.
          </li>
        </ul>
      </Section>

      <Section title="Cobrança">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Existe um plano gratuito, com limites menores</li>
          <li>Planos pagos são cobrados por assinatura recorrente, processada pelo Stripe</li>
          <li>Você pode cancelar quando quiser; o acesso segue até o fim do período já pago</li>
          <li>Se o pagamento falhar, há um período de tolerância antes de qualquer suspensão, e você é avisado</li>
          <li>Conta suspensa por falta de pagamento <strong>mantém os dados</strong>; as automações é que param</li>
        </ul>
        <p>
          Preços e limites de cada plano ficam na página de planos e podem mudar. Mudança de preço
          é avisada com antecedência e nunca se aplica a período já pago.
        </p>
      </Section>

      <Section title="Seus dados e seus fluxos são seus">
        <p>
          Os contatos, mensagens e automações que você cria são seus. Não usamos o conteúdo dos seus
          fluxos nem as conversas dos seus contatos para nenhuma finalidade além de operar o serviço
          para você.
        </p>
        <p>
          Você pode exportar seus dados e pode excluir sua conta. Ver a{' '}
          <a href="/privacidade" className="text-accent hover:underline">
            política de privacidade
          </a>
          .
        </p>
      </Section>

      <Section title="Disponibilidade">
        <p>
          Trabalhamos para manter a plataforma no ar, mas ela depende de terceiros — provedores de
          nuvem e as próprias APIs da Meta. Não prometemos disponibilidade ininterrupta, e mudanças
          feitas pela Meta nas APIs dela podem alterar ou remover funcionalidades daqui sem que
          possamos evitar.
        </p>
        <p>
          Quando isso acontecer, a plataforma vai <strong>dizer o que deixou de ser possível</strong>{' '}
          em vez de fingir que continua funcionando.
        </p>
      </Section>

      <Section title="Encerramento">
        <p>
          Você pode encerrar sua conta a qualquer momento. Podemos encerrar a sua em caso de
          violação destes termos, de exigência legal, ou de risco às demais contas — nesse caso,
          avisando o motivo, salvo quando a lei impedir.
        </p>
      </Section>

      <Section title="Limitação de responsabilidade">
        <p>
          Na medida permitida pela lei, nossa responsabilidade fica limitada ao valor pago por você
          nos 12 meses anteriores ao fato. Não respondemos por lucros cessantes nem por decisões
          comerciais que você tome a partir do uso da plataforma.
        </p>
      </Section>

      <Section title="Lei aplicável">
        <p>
          Estes termos são regidos pela lei brasileira. Fica eleito o foro de{' '}
          <Preencher>COMARCA</Preencher> para dirimir controvérsias, salvo direito do consumidor de
          escolher o foro do seu domicílio.
        </p>
      </Section>
    </LegalPage>
  );
}
