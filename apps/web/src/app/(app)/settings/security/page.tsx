'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { ApiError, get, post } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { PageHeader } from '@/components/page-header';
import {
  Badge,
  Banner,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Field,
  Input,
} from '@/components/ui/primitives';
import { EmailCard } from '@/components/settings/email-card';
import { DeleteAccountCard } from '@/components/settings/delete-account-card';
import type { Me } from '@/lib/types';

/**
 * The security a customer can actually turn on.
 *
 * Both routes here existed and no screen called them: the login form accepted a
 * second-factor code that nobody could ever enable, and the change-password
 * endpoint had no way in.
 */
export default function SecurityPage() {
  const { t } = useI18n();
  const router = useRouter();

  const me = useQuery({ queryKey: ['me'], queryFn: () => get<Me>('/auth/me') });

  const errorOf = (error: unknown) =>
    error instanceof ApiError ? error.payload.userMessage : t('common.error');

  return (
    <>
      <PageHeader title={t('security.title')} subtitle={t('security.subtitle')} />

      <div className="max-w-2xl space-y-5 px-7 py-5">
        {me.data ? <EmailCard currentEmail={me.data.user.email} errorOf={errorOf} /> : null}
        <PasswordCard errorOf={errorOf} onChanged={() => router.replace('/login')} />
        <TotpCard enabled={me.data?.user.totpEnabled ?? false} errorOf={errorOf} />
        {/* Por último e separado: é a única ação desta tela que não tem desfazer. */}
        {me.data ? <DeleteAccountCard currentEmail={me.data.user.email} errorOf={errorOf} /> : null}
      </div>
    </>
  );
}

// ── Password ─────────────────────────────────────────────────

