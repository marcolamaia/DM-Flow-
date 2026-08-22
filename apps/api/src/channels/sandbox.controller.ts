import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../common/decorators/permissions.decorator';
import { loadEnv } from '../config/env';

/**
 * Stands in for the platform's consent screen so the OAuth handshake is a real
 * round trip in development rather than a shortcut that hides state handling bugs.
 */
@Public()
@Controller('sandbox/instagram')
export class SandboxController {
  @Get('authorize')
  authorize(
    @Query('state') state: string,
    @Query('redirect_uri') redirectUri: string,
    @Query('handle') handle: string | undefined,
    @Res() res: Response,
  ) {
    const env = loadEnv();
    if (env.INSTAGRAM_PROVIDER !== 'mock') {
      res.status(404).json({ error: 'sandbox disabled' });
      return;
    }

    if (handle) {
      const url = new URL(redirectUri);
      url.searchParams.set('code', `handle:${handle}`);
      url.searchParams.set('state', state);
      res.redirect(url.toString());
      return;
    }

    // A minimal consent page: pick the handle to connect, then continue.
    res.type('html').send(`<!doctype html>
<meta charset="utf-8">
<title>Sandbox · Conectar Instagram</title>
<style>
 body{font:15px/1.5 system-ui,sans-serif;background:#0b0d12;color:#e6e9ef;display:grid;place-items:center;height:100vh;margin:0}
 .card{background:#151922;border:1px solid #232936;border-radius:14px;padding:28px;max-width:380px;width:100%}
 h1{font-size:17px;margin:0 0 6px} p{color:#98a2b3;margin:0 0 18px;font-size:13px}
 label{display:block;font-size:12px;color:#98a2b3;margin-bottom:6px}
 input{width:100%;padding:10px 12px;border-radius:9px;border:1px solid #2a3140;background:#0f131a;color:#e6e9ef;box-sizing:border-box}
 button{margin-top:14px;width:100%;padding:11px;border:0;border-radius:9px;background:#6366f1;color:#fff;font-weight:600;cursor:pointer}
 .note{margin-top:14px;font-size:11px;color:#6b7484;line-height:1.5}
</style>
<div class="card">
  <h1>Ambiente de simulação</h1>
  <p>Esta tela substitui o consentimento da plataforma. Nenhuma conta real é acessada.</p>
  <form method="get">
    <input type="hidden" name="state" value="${escapeHtml(state)}">
    <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}">
    <label for="handle">@ da conta simulada</label>
    <input id="handle" name="handle" value="minha_loja" autofocus>
    <button type="submit">Conectar conta simulada</button>
  </form>
  <p class="note">Contas simuladas usam o provider interno da DM FLOW. As capacidades ficam marcadas como <strong>SANDBOX_SIMULATED</strong> — isso descreve o nosso simulador, não o que a plataforma real permite.</p>
</div>`);
  }
}

function escapeHtml(value: string): string {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
