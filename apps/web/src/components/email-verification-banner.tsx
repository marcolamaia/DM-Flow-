'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { MailWarning } from 'lucide-react';
import { ApiError, post } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/primitives';
import { toast } from '@/components/ui/toast';

/**
 * Shown until the address is confirmed.
 *
 * Deliberately not dismissible and not a modal. Publishing an automation is
 * blocked until this is done, so hiding it would leave people stuck at that
 * refusal with no idea why; blocking the whole screen would punish someone who
 * only wanted to look around.
 */
export function EmailVerificationBanner({ email }: { email: string }) {
  const { t } = useI18n();
  const [sent, setSent] = React.useState(false);

  const resend = useMutation({
    mutationFn: () => post<{ ok: true; token?: string }>('/auth/email/verify/resend'),
    onSuccess: () => {
      setSent(true);
      toast.success(t('verifyEmail.resent'));
    },
    onError: (error) => {
      if (error instanceof ApiError) toast.error(error.payload.userMessage);
    },
  });

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-warning/30 bg-warning/10 px-4 py-2.5">
      <MailWarning className="size-4 shrink-0 text-warning" />
      <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-warning">
        <span className="font-semibold">{t('verifyEmail.bannerTitle')}</span>{' '}
        <span className="text-warning/85">{t('verifyEmail.bannerHint')}</span>{' '}
        <span className="font-medium text-warning">{email}</span>
      </p>
      <Button
        variant="secondary"
        size="sm"
        loading={resend.isPending}
        disabled={sent}
        onClick={() => resend.mutate()}
      >
        {sent ? t('verifyEmail.resent') : t('verifyEmail.resend')}
      </Button>
    </div>
  );
}