function PasswordCard({
  errorOf,
  onChanged,
}: {
  errorOf: (error: unknown) => string;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [current, setCurrent] = React.useState('');
  const [next, setNext] = React.useState('');
  const [confirmation, setConfirmation] = React.useState('');
  const [done, setDone] = React.useState(false);

  const mismatch = confirmation.length > 0 && next !== confirmation;

  const change = useMutation({
    mutationFn: () => post('/auth/password/change', { currentPassword: current, newPassword: next }),
    onSuccess: () => {
      setDone(true);
      // The server ended every session, this one included. Staying on a screen
      // that no longer has a session would just fail the next request.
      setTimeout(onChanged, 2500);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4" />
          {t('security.password.title')}
        </CardTitle>
      </CardHeader>
      <CardBody>
        {done ? (
          <Banner tone="success" title={t('security.password.done')} />
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!mismatch) change.mutate();
            }}
          >
            {/* Said before they press it, not after they are logged out. */}
            <p className="mb-4 text-[13px] text-muted">{t('security.password.warning')}</p>

            <Field label={t('security.password.current')}>
              <Input
                type="password"
                autoComplete="current-password"
                required
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
              />
            </Field>

            <Field label={t('security.password.new')} hint={t('auth.passwordHint')}>
              <Input
                type="password"
                autoComplete="new-password"
                required
                value={next}
                onChange={(event) => setNext(event.target.value)}
              />
            </Field>

            <Field
              label={t('security.password.confirm')}
              error={mismatch ? t('security.password.mismatch') : undefined}
            >
              <Input
                type="password"
                autoComplete="new-password"
                required
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </Field>

            {change.isError ? (
              <p className="mb-3 text-[13px] text-danger">{errorOf(change.error)}</p>
            ) : null}

            <Button
              type="submit"
              loading={change.isPending}
              disabled={mismatch || !current || !next || !confirmation}
            >
              {t('security.password.submit')}
            </Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

// ── Second factor ────────────────────────────────────────────

function TotpCard({
  enabled,
  errorOf,
}: {
  enabled: boolean;
  errorOf: (error: unknown) => string;
}) {
  const { t } = useI18n();
  const [enrolling, setEnrolling] = React.useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = React.useState('');
  const [disabling, setDisabling] = React.useState(false);
  const [password, setPassword] = React.useState('');
  const [notice, setNotice] = React.useState<string | null>(null);
  const [isOn, setIsOn] = React.useState(enabled);

  React.useEffect(() => setIsOn(enabled), [enabled]);

  const start = useMutation({
    mutationFn: () => post<{ secret: string; otpauthUrl: string }>('/auth/totp/start'),
    onSuccess: async (result) => {
      // Drawn in the browser from the URI the server returned. The secret never
      // travels through an image service to become one.
      const qr = await QRCode.toDataURL(result.otpauthUrl, { margin: 1, width: 200 });
      setEnrolling({ secret: result.secret, qr });
      setNotice(null);
    },
  });

  const confirm = useMutation({
    mutationFn: () => post('/auth/totp/confirm', { code: code.trim() }),
    onSuccess: () => {
      setEnrolling(null);
      setCode('');
      setIsOn(true);
      setNotice(t('security.totp.enabled'));
    },
  });

  const disable = useMutation({
    mutationFn: () => post('/auth/totp/disable', { password }),
    onSuccess: () => {
      setDisabling(false);
      setPassword('');
      setIsOn(false);
      setNotice(t('security.totp.disabled'));
    },
  });

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-4" />
          {t('security.totp.title')}
        </CardTitle>
        <Badge tone={isOn ? 'success' : 'neutral'}>
          {isOn ? t('security.totp.on') : t('security.totp.off')}
        </Badge>
      </CardHeader>

      <CardBody className="space-y-4">
        <p className="text-[13px] text-muted">{t('security.totp.explain')}</p>

        {notice ? <Banner tone="success" title={notice} /> : null}

        {/* ── Turning it on ── */}
        {!isOn && !enrolling ? (
          <>
            {start.isError ? (
              <p className="text-[13px] text-danger">{errorOf(start.error)}</p>
            ) : null}
            <Button loading={start.isPending} onClick={() => start.mutate()}>
              {t('security.totp.enable')}
            </Button>
          </>
        ) : null}

        {enrolling ? (
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-[13px] text-fg">{t('security.totp.step1')}</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={enrolling.qr}
                alt=""
                width={200}
                height={200}
                className="rounded-lg border border-border bg-white p-2"
              />
            </div>

            <div>
              <p className="text-[13px] text-muted">{t('security.totp.manual')}</p>
              <code className="mt-1 block break-all rounded-lg border border-border bg-elevated px-3 py-2 font-mono text-[13px]">
                {enrolling.secret}
              </code>
              {/* The one thing people find out too late. */}
              <p className="mt-2 text-[12px] text-warning">{t('security.totp.lostAccess')}</p>
            </div>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                confirm.mutate();
              }}
            >
              <p className="mb-2 text-[13px] text-fg">{t('security.totp.step2')}</p>
              <Field label={t('security.totp.code')}>
                <Input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={10}
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  className="max-w-40 font-mono tracking-widest"
                  autoFocus
                />
              </Field>

              {confirm.isError ? (
                <p className="mb-3 text-[13px] text-danger">{errorOf(confirm.error)}</p>
              ) : null}

              <div className="flex gap-2">
                <Button type="submit" loading={confirm.isPending} disabled={code.trim().length < 6}>
                  {t('security.totp.confirm')}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEnrolling(null);
                    setCode('');
                  }}
                >
                  {t('common.cancel')}
                </Button>
              </div>
            </form>
          </div>
        ) : null}

        {/* ── Turning it off ── */}
        {isOn && !disabling ? (
          <Button variant="secondary" onClick={() => setDisabling(true)}>
            {t('security.totp.disable')}
          </Button>
        ) : null}

        {disabling ? (
          <form
            className="space-y-3 rounded-lg border border-border p-4"
            onSubmit={(event) => {
              event.preventDefault();
              disable.mutate();
            }}
          >
            <p className="text-[13px] font-medium text-fg">{t('security.totp.disable.title')}</p>
            <p className="text-[13px] text-muted">{t('security.totp.disable.explain')}</p>

            <Field label={t('security.totp.password')}>
              <Input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>

            {disable.isError ? (
              <p className="text-[13px] text-danger">{errorOf(disable.error)}</p>
            ) : null}

            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setDisabling(false);
                  setPassword('');
                }}
              >
                {t('common.cancel')}
              </Button>
              <Button
                type="submit"
                variant="danger"
                loading={disable.isPending}
                disabled={!password}
              >
                {t('security.totp.disable.confirm')}
              </Button>
            </div>
          </form>
        ) : null}
      </CardBody>
    </Card>
  );
}
