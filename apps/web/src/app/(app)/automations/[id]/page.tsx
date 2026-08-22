'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArrowLeft, CheckCircle2, Rocket, TriangleAlert, Zap } from 'lucide-react';
import { ApiError, del, get, post, put } from '@/lib/api';
import { useI18n, type MessageKey } from '@/lib/i18n';
import { useApp } from '@/components/providers/app-providers';
import { Badge, Button, Field, Input, Select, Spinner } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { FlowNode, type FlowNodeData } from '@/components/flow/flow-node';
import { Palette } from '@/components/flow/palette';
import { Inspector } from '@/components/flow/inspector';
import { NODE_META, nodeLabel } from '@/components/flow/node-meta';
import { cn } from '@/lib/utils';
import type {
  CapabilityEntry,
  ConnectedAccount,
  CustomField,
  Tag,
  TriggerDefinitionDto,
  ValidationReport,
} from '@/lib/types';

const nodeTypes: NodeTypes = { dmflow: FlowNode };

interface AutomationDetail {
  id: string;
  name: string;
  status: string;
  graph: { schemaVersion: number; nodes: RawNode[]; edges: RawEdge[] };
  hasUnpublishedChanges: boolean;
  validationReport: ValidationReport | null;
  triggers: Array<{
    id: string;
    type: string;
    connectedAccountId: string | null;
    config: Record<string, unknown>;
    enabled: boolean;
  }>;
}

interface RawNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
  label?: string;
}

interface RawEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle: string | null;
  label?: string;
}

/** Handles a node exposes, mirroring the server's node definitions. */
const NODE_HANDLES: Record<string, string[]> = { condition: ['true', 'false'] };

function summarise(type: string, config: Record<string, unknown>, locale: string): string {
  switch (type) {
    case 'send_message': {
      const blocks = config.blocks as Array<{ text?: string }> | undefined;
      const text = blocks?.[0]?.text ?? '';
      const prefix = config.asPrivateReply ? (locale === 'en' ? 'private · ' : 'privada · ') : '';
      return text ? prefix + text.slice(0, 70) : locale === 'en' ? 'No text yet' : 'Sem texto ainda';
    }
    case 'delay': {
      const unit = String(config.unit ?? 'hours');
      const unitLabel =
        locale === 'en'
          ? unit
          : unit === 'minutes'
            ? 'min'
            : unit === 'hours'
              ? 'horas'
              : 'dias';
      return `${config.amount ?? 1} ${unitLabel}`;
    }
    case 'http_request':
      return `${config.method ?? 'POST'} ${String(config.url ?? '').slice(0, 50)}`;
    default:
      return '';
  }
}

