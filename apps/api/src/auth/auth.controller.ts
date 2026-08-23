import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import { zodBody } from '../common/zod.pipe';
import { ClientInfo, CurrentUser } from '../common/decorators/current-user.decorator';
import { NoWorkspace, Public } from '../common/decorators/permissions.decorator';
import { CREDENTIAL_LIMIT, RateLimit } from '../common/decorators/rate-limit.decorator';
import type { AuthenticatedUser, DmFlowRequest } from '../common/request-context';

const passwordSchema = z
  .string()
  .min(10, 'A senha precisa de pelo menos 10 caracteres')
  .max(200)
  .refine((v) => /[a-zA-Z]/.test(v) && /[0-9]/.test(v), {
    message: 'A senha precisa conter letras e números',
  });

const registerSchema = z.object({
  email: z.string().email().max(200),
  password: passwordSchema,
  name: z.string().min(2).max(120),
  // An untouched optional text field arrives as an empty string, not as absent.
  // Treating that as "not provided" is the difference between a field labelled
  // optional and one that rejects the signup when it is left alone.
  workspaceName: z
    .string()
    .max(120)
    .optional()
    .transform((value) => value?.trim() || undefined)
    .refine((value) => value === undefined || value.length >= 2, {
      message: 'must be at least 2 characters when provided',
    }),
  locale: z.string().max(10).optional(),
});

const loginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
  totp: z.string().min(6).max(10).optional(),
});

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @RateLimit(CREDENTIAL_LIMIT)
  @Post('register')
  async register(
    @Body(zodBody(registerSchema)) body: z.infer<typeof registerSchema>,
    @ClientInfo() info: { ip: string; userAgent: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.register(body, info, res);
  }

  @Public()
  @RateLimit(CREDENTIAL_LIMIT)
  @Post('login')
  async login(
    @Body(zodBody(loginSchema)) body: z.infer<typeof loginSchema>,
    @ClientInfo() info: { ip: string; userAgent: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.login(body, info, res);
  }

  @NoWorkspace()
  @Post('logout')
  async logout(@Req() req: DmFlowRequest, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.sessionId, res);
    return { ok: true };
  }

  @NoWorkspace()
  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser) {
    const [record, memberships] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: user.id } }),
      this.prisma.workspaceMember.findMany({
        where: { userId: user.id },
        include: {
          workspace: {
            include: { subscription: { include: { plan: true } } },
          },
        },
        orderBy: { joinedAt: 'asc' },
      }),
    ]);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        locale: record?.locale ?? user.locale,
        avatarUrl: record?.avatarUrl ?? null,
        totpEnabled: Boolean(record?.totpEnabledAt),
        emailVerified: Boolean(record?.emailVerifiedAt),
      },
      workspaces: memberships
        .filter((m) => !m.workspace.deletedAt)
        .map((m) => ({
          id: m.workspace.id,
          name: m.workspace.name,
          slug: m.workspace.slug,
          role: m.role,
          status: m.workspace.status,
          suspensionReason: m.workspace.suspensionReason,
          plan: m.workspace.subscription?.plan.code ?? 'free',
        })),
    };
  }

  @Public()
  @RateLimit(CREDENTIAL_LIMIT)
  @Post('password/forgot')
  async forgot(@Body(zodBody(z.object({ email: z.string().email().max(200) }))) body: { email: string }) {
    const result = await this.auth.requestPasswordReset(body.email);
    // The response is identical whether or not the address exists.
    return { ok: true, ...result };
  }

  @Public()
  @RateLimit(CREDENTIAL_LIMIT)
  @Post('password/reset')
  async reset(
    @Body(zodBody(z.object({ token: z.string().min(10).max(200), password: passwordSchema })))
    body: { token: string; password: string },
  ) {
    await this.auth.resetPassword(body.token, body.password);
    return { ok: true };
  }

  /**
   * Public because the person clicking the link in their inbox may not be signed
   * in on that device — which is the common case when the link is opened on a
   * phone. Holding the token is the proof; a session is not required.
   */
  @Public()
  @RateLimit(CREDENTIAL_LIMIT)
  @Post('email/verify')
  async verifyEmail(
    @Body(zodBody(z.object({ token: z.string().min(10).max(200) }))) body: { token: string },
  ) {
    return this.auth.verifyEmail(body.token);
  }

  @NoWorkspace()
  @RateLimit(CREDENTIAL_LIMIT)
  @Post('email/verify/resend')
  async resendVerification(@CurrentUser() user: AuthenticatedUser) {
    // Always reports success, including for an already-verified account: the
    // response must not become a way to probe an account's state.
    const result = await this.auth.resendEmailVerification(user.id);
    return { ok: true, ...result };
  }

  @NoWorkspace()
  @RateLimit(CREDENTIAL_LIMIT)
  @Post('password/change')
  async change(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema })))
    body: { currentPassword: string; newPassword: string },
  ) {
    await this.auth.changePassword(user.id, body.currentPassword, body.newPassword);
    return { ok: true };
  }

  @NoWorkspace()
  @Post('totp/start')
  async totpStart(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.startTotpEnrollment(user.id, user.email);
  }

  @NoWorkspace()
  @RateLimit(CREDENTIAL_LIMIT)
  @Post('totp/confirm')
  async totpConfirm(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(z.object({ code: z.string().min(6).max(10) }))) body: { code: string },
  ) {
    await this.auth.confirmTotp(user.id, body.code);
    return { ok: true };
  }

  @NoWorkspace()
  @RateLimit(CREDENTIAL_LIMIT)
  @Post('totp/disable')
  async totpDisable(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(z.object({ password: z.string().min(1) }))) body: { password: string },
  ) {
    await this.auth.disableTotp(user.id, body.password);
    return { ok: true };
  }
}
