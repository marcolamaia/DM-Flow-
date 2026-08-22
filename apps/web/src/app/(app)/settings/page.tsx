'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, patch } from '@/lib/api';
import { useI18n, type Locale } from '@/lib/i18n';
import { useApp, type Theme } from '@/components/providers/app-providers';
import { PageHeader } from '@/components/page-header';
import { Button, Card, CardBody, CardHeader, CardTitle, Field, Input, Select } from '@/components/ui/primitives';
import { toast } from '@/components/ui/toast';

interface WorkspaceDetail {
  id: string;
  name: string;
  timezone: string;
  locale: string;
  status: string;
}

const TIMEZONES = [
  'America/Sao_Paulo',
  'America/Manaus',
  'America/Fortaleza',
  'America/New_York',
  'Europe/Lisbon',
  'Europe/London',
  'UTC',
];

export default function SettingsPage() {
  const { t } = useI18n();
  const { workspaceId, locale, setLocaleState, theme, setTheme } = useApp();
  const queryClient = useQueryClient();

  const workspace = useQuery({
    queryKey: ['workspace-current', workspaceId],
    queryFn: () => get<WorkspaceDetail>('/workspaces/current'),
    enabled: Boolean(workspaceId),
  });

  const [name, setName] = React.useState('');
  const [timezone, setTimezone] = React.useState('America/Sao_Paulo');

  React.useEffect(() => {
    if (workspace.data) {
      setName(workspace.data.name);
      setTimezone(workspace.data.timezone);
    }
  }, [workspace.data]);

  const save = useMutation({
    mutationFn: () => patch('/workspaces/current', { name, timezone }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-current'] });
      queryClient.invalidateQueries({ queryKey: ['me'] });
      toast.success(t('common.save'));
    },
  });

  return (
    <>
      <PageHeader title={t('settings.title')} />

      <div className="max-w-2xl space-y-5 px-7 py-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('settings.workspace')}</CardTitle>
          </CardHeader>
          <CardBody>
            <Field label={t('auth.workspaceName')}>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field
              label={t('settings.timezone')}
              hint="Usado pelos blocos de espera com janela de horário."
            >
              <Select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </Select>
            </Field>
            <Button loading={save.isPending} onClick={() => save.mutate()}>
              {t('common.save')}
            </Button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('settings.language')}</CardTitle>
          </CardHeader>
          <CardBody>
            <Field label={t('settings.language')}>
              <Select value={locale} onChange={(e) => setLocaleState(e.target.value as Locale)}>
                <option value="pt-BR">Português (Brasil)</option>
                <option value="en">English</option>
              </Select>
            </Field>
            <Field label={t('settings.theme')}>
              <Select value={theme} onChange={(e) => setTheme(e.target.value as Theme)}>
                <option value="system">{t('settings.theme.system')}</option>
                <option value="light">{t('settings.theme.light')}</option>
                <option value="dark">{t('settings.theme.dark')}</option>
              </Select>
            </Field>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
