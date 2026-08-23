'use client';

import * as React from 'react';
import { useI18n } from '@/lib/i18n';
import { Button, Textarea } from '@/components/ui/primitives';

const MIN_REASON = 8;

/**
 * Asks why, before doing something that changes money, access or an account.
 *
 * The server refuses these actions without a reason, so the interface asks for
 * one up front rather than letting somebody press a button and receive a
 * validation error. The check here is a courtesy; the server's is the rule.
 */
export function ReasonDialog({
  title,
  explanation,
  confirmLabel,
  tone = 'danger',
  pending,
  error,
  onConfirm,
  onCancel,
  children,
}: {
  title: string;
  explanation: string;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  pending?: boolean;
  error?: string | null;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  children?: React.ReactNode;
}) {
  const { t } = useI18n();
  const [reason, setReason] = React.useState('');
  const tooShort = reason.trim().length < MIN_REASON;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-lg">
        <h2 className="text-sm font-semibold text-fg">{title}</h2>
        <p className="mt-1 text-sm text-muted">{explanation}</p>

        {children ? <div className="mt-4">{children}</div> : null}

        <label className="mt-4 block text-xs font-medium text-fg" htmlFor="admin-reason">
          {t('admin.reason.label')}
        </label>
        <Textarea
          id="admin-reason"
          rows={3}
          className="mt-1"
          placeholder={t('admin.reason.placeholder')}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          autoFocus
        />
        {tooShort && reason.length > 0 ? (
          <p className="mt-1 text-xs text-danger">{t('admin.reason.required')}</p>
        ) : null}

        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            disabled={tooShort}
            loading={pending}
            onClick={() => onConfirm(reason.trim())}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