export default function BuilderPage() {
  const params = useParams<{ id: string }>();
  const automationId = params.id;
  const router = useRouter();
  const { t, locale } = useI18n();
  const { workspaceId } = useApp();
  const queryClient = useQueryClient();

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [report, setReport] = React.useState<ValidationReport | null>(null);
  const [saveState, setSaveState] = React.useState<'idle' | 'saving' | 'saved'>('idle');
  const [triggerDialog, setTriggerDialog] = React.useState(false);
  const hydrated = React.useRef(false);

  const detail = useQuery({
    queryKey: ['automation', automationId],
    queryFn: () => get<AutomationDetail>(`/automations/${automationId}`),
    enabled: Boolean(workspaceId),
  });

  const tags = useQuery({
    queryKey: ['tags', workspaceId],
    queryFn: () => get<Tag[]>('/tags'),
    enabled: Boolean(workspaceId),
  });
  const fields = useQuery({
    queryKey: ['custom-fields', workspaceId],
    queryFn: () => get<CustomField[]>('/custom-fields'),
    enabled: Boolean(workspaceId),
  });
  const members = useQuery({
    queryKey: ['members', workspaceId],
    queryFn: () => get<Array<{ userId: string; name: string }>>('/workspaces/current/members'),
    enabled: Boolean(workspaceId),
  });
  const accounts = useQuery({
    queryKey: ['channels', workspaceId],
    queryFn: () => get<ConnectedAccount[]>('/channels'),
    enabled: Boolean(workspaceId),
  });
  const capabilities = useQuery({
    queryKey: ['capabilities', workspaceId, detail.data?.triggers[0]?.connectedAccountId],
    queryFn: () =>
      get<CapabilityEntry[]>(
        `/capabilities${
          detail.data?.triggers[0]?.connectedAccountId
            ? `?connectedAccountId=${detail.data.triggers[0].connectedAccountId}`
            : ''
        }`,
      ),
    enabled: Boolean(workspaceId),
  });
  const workspace = useQuery({
    queryKey: ['workspace-current', workspaceId],
    queryFn: () => get<{ plan: { features: string[] } | null }>('/workspaces/current'),
    enabled: Boolean(workspaceId),
  });

  // ── Hydrate the canvas once; afterwards the canvas is the source of truth.
  React.useEffect(() => {
    if (!detail.data || hydrated.current) return;
    hydrated.current = true;

    setNodes(
      detail.data.graph.nodes.map((node) => ({
        id: node.id,
        type: 'dmflow',
        position: node.position,
        data: {
          nodeType: node.type,
          label: node.label ?? nodeLabel(node.type, locale),
          summary: summarise(node.type, node.config, locale),
          handles: NODE_HANDLES[node.type],
          locale,
          config: node.config,
        } as FlowNodeData,
      })),
    );
    setEdges(
      detail.data.graph.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle ?? undefined,
        animated: true,
      })),
    );
    setReport(detail.data.validationReport);
  }, [detail.data, locale, setNodes, setEdges]);

  const toGraph = React.useCallback(
    () => ({
      schemaVersion: 1,
      nodes: nodes.map((node) => {
        const data = node.data as FlowNodeData & { config: Record<string, unknown> };
        return {
          id: node.id,
          type: data.nodeType,
          position: node.position,
          config: data.config ?? {},
          label: data.label,
        };
      }),
      edges: edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle ?? null,
      })),
    }),
    [nodes, edges],
  );

  const save = useMutation({
    mutationFn: (graph: unknown) =>
      put<{ validationReport: ValidationReport }>(`/automations/${automationId}/draft`, { graph }),
    onMutate: () => setSaveState('saving'),
    onSuccess: (result) => {
      setReport(result.validationReport);
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 1600);
    },
    onError: (error) => {
      setSaveState('idle');
      if (error instanceof ApiError) toast.error(error.payload.userMessage);
    },
  });

  // Autosave is debounced so typing does not produce a request per keystroke.
  React.useEffect(() => {
    if (!hydrated.current || nodes.length === 0) return;
    const timer = setTimeout(() => save.mutate(toGraph()), 900);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges]);

  const publish = useMutation({
    mutationFn: () => post<{ validationReport: ValidationReport }>(`/automations/${automationId}/publish`),
    onSuccess: (result) => {
      setReport(result.validationReport);
      queryClient.invalidateQueries({ queryKey: ['automation', automationId] });
      queryClient.invalidateQueries({ queryKey: ['automations'] });
      toast.success(t('automations.published'));
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        toast.error(error.payload.userMessage);
        const details = error.payload.details;
        if (Array.isArray(details)) {
          setReport({
            valid: false,
            issues: details as never,
            checkedAt: new Date().toISOString(),
          });
        }
      }
    },
  });

  // ── Surface validation on the nodes themselves.
  React.useEffect(() => {
    if (!report) return;
    setNodes((current) =>
      current.map((node) => {
        const issues = report.issues.filter((issue) => issue.nodeId === node.id);
        return {
          ...node,
          data: {
            ...node.data,
            errors: issues.filter((i) => i.severity === 'error').map((i) => i.message[locale]),
            warnings: issues.filter((i) => i.severity === 'warning').map((i) => i.message[locale]),
          },
        };
      }),
    );
  }, [report, locale, setNodes]);

  const addNode = (type: string) => {
    const id = `${type}-${Date.now().toString(36)}`;
    const last = nodes.at(-1);
    setNodes((current) => [
      ...current,
      {
        id,
        type: 'dmflow',
        position: { x: last ? last.position.x : 260, y: last ? last.position.y + 150 : 220 },
        data: {
          nodeType: type,
          label: nodeLabel(type, locale),
          summary: '',
          handles: NODE_HANDLES[type],
          locale,
          config: {},
        } as FlowNodeData,
      },
    ]);
    setSelectedId(id);
  };

  const updateSelectedConfig = (config: Record<string, unknown>) => {
    setNodes((current) =>
      current.map((node) => {
        if (node.id !== selectedId) return node;
        const data = node.data as FlowNodeData;
        return {
          ...node,
          data: { ...data, config, summary: summarise(data.nodeType, config, locale) },
        };
      }),
    );
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    setNodes((current) => current.filter((node) => node.id !== selectedId));
    setEdges((current) =>
      current.filter((edge) => edge.source !== selectedId && edge.target !== selectedId),
    );
    setSelectedId(null);
  };

  const selectedNode = nodes.find((node) => node.id === selectedId);
  const selectedForInspector = selectedNode
    ? {
        id: selectedNode.id,
        type: (selectedNode.data as FlowNodeData).nodeType,
        config: ((selectedNode.data as { config?: Record<string, unknown> }).config ?? {}),
      }
    : null;

  const errorCount = report?.issues.filter((i) => i.severity === 'error').length ?? 0;
  const warningCount = report?.issues.filter((i) => i.severity === 'warning').length ?? 0;

  if (detail.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="size-6 text-muted" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push('/automations')} aria-label={t('common.back')}>
            <ArrowLeft />
          </Button>
          <div className="min-w-0">
            <p className="truncate text-[14px] font-medium">{detail.data?.name}</p>
            <div className="mt-0.5 flex items-center gap-2">
              <Badge tone={detail.data?.status === 'PUBLISHED' ? 'success' : 'neutral'}>
                {t(`automations.status.${detail.data?.status}` as MessageKey)}
              </Badge>
              <span className="text-[11px] text-subtle">
                {saveState === 'saving'
                  ? t('automations.saving')
                  : saveState === 'saved'
                    ? t('automations.saved')
                    : ''}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setTriggerDialog(true)}>
            <Zap />
            {t('builder.triggers')}
            {detail.data?.triggers.length ? (
              <Badge tone="accent">{detail.data.triggers.length}</Badge>
            ) : null}
          </Button>
          <Button
            size="sm"
            loading={publish.isPending}
            disabled={errorCount > 0}
            onClick={() => publish.mutate()}
          >
            <Rocket />
            {t('automations.publish')}
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="w-[200px] shrink-0 border-r border-border bg-surface">
          <Palette
            capabilities={capabilities.data ?? []}
            features={workspace.data?.plan?.features ?? []}
            onAdd={addNode}
          />
        </aside>

        <div className="relative min-w-0 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={(connection: Connection) =>
              setEdges((current) =>
                addEdge({ ...connection, id: `e-${Date.now().toString(36)}`, animated: true }, current),
              )
            }
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            fitView
            proOptions={{ hideAttribution: true }}
            deleteKeyCode={['Backspace', 'Delete']}
          >
            <Background gap={18} size={1} color="rgb(var(--border))" />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeColor="rgb(var(--border))" maskColor="rgb(var(--bg) / .7)" />
          </ReactFlow>

          {report ? (
            <div className="pointer-events-none absolute bottom-4 left-4 z-10">
              <div
                className={cn(
                  'pointer-events-auto rounded-lg border px-3 py-2 text-[12px] shadow-sm',
                  errorCount > 0
                    ? 'border-danger/30 bg-danger/10 text-danger'
                    : warningCount > 0
                      ? 'border-warning/30 bg-warning/10 text-warning'
                      : 'border-success/30 bg-success/10 text-success',
                )}
              >
                <div className="flex items-center gap-1.5">
                  {errorCount > 0 ? (
                    <TriangleAlert className="size-3.5" />
                  ) : (
                    <CheckCircle2 className="size-3.5" />
                  )}
                  <span className="font-medium">
                    {errorCount > 0
                      ? `${errorCount} ${t('builder.validation.errors')}`
                      : warningCount > 0
                        ? `${warningCount} ${t('builder.validation.warnings')}`
                        : t('builder.validation.ok')}
                  </span>
                </div>
                {report.issues
                  .filter((i) => !i.nodeId)
                  .slice(0, 3)
                  .map((issue) => (
                    <p key={issue.code} className="mt-1 opacity-90">
                      {issue.message[locale]}
                    </p>
                  ))}
              </div>
            </div>
          ) : null}
        </div>

        <aside className="w-[300px] shrink-0 border-l border-border bg-surface">
          <Inspector
            node={selectedForInspector}
            tags={tags.data ?? []}
            fields={fields.data ?? []}
            members={members.data ?? []}
            onChange={updateSelectedConfig}
            onDelete={deleteSelected}
          />
        </aside>
      </div>

      <TriggerDialog
        open={triggerDialog}
        onOpenChange={setTriggerDialog}
        automationId={automationId}
        accounts={accounts.data ?? []}
        existing={detail.data?.triggers ?? []}
      />
    </div>
  );
}

