'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { ApiError, del, get, post } from '@/lib/api';
import { useI18n, type MessageKey } from '@/lib/i18n';
import { useApp } from '@/components/providers/app-providers';
import { PageHeader } from '@/components/page-header';
import { Avatar, Badge, Button, Card, CardBody, CardHeader, CardTitle, Field, Input, Select, Skeleton } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { relativeTime } from '@/lib/utils';

interface Member {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: 'OWNER' | 'ADMIN' | 'EDITOR' | 'AGENT' | 'VIEWER';
  joinedAt: string;
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  expired: boolean;
}

export default function TeamPage() {
  const { t, locale } = useI18n();
  const { workspaceId } = useApp();
  const queryClient = useQueryClient();

  const [inviting, setInviting] = React.useState(false);
  const [email, setEmail] = React.useState('');
  const [role, setRole] = React.useState('AGENT');
  const [issuedToken, setIssuedToken] = React.useState<string | null>(null);

  const members = useQuery({
    queryKey: ['members', workspaceId],
    queryFn: () => get<Member[]>('/workspaces/current/members'),
    enabled: Boolean(workspaceId),
  });

  const invitations = useQuery({
    queryKey: ['invitations', workspaceId],
    queryFn: () => get<Invitation[]>('/workspaces/current/invitations'),
    enabled: Boolean(workspaceId),
  });

  const invite = useMutation({
    mutationFn: () => post<{ token: string }>('/workspaces/current/invitations', { email, role }),
    onSuccess: (result) => {
      setIssuedToken(result.token);
      setEmail('');
      queryClient.invalidateQueries({ queryKey: ['invitations'] });
    },
    onError: (error) => {
      if (error instanceof ApiError) toast.error(error.payload.userMessage);
    },
  });

  const revoke = useMutation({
    mutationFn: (id: string) => del(`/workspaces/current/invitations/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invitations'] }),
  });

  const removeMember = useMutation({
    mutationFn: (id: string) => del(`/workspaces/current/members/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members'] });
      queryClient.invalidateQueries({ queryKey: ['usage'] });
    },
    onError: (error) => {
      if (error instanceof ApiError) toast.error(error.payload.userMessage);
    },
  });

  return (
    <>
      <PageHeader
        title={t('team.title')}
        subtitle={t('team.subtitle')}
        actions={
          <Button size="sm" onClick={() => setInviting(true)}>
            <UserPlus />
            {t('team.invite')}
          </Button>
        }
      />

      <div className="space-y-5 px-7 py-6">
        <Card>
          {members.isLoading ? (
            <CardBody>
              <Skeleton className="h-8" />
            </CardBody>
          ) : (
            <div className="divide-y divide-border">
              {members.data?.map((member) => (
                <div key={member.id} className="flex items-center justify-between px-5 py-3">
                  <div className="flex items-center gap-3">
                    <Avatar name={member.name} size={32} />
                    <div>
                      <p className="text-[13.5px] font-medium">{member.name}</p>
                      <p className="text-[12px] text-subtle">{member.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge tone={member.role === 'OWNER' ? 'accent' : 'neutral'}>
                      {t(`team.role.${member.role}` as MessageKey)}
                    </Badge>
                    <span className="text-[11.5px] text-subtle">
                      {relativeTime(member.joinedAt, locale)}
                    </span>
                    {member.role !== 'OWNER' ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeMember.mutate(member.id)}
                        loading={removeMember.isPending}
                      >
                        {t('team.remove')}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        {invitations.data && invitations.data.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('team.invitations')}</CardTitle>
            </CardHeader>
            <div className="divide-y divide-border">
              {invitations.data.map((invitation) => (
                <div key={invitation.id} className="flex items-center justify-between px-5 py-3">
                  <div>
                    <p className="text-[13px]">{invitation.email}</p>
                    <p className="text-[11.5px] text-subtle">
                      {t(`team.role.${invitation.role}` as MessageKey)} ·{' '}
                      {relativeTime(invitation.expiresAt, locale)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {invitation.expired ? <Badge tone="danger">expirado</Badge> : null}
                    <Button variant="ghost" size="sm" onClick={() => revoke.mutate(invitation.id)}>
                      {t('common.delete')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ) : null}
      </div>

      <Dialog
        open={inviting}
        onOpenChange={(open) => {
          setInviting(open);
          if (!open) setIssuedToken(null);
        }}
      >
        <DialogContent title={t('team.invite')}>
          {issuedToken ? (
            <div>
              <p className="mb-2 text-[13px] text-muted">{t('team.inviteLink')}</p>
              <code className="block break-all rounded-lg border border-border bg-bg px-3 py-2 font-mono text-[11.5px]">
                {`${window.location.origin}/invite/${issuedToken}`}
              </code>
              <DialogFooter>
                <Button
                  onClick={() => {
                    navigator.clipboard?.writeText(`${window.location.origin}/invite/${issuedToken}`);
                    toast.success('copiado');
                  }}
                >
                  Copiar
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <>
              <Field label={t('auth.email')}>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoFocus />
              </Field>
              <Field label={t('team.role')}>
                <Select value={role} onChange={(e) => setRole(e.target.value)}>
                  {(['ADMIN', 'EDITOR', 'AGENT', 'VIEWER'] as const).map((r) => (
                    <option key={r} value={r}>
                      {t(`team.role.${r}` as MessageKey)}
                    </option>
                  ))}
                </Select>
              </Field>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setInviting(false)}>
                  {t('common.cancel')}
                </Button>
                <Button disabled={!email.trim()} loading={invite.isPending} onClick={() => invite.mutate()}>
                  {t('team.invite')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
