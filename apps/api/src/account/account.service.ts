import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import type { Response } from 'express';
import { DmFlowError, maskEmail, randomToken, uuidv7 } from '@dmflow/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../auth/session.service';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../common/audit.service';
import { DomainEventsService } from '../admin/domain-events.service';
import { hashToken } from '../common/crypto';
import { logger } from '../common/logger';

/**
 * O ciclo de vida da conta: trocar o endereço, e encerrar.
 *
 * Separado de AuthService de propósito. Aquele cuida de credencial e sessão —
 * coisas que acontecem muitas vezes por dia. Este cuida de duas operações raras
 * e irreversíveis, e as duas precisam olhar para fora da conta: para as áreas de
 * trabalho, para os outros membros e para a cobrança.
 */

/** Uma hora. Curto de propósito: é uma troca de identidade, não um convite. */
const EMAIL_CHANGE_TTL_MS = 60 * 60 * 1000;

/**
 * Estados em que uma assinatura ainda pode gerar cobrança.
 *
 * `CANCELED`, `INCOMPLETE_EXPIRED` e `PAUSED` ficam de fora: nenhum deles volta
 * a cobrar sozinho, então nenhum deles é motivo para impedir alguém de sair.
 */
const BILLABLE_STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'UNPAID', 'INCOMPLETE'] as const;

export interface WorkspaceOutcome {
  id: string;
  name: string;
  /** O que acontece com ela se a conta for excluída agora. */
  outcome: 'deleted' | 'left';
  /** Só para as que serão apagadas: o que vai junto. */
  contacts?: number;
  automations?: number;
  conversations?: number;
}

export interface DeletionBlocker {
  code: 'ACCOUNT_DELETE_LAST_OWNER' | 'ACCOUNT_DELETE_ACTIVE_SUBSCRIPTION';
  workspaceId: string;
  workspaceName: string;
  /** Quantas outras pessoas ficariam sem dono. Só no caso do último proprietário. */
  otherMembers?: number;
  /** Só no caso da assinatura: o plano que continuaria cobrando. */
  planName?: string;
}

export interface DeletionPreview {
  /** Enquanto houver um só, a exclusão é recusada. */
  blockers: DeletionBlocker[];
  workspaces: WorkspaceOutcome[];
  /** Quantas sessões abertas serão encerradas. */
  sessions: number;
}