function TriggerDialog({
  open,
  onOpenChange,
  automationId,
  accounts,
  existing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  automationId: string;
  accounts: ConnectedAccount[];
  existing: Array<{ id: string; type: string; config: Record<string, unknown> }>;
}) {
  const { t, locale } = useI18n();
  const queryClient = useQueryClient();
  const [type, setType] = React.useState('ig_comment');
  const [accountId, setAccountId] = React.useState('');
  const [keywords, setKeywords] = React.useState('');

  React.useEffect(() => {
    if (accounts[0] && !accountId) setAccountId(accounts[0].id);
  }, [accounts, accountId]);

  const definitions = useQuery({
    queryKey: ['trigger-definitions', accountId],
    queryFn: () =>
      get<TriggerDefinitionDto[]>(
        `/automations/trigger-definitions${accountId ? `?connectedAccountId=${accountId}` : ''}`,
      ),
    enabled: open,
  });

  const create = useMutation({
    mutationFn: () => {
      const list = keywords
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);
      const config: Record<string, unknown> = ['ig_comment', 'ig_dm_keyword', 'ig_story_reply'].includes(type)
        ? { includeKeywords: list, excludeKeywords: [], matchMode: 'contains', caseSensitive: false }
        : {};
      if (type === 'ig_comment') config.mediaIds = [];

      return post(`/automations/${automationId}/triggers`, {
        type,
        connectedAccountId: accountId || null,
        config,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['automation', automationId] });
      setKeywords('');
      toast.success(t('builder.addTrigger'));
    },
    onError: (error) => {
      if (error instanceof ApiError) toast.error(error.payload.userMessage);
    },
  });

  const remove = useMutation({
    mutationFn: (triggerId: string) =>
      del(`/automations/${automationId}/triggers/${triggerId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['automation', automationId] }),
  });

  const selected = definitions.data?.find((d) => d.type === type);
  const needsKeywords = ['ig_comment', 'ig_dm_keyword', 'ig_story_reply'].includes(type);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('builder.triggers')}>
        {existing.length > 0 ? (
          <div className="mb-4 space-y-1.5">
            {existing.map((trigger) => (
              <div
                key={trigger.id}
                className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
              >
                <span className="font-mono text-[12px]">{trigger.type}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => remove.mutate(trigger.id)}
                  loading={remove.isPending}
                >
                  {t('common.delete')}
                </Button>
              </div>
            ))}
          </div>
        ) : null}

        <Field label={t('builder.account')}>
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                @{account.username}
                {account.isSandbox ? ' (sandbox)' : ''}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t('builder.addTrigger')}>
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            {definitions.data?.map((definition) => (
              <option key={definition.type} value={definition.type} disabled={!definition.available}>
                {definition.label[locale]}
                {definition.available ? '' : ` — ${t('builder.unavailable')}`}
              </option>
            ))}
          </Select>
        </Field>

        {selected ? (
          <p className="mb-4 -mt-2 text-[11.5px] leading-snug text-muted">
            {selected.limitations[locale]}
          </p>
        ) : null}

        {needsKeywords ? (
          <Field label={t('builder.keywords')} hint={t('builder.keywordsHint')}>
            <Input value={keywords} onChange={(e) => setKeywords(e.target.value)} />
          </Field>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </Button>
          <Button
            loading={create.isPending}
            disabled={!selected?.available}
            onClick={() => create.mutate()}
          >
            {t('builder.addTrigger')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
