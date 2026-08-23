'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  Inbox,
  LayoutDashboard,
  LogOut,
  Moon,
  Plug,
  Settings,
  Sun,
  Users,
  Workflow,
  CreditCard,
  Monitor,
  ShieldCheck,
  Lock,
  Blocks,
} from 'lucide-react';
import { get, post, setWorkspaceId } from '@/lib/api';
import { useI18n, type MessageKey } from '@/lib/i18n';
import { useApp } from '@/components/providers/app-providers';
import { Avatar, Badge, Button, Spinner } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { EmailVerificationBanner } from '@/components/email-verification-banner';
import type { Me } from '@/lib/types';

const NAV: Array<{ href: string; label: MessageKey; icon: React.ComponentType<{ className?: string }> }> = [
  { href: '/dashboard', label: 'nav.dashboard', icon: LayoutDashboard },
  { href: '/inbox', label: 'nav.inbox', icon: Inbox },
  { href: '/contacts', label: 'nav.contacts', icon: Users },
  { href: '/automations', label: 'nav.automations', icon: Workflow },
  { href: '/analytics', label: 'nav.analytics', icon: BarChart3 },
];

const SETTINGS_NAV: Array<{ href: string; label: MessageKey; icon: React.ComponentType<{ className?: string }> }> = [
  { href: '/settings/channels', label: 'nav.channels', icon: Plug },
  { href: '/settings/team', label: 'nav.team', icon: Users },
  { href: '/settings/billing', label: 'nav.billing', icon: CreditCard },
  { href: '/settings/security', label: 'security.title', icon: Lock },
  { href: '/settings/integrations', label: 'dev.title', icon: Blocks },
  { href: '/settings', label: 'nav.settings', icon: Settings },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const { theme, setTheme, workspaceId, selectWorkspace } = useApp();
  const router = useRouter();
  const pathname = usePathname();

  const me = useQuery({ queryKey: ['me'], queryFn: () => get<Me>('/auth/me'), retry: false });

  // Asked quietly, and a refusal is the normal answer for almost everybody. The
  // API returns 404 rather than 403 to a customer, so a failure here says
  // nothing about whether the area exists — it just means no link.
  const admin = useQuery({
    queryKey: ['admin', 'me'],
    queryFn: () => get<{ role: string }>('/admin/me'),
    retry: false,
    enabled: !me.isError,
  });

  React.useEffect(() => {
    if (me.isError) router.replace('/login');
  }, [me.isError, router]);

  React.useEffect(() => {
    const first = me.data?.workspaces[0];
    if (!first) return;
    const known = me.data?.workspaces.some((w) => w.id === workspaceId);
    if (!workspaceId || !known) {
      setWorkspaceId(first.id);
      selectWorkspace(first.id);
    }
  }, [me.data, workspaceId, selectWorkspace]);

  if (me.isLoading || !me.data) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner className="size-6 text-muted" />
      </div>
    );
  }

  const workspace = me.data.workspaces.find((w) => w.id === workspaceId) ?? me.data.workspaces[0];

  async function logout() {
    await post('/auth/logout').catch(() => undefined);
    setWorkspaceId(null);
    router.replace('/login');
  }

  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex w-[232px] shrink-0 flex-col border-r border-border bg-surface">
        <div className="px-4 py-4">
          <Link href="/dashboard" className="text-[15px] font-semibold tracking-tight">
            DM <span className="text-accent">FLOW</span>
          </Link>
        </div>

        {me.data.workspaces.length > 0 ? (
          <div className="px-3 pb-3">
            <select
              value={workspace?.id ?? ''}
              onChange={(e) => {
                setWorkspaceId(e.target.value);
                selectWorkspace(e.target.value);
              }}
              className="w-full cursor-pointer rounded-lg border border-border bg-bg px-2.5 py-1.5 text-[13px] text-fg"
              aria-label="Workspace"
            >
              {me.data.workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <nav className="flex-1 overflow-y-auto px-2">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors',
                  active ? 'bg-elevated text-fg' : 'text-muted hover:bg-elevated/60 hover:text-fg',
                )}
                aria-current={active ? 'page' : undefined}
              >
                <Icon className="size-[17px]" />
                {t(item.label)}
              </Link>
            );
          })}

          <p className="mb-1 mt-5 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-subtle">
            {t('nav.settings')}
          </p>
          {SETTINGS_NAV.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors',
                  active ? 'bg-elevated text-fg' : 'text-muted hover:bg-elevated/60 hover:text-fg',
                )}
              >
                <Icon className="size-[17px]" />
                {t(item.label)}
              </Link>
            );
          })}

          {admin.data ? (
            <Link
              href="/admin"
              className={cn(
                'mb-0.5 mt-5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors',
                pathname.startsWith('/admin')
                  ? 'bg-elevated text-fg'
                  : 'text-muted hover:bg-elevated/60 hover:text-fg',
              )}
            >
              <ShieldCheck className="size-[17px]" />
              {t('admin.title')}
            </Link>
          ) : null}
        </nav>

        <div className="border-t border-border p-3">
          {workspace?.status === 'SUSPENDED' ? (
            <Link
              href="/settings/billing"
              className="mb-2.5 block rounded-lg border border-danger/30 bg-danger/10 px-2.5 py-2"
            >
              <p className="text-[12px] font-semibold text-danger">{t('billing.suspended')}</p>
              <p className="mt-0.5 text-[11px] text-danger/80">{t('billing.suspendedHint')}</p>
            </Link>
          ) : workspace?.status === 'PAST_DUE' ? (
            <Link
              href="/settings/billing"
              className="mb-2.5 block rounded-lg border border-warning/30 bg-warning/10 px-2.5 py-2"
            >
              <p className="text-[12px] font-semibold text-warning">{t('billing.pastDue')}</p>
              <p className="mt-0.5 text-[11px] text-warning/80">{t('billing.pastDueHint')}</p>
            </Link>
          ) : null}

          <div className="flex items-center gap-2.5 px-1">
            <Avatar name={me.data.user.name} src={me.data.user.avatarUrl} size={30} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium">{me.data.user.name}</p>
              <p className="truncate text-[11px] text-subtle">
                {workspace ? t(`team.role.${workspace.role}` as MessageKey) : ''}
              </p>
            </div>
          </div>

          <div className="mt-2.5 flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light')}
              aria-label={t('settings.theme')}
              title={t('settings.theme')}
            >
              <ThemeIcon />
            </Button>
            <Button variant="ghost" size="icon" onClick={logout} aria-label={t('auth.logout')} title={t('auth.logout')}>
              <LogOut />
            </Button>
            {workspace ? (
              <Badge tone={workspace.plan === 'free' ? 'neutral' : 'accent'} className="ml-auto">
                {workspace.plan}
              </Badge>
            ) : null}
          </div>
        </div>
      </aside>

      <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {me.data.user.emailVerified ? null : (
          <EmailVerificationBanner email={me.data.user.email} />
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </main>
    </div>
  );
}
