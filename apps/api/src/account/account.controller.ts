import { Body, Controller, Delete, Get, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { AccountService } from './account.service';
import { zodBody } from '../common/zod.pipe';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { NoWorkspace, Public } from '../common/decorators/permissions.decorator';
import { CREDENTIAL_LIMIT, RateLimit } from '../common/decorators/rate-limit.decorator';
import type { AuthenticatedUser } from '../common/request-context';

/**
 * Trocar o e-mail e encerrar a conta.
 *
 * Tudo aqui é `NoWorkspace`: são decisões sobre a pessoa, não sobre uma área de
 * trabalho. Alguém que participa de cinco áreas não troca o próprio e-mail cinco
 * vezes, e continua tendo direito de sair mesmo com a área suspensa por falta de
 * pagamento.
 *
 * E tudo aqui usa o orçamento de credencial no limitador: são rotas que aceitam
 * senha, e portanto rotas onde alguém tentaria adivinhar uma.
 */
@Controller('account')
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @NoWorkspace()
  @RateLimit(CREDENTIAL_LIMIT)
  @Post('email')
  async requestEmailChange(
    @CurrentUser() user: AuthenticatedUser,
    @Body(
      zodBody(
        z.object({
          newEmail: z.string().email().max(200),
          password: z.string().min(1).max(200),
        }),
      ),
    )
    body: { newEmail: string; password: string },
  ) {
    return this.account.requestEmailChange(user.id, body.newEmail, body.password);
  }

  @NoWorkspace()
  @Get('email/pending')
  async pending(@CurrentUser() user: AuthenticatedUser) {
    return { pending: await this.account.pendingEmailChange(user.id) };
  }

  @NoWorkspace()
  @Post('email/cancel')
  async cancelEmailChange(@CurrentUser() user: AuthenticatedUser) {
    await this.account.cancelEmailChange(user.id);
    return { ok: true };
  }

  /**
   * Público pelo mesmo motivo da confirmação de cadastro: o link é aberto na
   * caixa de entrada do endereço novo, quase sempre no celular, onde não há
   * sessão. Ter o token é a prova.
   */
  @Public()
  @RateLimit(CREDENTIAL_LIMIT)
  @Post('email/confirm')
  async confirmEmailChange(
    @Body(zodBody(z.object({ token: z.string().min(10).max(200) }))) body: { token: string },
  ) {
    return this.account.confirmEmailChange(body.token);
  }

  /**
   * O que a exclusão faria. Só lê.
   *
   * A tela chama isto antes de mostrar o botão vermelho, porque perguntar "tem
   * certeza?" sem dizer o que se perde não é consentimento informado.
   */
  @NoWorkspace()
  @Get('deletion-preview')
  async deletionPreview(@CurrentUser() user: AuthenticatedUser) {
    return this.account.deletionPreview(user.id);
  }

  @NoWorkspace()
  @RateLimit(CREDENTIAL_LIMIT)
  @Delete()
  async deleteAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(z.object({ password: z.string().min(1).max(200) })))
    body: { password: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.account.deleteAccount(user.id, body.password, res);
  }
}