@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly events: DomainEventsService,
  ) {}

  // ── Trocar o e-mail ────────────────────────────────────────

  /**
   * Pede a troca. Não troca nada.
   *
   * Três defesas, e cada uma cobre um jeito diferente de perder a conta:
   *
   * 1. Exige a senha. Uma sessão roubada sozinha não basta.
   * 2. O endereço só muda quando alguém prova ter a caixa NOVA. Quem invadiu
   *    até consegue pedir, mas a confirmação chega num endereço que ele
   *    controla — e é justamente por isso que ela não vale nada sem o passo 3.
   * 3. O endereço ANTIGO recebe um aviso na hora do pedido, enquanto o dono
   *    ainda tem acesso e ainda dá tempo de reagir.
   */
  async requestEmailChange(
    userId: string,
    newEmailRaw: string,
    password: string,
  ): Promise<{ maskedNewEmail: string; token?: string; delivered: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) throw new DmFlowError('NOT_AUTHENTICATED');

    const valid = await argon2.verify(user.passwordHash, password).catch(() => false);
    if (!valid) throw new DmFlowError('INVALID_CREDENTIALS');

    const newEmail = newEmailRaw.trim().toLowerCase();
    if (newEmail === user.email.toLowerCase()) {
      throw new DmFlowError('EMAIL_CHANGE_SAME_ADDRESS');
    }

    const taken = await this.prisma.user.findUnique({ where: { email: newEmail } });
    if (taken) throw new DmFlowError('EMAIL_ALREADY_REGISTERED');

    const token = randomToken(32);

    await this.prisma.$transaction([
      // Um pedido por vez. O anterior morre, e com ele o link que já tinha saído.
      this.prisma.emailChangeRequest.updateMany({
        where: { userId, usedAt: null, canceledAt: null },
        data: { canceledAt: new Date() },
      }),
      this.prisma.emailChangeRequest.create({
        data: {
          id: uuidv7(),
          userId,
          newEmail,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + EMAIL_CHANGE_TTL_MS),
        },
      }),
    ]);

    const confirmation = await this.mail.sendEmailChangeConfirmation({
      to: newEmail,
      currentEmail: user.email,
      locale: user.locale,
      token,
      expiresHours: EMAIL_CHANGE_TTL_MS / 3_600_000,
    });

    // Ao endereço antigo, sempre, e sem link. Se falhar, o pedido continua de
    // pé — mas fica registrado que o dono não foi avisado.
    const notice = await this.mail.sendEmailChangeNotice({
      to: user.email,
      locale: user.locale,
      maskedNewEmail: maskEmail(newEmail),
    });
    if (!notice.delivered) {
      logger.warn(
        { userId },
        'email change requested but the notice to the previous address did not go out',
      );
    }

    await this.audit.record({
      actorUserId: userId,
      action: 'account.email_change_requested',
      entityType: 'User',
      entityId: userId,
      // O endereço novo em claro no registro de auditoria seria expor, para
      // quem lê a auditoria, um dado que ainda nem foi confirmado.
      after: { newEmail: maskEmail(newEmail) },
    });

    return {
      maskedNewEmail: maskEmail(newEmail),
      token: confirmation.previewUrl ? token : undefined,
      delivered: confirmation.delivered,
    };
  }

  /** O pedido em aberto, para a tela poder mostrar que existe um. */
  async pendingEmailChange(userId: string): Promise<{ maskedNewEmail: string; expiresAt: Date } | null> {
    const pending = await this.prisma.emailChangeRequest.findFirst({
      where: { userId, usedAt: null, canceledAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!pending) return null;
    return { maskedNewEmail: maskEmail(pending.newEmail), expiresAt: pending.expiresAt };
  }

  async cancelEmailChange(userId: string): Promise<void> {
    await this.prisma.emailChangeRequest.updateMany({
      where: { userId, usedAt: null, canceledAt: null },
      data: { canceledAt: new Date() },
    });
    await this.audit.record({
      actorUserId: userId,
      action: 'account.email_change_canceled',
      entityType: 'User',
      entityId: userId,
    });
  }

  /**
   * Confirma a troca. Aqui o endereço muda de verdade.
   *
   * Público: o link é aberto na caixa de entrada, muitas vezes no celular, onde
   * não existe sessão. Quem segura o token é a prova.
   */
  async confirmEmailChange(token: string): Promise<{ email: string }> {
    const request = await this.prisma.emailChangeRequest.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });

    if (
      !request ||
      request.usedAt ||
      request.canceledAt ||
      request.expiresAt.getTime() <= Date.now() ||
      request.user.deletedAt
    ) {
      throw new DmFlowError('EMAIL_CHANGE_TOKEN_INVALID');
    }

    // Alguém pode ter cadastrado esse endereço entre o pedido e a confirmação.
    // Sem esta checagem, a transação estouraria na restrição de unicidade e o
    // usuário receberia um erro interno em vez de uma explicação.
    const taken = await this.prisma.user.findUnique({ where: { email: request.newEmail } });
    if (taken && taken.id !== request.userId) throw new DmFlowError('EMAIL_ALREADY_REGISTERED');

    const previousEmail = request.user.email;

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: request.userId },
        // Confirmado neste instante: quem clicou provou ter a caixa. Exigir uma
        // segunda confirmação do mesmo endereço não provaria nada de novo.
        data: { email: request.newEmail, emailVerifiedAt: new Date() },
      }),
      this.prisma.emailChangeRequest.update({
        where: { id: request.id },
        data: { usedAt: new Date() },
      }),
      // Tokens de verificação emitidos para o endereço antigo perdem o sentido.
      this.prisma.emailVerificationToken.updateMany({
        where: { userId: request.userId, usedAt: null },
        data: { usedAt: new Date() },
      }),
      // E qualquer redefinição de senha em aberto: ela foi pedida por alguém
      // que provou ter a caixa antiga, que já não é a caixa desta conta.
      this.prisma.passwordResetToken.updateMany({
        where: { userId: request.userId, usedAt: null },
        data: { usedAt: new Date() },
      }),
    ]);

    // Trocar o endereço é trocar a identidade de acesso. Todo aparelho conectado
    // volta a passar pela porta.
    await this.sessions.revokeAllForUser(request.userId);

    await this.audit.record({
      actorUserId: request.userId,
      action: 'account.email_changed',
      entityType: 'User',
      entityId: request.userId,
      before: { email: maskEmail(previousEmail) },
      after: { email: maskEmail(request.newEmail) },
    });
    await this.events.record({ event: 'user.email_changed', userId: request.userId });

    logger.info({ userId: request.userId }, 'account email changed');
    return { email: request.newEmail };
  }

  // ── Excluir a conta ────────────────────────────────────────

  /**
   * O que aconteceria se a conta fosse excluída agora.
   *
   * Existe para ser mostrado antes de perguntar "tem certeza?". Uma confirmação
   * que não diz o que vai ser destruído não é consentimento, é um botão.
   *
   * A mesma função é chamada de novo, por dentro, na hora de excluir: o mundo
   * pode ter mudado entre a tela e o clique.
   */
  async deletionPreview(userId: string): Promise<DeletionPreview> {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId },
      include: {
        workspace: {
          include: {
            subscription: { include: { plan: true } },
            _count: { select: { members: true, contacts: true, automations: true, conversations: true } },
          },
        },
      },
    });

    const blockers: DeletionBlocker[] = [];
    const workspaces: WorkspaceOutcome[] = [];

    for (const membership of memberships) {
      const ws = membership.workspace;
      if (ws.deletedAt) continue;

      if (membership.role !== 'OWNER') {
        workspaces.push({ id: ws.id, name: ws.name, outcome: 'left' });
        continue;
      }

      const otherOwners = await this.prisma.workspaceMember.count({
        where: { workspaceId: ws.id, role: 'OWNER', userId: { not: userId } },
      });

      // Há outro dono: a área continua de pé e esta pessoa apenas sai.
      if (otherOwners > 0) {
        workspaces.push({ id: ws.id, name: ws.name, outcome: 'left' });
        continue;
      }

      const otherMembers = ws._count.members - 1;

      // Último dono de uma área com gente dentro. Apagar levaria junto o
      // trabalho de outras pessoas, que não pediram nada. Recusa.
      if (otherMembers > 0) {
        blockers.push({
          code: 'ACCOUNT_DELETE_LAST_OWNER',
          workspaceId: ws.id,
          workspaceName: ws.name,
          otherMembers,
        });
        continue;
      }

      // Sozinho lá dentro: a área é dele e vai junto. Antes, a cobrança.
      const sub = ws.subscription;
      const billable =
        sub &&
        sub.plan.priceCents > 0 &&
        (BILLABLE_STATUSES as readonly string[]).includes(sub.status);

      if (billable) {
        blockers.push({
          code: 'ACCOUNT_DELETE_ACTIVE_SUBSCRIPTION',
          workspaceId: ws.id,
          workspaceName: ws.name,
          planName: sub.plan.name,
        });
        continue;
      }

      workspaces.push({
        id: ws.id,
        name: ws.name,
        outcome: 'deleted',
        contacts: ws._count.contacts,
        automations: ws._count.automations,
        conversations: ws._count.conversations,
      });
    }

    const sessions = await this.prisma.session.count({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    });

    return { blockers, workspaces, sessions };
  }

  /**
   * Exclui de verdade, agora, sem período de arrependimento.
   *
   * A alternativa seria marcar como excluída e apagar dali a trinta dias. Não
   * fiz assim por um motivo simples: não existe ainda o processo que apagaria
   * depois. Prometer na tela um descarte que nenhum código executa é uma
   * mentira num lugar onde mentir tem consequência jurídica.
   *
   * O que sobra, e por quê:
   *
   * - **Registro de auditoria** — fica, sem o autor (`SetNull`). É a prova de
   *   quem fez o quê dentro de áreas de trabalho que continuam existindo, e
   *   apagá-la seria apagar o histórico dos outros.
   * - **Anotações em conversas** — ficam, sem autor. São do time.
   * - **Conversas atribuídas** — ficam, sem responsável.
   * - **Eventos de domínio** — ficam. São contagens agregadas, e sem elas os
   *   números do mês passado mudariam sozinhos toda vez que alguém saísse.
   *
   * Some tudo o que é da pessoa: sessões, tokens, participações, e as áreas de
   * trabalho onde ela estava sozinha — com contatos, conversas e automações.
   */
  async deleteAccount(
    userId: string,
    password: string,
    res: Response,
  ): Promise<{ deletedWorkspaces: number }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.deletedAt) throw new DmFlowError('NOT_AUTHENTICATED');

    const valid = await argon2.verify(user.passwordHash, password).catch(() => false);
    if (!valid) throw new DmFlowError('INVALID_CREDENTIALS');

    // Recalculado agora, e não confiando no que a tela mostrou: entre abrir o
    // diálogo e confirmar, alguém pode ter entrado na área de trabalho.
    const preview = await this.deletionPreview(userId);
    if (preview.blockers.length > 0) {
      const first = preview.blockers[0]!;
      throw new DmFlowError(first.code, {
        context: {
          workspaceId: first.workspaceId,
          workspaceName: first.workspaceName,
          blockers: preview.blockers.length,
        },
      });
    }

    const doomed = preview.workspaces.filter((w) => w.outcome === 'deleted');
    const left = preview.workspaces.filter((w) => w.outcome === 'left');

    // Antes de apagar, não depois: depois não existe mais endereço para onde
    // mandar, e este é o único comprovante que fica do lado de quem saiu.
    await this.mail.sendAccountDeleted({ to: user.email, locale: user.locale });

    // Nas áreas que sobrevivem, quem fica precisa entender por que a pessoa
    // sumiu da lista. Gravado antes da exclusão porque a auditoria referencia o
    // autor, e depois ele não existe mais.
    for (const ws of left) {
      await this.audit.record({
        workspaceId: ws.id,
        actorUserId: userId,
        action: 'workspace.member_left',
        entityType: 'WorkspaceMember',
        entityId: userId,
        after: { reason: 'account_deleted' },
      });
    }

    await this.prisma.$transaction(async (tx) => {
      // As áreas primeiro. Cascata leva contatos, conversas, automações,
      // execuções, chaves e assinatura de cada uma.
      for (const ws of doomed) {
        await tx.workspace.delete({ where: { id: ws.id } });
      }
      // Depois a pessoa. Cascata leva sessões, tokens e participações; SetNull
      // preserva auditoria, anotações e atribuições.
      await tx.user.delete({ where: { id: userId } });
    });

    // Sem workspaceId de propósito: as áreas apagadas já não existem, e a
    // chave estrangeira do evento recusaria um id morto.
    await this.events.record({
      event: 'user.deleted',
      userId,
      properties: { workspacesDeleted: doomed.length, workspacesLeft: left.length },
    });

    this.sessions.clearCookie(res);

    logger.info(
      { userId, workspacesDeleted: doomed.length, workspacesLeft: left.length },
      'account deleted at the request of its owner',
    );

    return { deletedWorkspaces: doomed.length };
  }
}
