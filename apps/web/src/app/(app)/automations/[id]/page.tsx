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
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Redo2,
  Rocket,
  TriangleAlert,
  Undo2,
  Zap,
} from 'lucide-react';
// Imported by subpath rather than from the package root: the root barrel also
// pulls in id generation, which reaches for node:crypto and cannot be bundled
// for a browser.
import { CONNECTION_REJECTION_MESSAGES, canConnect, portsOf } from '@dmflow/shared/ports';
import { defaultNodeConfig, type FlowGraph } from '@dmflow/shared/flow';
import { ApiError, del, get, post, put } from '@/lib/api';
import { useI18n, type MessageKey } from '@/lib/i18n';
import { useApp } from '@/components/providers/app-providers';
import { Badge, Button, Field, Input, Select, Spinner } from '@/components/ui/primitives';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import {
  FlowNode,
  handleId,
  portIdFromHandle,
  type FlowNodeData,
} from '@/components/flow/flow-node';
import { Inspector } from '@/components/flow/inspector';
import { NODE_META, nodeLabel } from '@/components/flow/node-meta';
import { NodeCatalog, useCatalog } from '@/components/flow/node-catalog';
import { BuilderLookupsProvider } from '@/components/flow/builder-context';
import { autoLayout } from '@/components/flow/auto-layout';
import { CanvasToolbar } from '@/components/flow/canvas-toolbar';
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

const PICKER_WIDTH = 290;
const PICKER_HEIGHT = 420;

/** Keeps the block picker on screen when it is opened near an edge. */
function MenuItem({
  label,
  shortcut,
  danger,
  onClick,
}: {
  label: string;
  shortcut?: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-[12.5px] transition-colors hover:bg-elevated',
        danger ? 'text-danger' : 'text-fg',
      )}
    >
      {label}
      {shortcut ? <span className="text-[11px] text-subtle">{shortcut}</span> : null}
    </button>
  );
}

function pickerPosition(screen: { x: number; y: number }): React.CSSProperties {
  if (typeof window === 'undefined') return { left: screen.x, top: screen.y };

  return {
    left: Math.min(screen.x, window.innerWidth - PICKER_WIDTH - 12),
    top: Math.min(screen.y, window.innerHeight - PICKER_HEIGHT - 12),
  };
}

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
/**
 * What the canvas draws for one node.
 *
 * Ports come from the domain — the same function the validator and the engine
 * read — so a node type never ends up with exits on the canvas that the engine
 * does not follow, or exits in the engine that the canvas never drew.
 */
function nodeData(
  type: string,
  config: Record<string, unknown>,
  label: string,
  locale: string,
): FlowNodeData {
  const layout = portsOf({ type, config } as never);

  return {
    nodeType: type,
    label,
    ports: layout.outputs.map((port) => ({
      id: port.id,
      label: port.label[locale === 'en' ? 'en' : 'pt-BR'],
      fallback: port.fallback,
    })),
    acceptsInput: layout.acceptsInput,
    locale,
    config,
  } as FlowNodeData;
}

/** The canvas shape read back as the domain sees it, for connection checks. */
function asGraph(nodes: Node[], edges: Edge[]): Pick<FlowGraph, 'nodes' | 'edges'> {
  return {
    nodes: nodes.map((node) => {
      const data = node.data as FlowNodeData & { config?: Record<string, unknown> };
      return {
        id: node.id,
        type: data.nodeType,
        position: node.position,
        config: data.config ?? {},
      };
    }) as FlowGraph['nodes'],
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: portIdFromHandle(edge.sourceHandle),
    })) as FlowGraph['edges'],
  };
}

function Builder() {
  const params = useParams<{ id: string }>();
  const automationId = params.id;
  const router = useRouter();
  const { t, locale } = useI18n();
  const { workspaceId } = useApp();
  const queryClient = useQueryClient();

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { screenToFlowPosition, fitView, zoomIn, zoomOut, setCenter } = useReactFlow();

  /**
   * Undo history. Snapshots are pushed on discrete actions — adding, deleting,
   * connecting, finishing a drag — rather than on every pointer move, so one
   * Ctrl+Z undoes one thing the operator did instead of one frame of a drag.
   */
  const history = React.useRef<Array<{ nodes: Node[]; edges: Edge[] }>>([]);
  const future = React.useRef<Array<{ nodes: Node[]; edges: Edge[] }>>([]);
  /** Which exit a connection drag started from, needed when it ends on nothing. */
  const connectingFrom = React.useRef<{ nodeId: string; handle: string | null } | null>(null);
  const [canUndo, setCanUndo] = React.useState(false);
  const [canRedo, setCanRedo] = React.useState(false);

  const snapshot = React.useCallback(() => {
    history.current.push({ nodes: structuredClone(nodes), edges: structuredClone(edges) });
    if (history.current.length > 50) history.current.shift();
    future.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }, [nodes, edges]);

  const undo = React.useCallback(() => {
    const previous = history.current.pop();
    if (!previous) return;
    future.current.push({ nodes: structuredClone(nodes), edges: structuredClone(edges) });
    setNodes(previous.nodes);
    setEdges(previous.edges);
    setCanUndo(history.current.length > 0);
    setCanRedo(true);
  }, [nodes, edges, setNodes, setEdges]);

  const redo = React.useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    history.current.push({ nodes: structuredClone(nodes), edges: structuredClone(edges) });
    setNodes(next.nodes);
    setEdges(next.edges);
    setCanUndo(true);
    setCanRedo(future.current.length > 0);
  }, [nodes, edges, setNodes, setEdges]);
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
  // Other automations this flow may hand a contact to. Itself excluded: the
  // domain refuses that anyway, and offering it invites the mistake.
  const automations = useQuery({
    queryKey: ['automations', workspaceId],
    queryFn: () => get<Array<{ id: string; name: string }>>('/automations'),
    enabled: Boolean(workspaceId),
    select: (list) => list.filter((item) => item.id !== automationId),
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
        data: nodeData(
          node.type,
          node.config,
          node.label ?? nodeLabel(node.type, locale),
          locale,
        ),
      })),
    );
    setEdges(
      detail.data.graph.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: handleId(edge.sourceHandle ?? null),
        type: 'smoothstep',
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
        // The canvas needs a string for every handle; the domain uses null for
        // the unnamed exit. Translated here rather than in both directions all
        // over the file.
        sourceHandle: portIdFromHandle(edge.sourceHandle),
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

  const addNode = React.useCallback(
    (type: string, position?: { x: number; y: number }, options: { record?: boolean } = {}) => {
      if (options.record !== false) snapshot();

      const id = `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const last = nodes.at(-1);
      const placement =
        position ?? {
          x: last ? last.position.x : 260,
          y: last ? last.position.y + 150 : 220,
        };

      setNodes((current) => [
        ...current,
        {
          id,
          type: 'dmflow',
          position: placement,
          data: nodeData(type, defaultNodeConfig(type as never), nodeLabel(type, locale), locale),
        },
      ]);
      setSelectedId(id);
      return id;
    },
    [nodes, locale, setNodes, snapshot],
  );

  /**
   * The block picker, opened either from empty canvas or from a dragged exit.
   *
   * `from` is what turns picking a block into two steps instead of four: the new
   * block is created where the drag ended and wired to the exit it came from, so
   * the operator never has to aim a second connection by hand.
   */
  const [picker, setPicker] = React.useState<{
    screen: { x: number; y: number };
    flow: { x: number; y: number };
    from?: { nodeId: string; handle: string | null };
  } | null>(null);

  const pickFromCatalog = React.useCallback(
    (type: string) => {
      if (!picker) return;

      snapshot();
      const id = addNode(
        type,
        { x: picker.flow.x - 118, y: picker.flow.y - 44 },
        // The snapshot above already covers both the node and the edge, so undo
        // takes back the whole gesture rather than half of it.
        { record: false },
      );

      if (picker.from) {
        setEdges((current) => [
          ...current,
          {
            id: `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            source: picker.from!.nodeId,
            sourceHandle: handleId(picker.from!.handle),
            target: id,
            type: 'smoothstep',
            animated: true,
          },
        ]);
      }

      setPicker(null);
    },
    [picker, addNode, setEdges, snapshot],
  );

  /**
   * Where a connection drag ended.
   *
   * Ending on empty canvas opens the picker; ending on an occupied or forbidden
   * target says why. React Flow refuses an invalid connection silently, which
   * otherwise leaves the operator dragging the same line again and again with no
   * idea what is wrong.
   */
  const onConnectEnd = React.useCallback(
    (event: MouseEvent | TouchEvent, state: { isValid: boolean | null; fromHandle?: unknown }) => {
      const source = connectingFrom.current;
      connectingFrom.current = null;
      if (!source || state.isValid) return;

      const point =
        'changedTouches' in event
          ? { x: event.changedTouches[0]!.clientX, y: event.changedTouches[0]!.clientY }
          : { x: event.clientX, y: event.clientY };

      const target = document.elementFromPoint(point.x, point.y);
      const droppedOnCanvas = Boolean(target?.closest('.react-flow__pane'));

      if (droppedOnCanvas) {
        setPicker({ screen: point, flow: screenToFlowPosition(point), from: source });
        return;
      }

      const droppedOnNode = (target as HTMLElement | null)?.closest('.react-flow__node');
      const targetId = (droppedOnNode as HTMLElement | null)?.dataset.id;
      if (!targetId) return;

      const check = canConnect(asGraph(nodes, edges), {
        source: source.nodeId,
        sourceHandle: source.handle,
        target: targetId,
      });
      if (!check.ok) {
        toast.error(CONNECTION_REJECTION_MESSAGES[check.reason!][locale === 'en' ? 'en' : 'pt-BR']);
      }
    },
    [nodes, edges, locale, screenToFlowPosition],
  );

  const onConnectStart = React.useCallback(
    (
      _event: unknown,
      params: { nodeId: string | null; handleId: string | null; handleType: string | null },
    ) => {
      connectingFrom.current =
        params.nodeId && params.handleType === 'source'
          ? { nodeId: params.nodeId, handle: portIdFromHandle(params.handleId) }
          : null;
    },
    [],
  );

  /**
   * Right-click menu. Complementary to the toolbar and the shortcuts, never the
   * only way to reach an action.
   */
  const [contextMenu, setContextMenu] = React.useState<{
    screen: { x: number; y: number };
    flow: { x: number; y: number };
    nodeId?: string;
  } | null>(null);

  const openContextMenu = React.useCallback(
    (event: React.MouseEvent, nodeId?: string) => {
      event.preventDefault();
      const point = { x: event.clientX, y: event.clientY };
      if (nodeId) setSelectedId(nodeId);
      setPicker(null);
      setContextMenu({ screen: point, flow: screenToFlowPosition(point), nodeId });
    },
    [screenToFlowPosition],
  );

  /**
   * Double-clicking empty canvas adds a block right where the cursor is.
   *
   * Registered natively rather than through React Flow: it exposes no
   * double-click handler for the canvas, and its zoom behaviour attaches its own
   * listener to the same element. Capture phase runs before that one.
   */
  // Held in a ref so the listener below can stay attached across renders while
  // still calling the current conversion function.
  const toFlow = React.useRef(screenToFlowPosition);
  toFlow.current = screenToFlowPosition;

  const handleDoubleClick = React.useCallback((event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target?.closest('.react-flow__pane')) return;
    if (target.closest('.react-flow__node')) return;

    event.preventDefault();
    event.stopPropagation();
    const point = { x: event.clientX, y: event.clientY };
    setPicker({ screen: point, flow: toFlow.current(point) });
  }, []);

  /**
   * Attached by callback ref rather than by effect.
   *
   * The canvas only exists after the automation has loaded, and an effect that
   * ran while the loading spinner was on screen would find no element and never
   * run again.
   */
  const canvasRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      canvasNode.current?.removeEventListener('dblclick', handleDoubleClick, { capture: true });
      canvasNode.current = node;
      node?.addEventListener('dblclick', handleDoubleClick, { capture: true });
    },
    [handleDoubleClick],
  );
  const canvasNode = React.useRef<HTMLDivElement | null>(null);

  /** Drops a palette block at the cursor, converting screen to canvas coordinates. */
  const onDrop = React.useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const type = event.dataTransfer.getData('application/dmflow-node');
      if (!type) return;

      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      // Centre the block on the cursor rather than hanging it off the corner:
      // a fresh block renders 236 wide and about 88 tall before it is configured.
      addNode(type, { x: position.x - 118, y: position.y - 44 });
    },
    [addNode, screenToFlowPosition],
  );

  const onDragOver = React.useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const updateSelectedConfig = (config: Record<string, unknown>) => {
    if (!selectedId) return;

    setNodes((current) =>
      current.map((node) => {
        if (node.id !== selectedId) return node;
        const data = node.data as FlowNodeData;
        // Exits are recomputed, not preserved: renaming a branch path has to
        // rename its exit, and deleting one has to remove it.
        return { ...node, data: nodeData(data.nodeType, config, data.label, locale) };
      }),
    );

    // An exit that no longer exists takes its connection with it. Leaving the
    // edge behind would draw a path the engine can never follow.
    setEdges((current) =>
      current.filter((edge) => {
        if (edge.source !== selectedId) return true;
        const type = (nodes.find((n) => n.id === selectedId)?.data as FlowNodeData | undefined)
          ?.nodeType;
        if (!type) return true;
        return portsOf({ type, config } as never).outputs.some(
          (port) => port.id === portIdFromHandle(edge.sourceHandle),
        );
      }),
    );
  };

  /**
   * Decides whether a connection may be made, while the operator is still
   * dragging it. Same function the server runs before storing the graph — the
   * canvas is the fast answer, never the authority.
   */
  const isValidConnection = React.useCallback(
    (connection: Connection | Edge) => {
      if (!connection.source || !connection.target) return false;
      return canConnect(asGraph(nodes, edges), {
        source: connection.source,
        sourceHandle: portIdFromHandle(connection.sourceHandle),
        target: connection.target,
      }).ok;
    },
    [nodes, edges],
  );

  const connect = React.useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;

      const check = canConnect(asGraph(nodes, edges), {
        source: connection.source,
        sourceHandle: portIdFromHandle(connection.sourceHandle),
        target: connection.target,
      });

      if (!check.ok) {
        // Saying why beats a connection that simply refuses to stick.
        toast.error(CONNECTION_REJECTION_MESSAGES[check.reason!][locale === 'en' ? 'en' : 'pt-BR']);
        return;
      }

      snapshot();
      setEdges((current) =>
        addEdge(
          {
            ...connection,
            id: `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            type: 'smoothstep',
            animated: true,
          },
          current,
        ),
      );
    },
    [nodes, edges, locale, setEdges, snapshot],
  );

  /** Dragging an existing connection to a different block. */
  const reconnect = React.useCallback(
    (oldEdge: Edge, connection: Connection) => {
      if (!connection.source || !connection.target) return;

      const check = canConnect(
        asGraph(nodes, edges),
        {
          source: connection.source,
          sourceHandle: portIdFromHandle(connection.sourceHandle),
          target: connection.target,
        },
        // Without this the edge being moved would block its own replacement.
        { ignoreEdgeId: oldEdge.id },
      );

      if (!check.ok) {
        toast.error(CONNECTION_REJECTION_MESSAGES[check.reason!][locale === 'en' ? 'en' : 'pt-BR']);
        return;
      }

      snapshot();
      setEdges((current) =>
        current.map((edge) =>
          edge.id === oldEdge.id
            ? {
                ...edge,
                source: connection.source!,
                sourceHandle: connection.sourceHandle ?? null,
                target: connection.target!,
                targetHandle: connection.targetHandle ?? null,
              }
            : edge,
        ),
      );
    },
    [nodes, edges, locale, setEdges, snapshot],
  );

  /**
   * Removes every selected block, and every connection that touched one.
   *
   * Leaving an edge whose block is gone would draw a path to nothing, so the
   * connections go with the blocks. Undo brings all of it back together.
   */
  const deleteSelection = React.useCallback(() => {
    const doomed = new Set(
      nodes.filter((node) => node.selected).map((node) => node.id),
    );
    if (selectedId) doomed.add(selectedId);
    // The trigger is the flow's entry point; deleting it would leave a graph
    // nothing can start.
    for (const node of nodes) {
      if ((node.data as FlowNodeData).nodeType === 'trigger') doomed.delete(node.id);
    }
    if (doomed.size === 0) return;

    snapshot();
    setNodes((current) => current.filter((node) => !doomed.has(node.id)));
    setEdges((current) =>
      current.filter((edge) => !doomed.has(edge.source) && !doomed.has(edge.target)),
    );
    setSelectedId(null);
  }, [nodes, selectedId, setNodes, setEdges, snapshot]);

  /**
   * Copies the selected blocks, and only the connections that run between them.
   *
   * An edge to a block that was not copied would either point at the original —
   * silently rewiring a flow the operator did not touch — or at nothing.
   */
  const duplicateSelection = React.useCallback(() => {
    const chosen = nodes.filter(
      (node) =>
        (node.selected || node.id === selectedId) &&
        (node.data as FlowNodeData).nodeType !== 'trigger',
    );
    if (chosen.length === 0) return;

    snapshot();
    const stamp = Date.now().toString(36);
    const idMap = new Map(chosen.map((node, index) => [node.id, `${node.id}-c${stamp}${index}`]));

    const copies: Node[] = chosen.map((node) => ({
      ...node,
      id: idMap.get(node.id)!,
      // Offset so the copy is visibly a copy rather than hidden under the original.
      position: { x: node.position.x + 48, y: node.position.y + 48 },
      selected: true,
      data: { ...(node.data as FlowNodeData) },
    }));

    const internal: Edge[] = edges
      .filter((edge) => idMap.has(edge.source) && idMap.has(edge.target))
      .map((edge, index) => ({
        ...edge,
        id: `e-${stamp}-${index}`,
        source: idMap.get(edge.source)!,
        target: idMap.get(edge.target)!,
      }));

    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), ...copies]);
    setEdges((current) => [...current, ...internal]);
    setSelectedId(copies[0]!.id);
  }, [nodes, edges, selectedId, setNodes, setEdges, snapshot]);

  /**
   * Copy and paste, held in memory rather than in the system clipboard.
   *
   * A flow node is not text, and serialising it out to the OS clipboard would
   * mean pasting a wall of JSON into whatever the operator had open next.
   */
  const clipboard = React.useRef<{ nodes: Node[]; edges: Edge[] } | null>(null);

  const copySelection = React.useCallback(() => {
    const chosen = nodes.filter(
      (node) =>
        (node.selected || node.id === selectedId) &&
        (node.data as FlowNodeData).nodeType !== 'trigger',
    );
    if (chosen.length === 0) return;

    const ids = new Set(chosen.map((node) => node.id));
    clipboard.current = {
      nodes: structuredClone(chosen),
      // Only connections whose both ends are being copied; anything else would
      // paste a path into a block the operator did not copy.
      edges: structuredClone(
        edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
      ),
    };
    toast.success(t('builder.copied'));
  }, [nodes, edges, selectedId, t]);

  const pasteClipboard = React.useCallback(() => {
    const held = clipboard.current;
    if (!held || held.nodes.length === 0) return;

    snapshot();
    const stamp = Date.now().toString(36);
    const idMap = new Map(held.nodes.map((node, index) => [node.id, `${node.id}-p${stamp}${index}`]));

    const pasted: Node[] = held.nodes.map((node) => ({
      ...node,
      id: idMap.get(node.id)!,
      position: { x: node.position.x + 64, y: node.position.y + 64 },
      selected: true,
    }));

    setNodes((current) => [...current.map((node) => ({ ...node, selected: false })), ...pasted]);
    setEdges((current) => [
      ...current,
      ...held.edges.map((edge, index) => ({
        ...edge,
        id: `e-${stamp}-p${index}`,
        source: idMap.get(edge.source)!,
        target: idMap.get(edge.target)!,
      })),
    ]);
    setSelectedId(pasted[0]!.id);
  }, [setNodes, setEdges, snapshot]);

  /**
   * Tidies the canvas. Positions only — never a connection, never a config.
   */
  const organise = React.useCallback(() => {
    snapshot();
    setNodes((current) => autoLayout(current, edges));
    window.setTimeout(() => fitView({ duration: 300, padding: 0.2 }), 30);
  }, [edges, setNodes, snapshot, fitView]);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // Never hijack a shortcut while somebody is typing a message into a config
      // field: Ctrl+Z there has to mean "undo my typing".
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      if (event.key === 'Escape') {
        setPicker(null);
        setContextMenu(null);
        setSelectedId(null);
        setNodes((current) => current.map((node) => ({ ...node, selected: false })));
        return;
      }

      if ((event.key === 'Delete' || event.key === 'Backspace') && !picker) {
        event.preventDefault();
        deleteSelection();
        return;
      }

      if (!(event.metaKey || event.ctrlKey)) return;

      switch (event.key.toLowerCase()) {
        case 'z':
          event.preventDefault();
          if (event.shiftKey) redo();
          else undo();
          break;
        case 'y':
          event.preventDefault();
          redo();
          break;
        case 'd':
          event.preventDefault();
          duplicateSelection();
          break;
        case 'c':
          copySelection();
          break;
        case 'v':
          event.preventDefault();
          pasteClipboard();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, deleteSelection, duplicateSelection, copySelection, pasteClipboard, picker, setNodes]);

  const catalog = useCatalog(capabilities.data ?? [], workspace.data?.plan?.features ?? [], locale);

  const [issuesOpen, setIssuesOpen] = React.useState(false);

  const lookups = React.useMemo(
    () => ({
      tags: tags.data ?? [],
      fields: fields.data ?? [],
      members: members.data ?? [],
      automations: automations.data ?? [],
      triggers: detail.data?.triggers ?? [],
    }),
    [tags.data, fields.data, members.data, automations.data, detail.data?.triggers],
  );

  const nodeTitle = React.useCallback(
    (nodeId: string) =>
      (nodes.find((node) => node.id === nodeId)?.data as FlowNodeData | undefined)?.label ?? nodeId,
    [nodes],
  );

  /**
   * Takes the operator to the block a problem is about.
   *
   * A list of problems that only names them leaves the operator hunting across a
   * canvas they may have scrolled far away from — so clicking one centres it,
   * selects it, and opens its configuration.
   */
  const revealNode = React.useCallback(
    (nodeId: string) => {
      const node = nodes.find((entry) => entry.id === nodeId);
      if (!node) return;

      setSelectedId(nodeId);
      setNodes((current) =>
        current.map((entry) => ({ ...entry, selected: entry.id === nodeId })),
      );
      setCenter(node.position.x + 118, node.position.y + 60, { zoom: 1, duration: 400 });
    },
    [nodes, setNodes, setCenter],
  );

  const hasSelection = React.useMemo(
    () =>
      nodes.some(
        (node) =>
          (node.selected || node.id === selectedId) &&
          (node.data as FlowNodeData).nodeType !== 'trigger',
      ),
    [nodes, selectedId],
  );

  // A flow with nothing but its trigger has not been started yet, so the canvas
  // says what to do first instead of showing an empty expanse.
  const isEmptyFlow = nodes.length <= 1 && edges.length === 0;

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
    <BuilderLookupsProvider value={lookups}>
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
          <Button
            variant="ghost"
            size="icon"
            onClick={undo}
            disabled={!canUndo}
            aria-label={t('builder.undo')}
            title={`${t('builder.undo')} (Ctrl+Z)`}
          >
            <Undo2 />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={redo}
            disabled={!canRedo}
            aria-label={t('builder.redo')}
            title={`${t('builder.redo')} (Ctrl+Shift+Z)`}
          >
            <Redo2 />
          </Button>
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
        <aside className="flex w-[228px] shrink-0 flex-col border-r border-border bg-surface">
          <div className="border-b border-border px-3 pb-2 pt-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-subtle">
              {t('builder.palette')}
            </p>
            <p className="mt-1 text-[11px] leading-snug text-subtle">{t('builder.dragHint')}</p>
          </div>
          {/* Same component as the floating picker: a block offered in one place
              is offered in the other, with the same availability rules. */}
          <NodeCatalog
            entries={catalog}
            onPick={(type) => addNode(type)}
            autoFocus={false}
            draggable
          />
        </aside>

        <div className="relative min-w-0 flex-1" ref={canvasRef}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={connect}
            isValidConnection={isValidConnection}
            onReconnect={reconnect}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            onNodeClick={(_, node) => setSelectedId(node.id)}
            onPaneClick={() => {
              setSelectedId(null);
              setPicker(null);
              setContextMenu(null);
            }}
            onPaneContextMenu={(event) => openContextMenu(event as React.MouseEvent)}
            onNodeContextMenu={(event, node) => openContextMenu(event, node.id)}
            // History is recorded when a drag starts, so undo restores where the
            // block was before the move rather than mid-gesture.
            onNodeDragStart={() => snapshot()}
            onDrop={onDrop}
            onDragOver={onDragOver}
            snapToGrid
            snapGrid={[16, 16]}
            // Double-click adds a block here, so it must not also zoom.
            zoomOnDoubleClick={false}
            multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
            selectionOnDrag
            panOnDrag={[1, 2]}
            fitView
            proOptions={{ hideAttribution: true }}
            // Deletion goes through our own handler, which keeps the trigger and
            // records one undo step for the whole removal.
            deleteKeyCode={null}
          >
            <Background gap={18} size={1} color="rgb(var(--border))" />
            <Controls showInteractive={false} position="bottom-right" />
            <MiniMap
              pannable
              zoomable
              position="bottom-left"
              nodeColor="rgb(var(--border))"
              maskColor="rgb(var(--bg) / .7)"
            />
          </ReactFlow>

          <CanvasToolbar
            canUndo={canUndo}
            canRedo={canRedo}
            hasSelection={hasSelection}
            onAdd={(point) => setPicker({ screen: point, flow: screenToFlowPosition(point) })}
            onUndo={undo}
            onRedo={redo}
            onDuplicate={duplicateSelection}
            onDelete={deleteSelection}
            onOrganise={organise}
            onZoomIn={() => zoomIn({ duration: 200 })}
            onZoomOut={() => zoomOut({ duration: 200 })}
            onFitView={() => fitView({ duration: 300, padding: 0.2 })}
          />

          {picker ? (
            <>
              {/* Catches the click that dismisses the picker without letting it
                  reach the canvas and start a selection. */}
              <div className="fixed inset-0 z-20" onMouseDown={() => setPicker(null)} />
              <div
                className="fixed z-30 w-[290px] overflow-hidden rounded-xl border border-border bg-surface shadow-lg"
                style={pickerPosition(picker.screen)}
                onMouseDown={(event) => event.stopPropagation()}
              >
                <p className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-subtle">
                  {t('catalog.title')}
                </p>
                <NodeCatalog entries={catalog} onPick={pickFromCatalog} compact />
              </div>
            </>
          ) : null}

          {contextMenu ? (
            <>
              <div className="fixed inset-0 z-20" onMouseDown={() => setContextMenu(null)} />
              <div
                className="fixed z-30 min-w-[176px] overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-lg"
                style={{ left: contextMenu.screen.x, top: contextMenu.screen.y }}
                onMouseDown={(event) => event.stopPropagation()}
              >
                {contextMenu.nodeId ? (
                  <>
                    <MenuItem
                      label={t('builder.duplicate')}
                      shortcut="Ctrl+D"
                      onClick={() => {
                        duplicateSelection();
                        setContextMenu(null);
                      }}
                    />
                    <MenuItem
                      label={t('common.copy')}
                      shortcut="Ctrl+C"
                      onClick={() => {
                        copySelection();
                        setContextMenu(null);
                      }}
                    />
                    <MenuItem
                      label={t('builder.deleteNode')}
                      shortcut="Delete"
                      danger
                      onClick={() => {
                        deleteSelection();
                        setContextMenu(null);
                      }}
                    />
                  </>
                ) : (
                  <>
                    <MenuItem
                      label={t('builder.addBlock')}
                      onClick={() => {
                        setPicker({ screen: contextMenu.screen, flow: contextMenu.flow });
                        setContextMenu(null);
                      }}
                    />
                    <MenuItem
                      label={t('common.paste')}
                      shortcut="Ctrl+V"
                      onClick={() => {
                        pasteClipboard();
                        setContextMenu(null);
                      }}
                    />
                    <MenuItem
                      label={t('builder.organise')}
                      onClick={() => {
                        organise();
                        setContextMenu(null);
                      }}
                    />
                    <MenuItem
                      label={t('builder.fitView')}
                      onClick={() => {
                        fitView({ duration: 300, padding: 0.2 });
                        setContextMenu(null);
                      }}
                    />
                  </>
                )}
              </div>
            </>
          ) : null}

          {isEmptyFlow ? (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
              <div className="pointer-events-auto max-w-[340px] rounded-xl border border-border bg-surface/95 px-5 py-4 text-center shadow-sm backdrop-blur">
                <p className="text-[14px] font-medium">{t('builder.emptyTitle')}</p>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
                  {t('builder.emptyHint')}
                </p>
                <div className="mt-3 flex flex-col gap-2">
                  <Button size="sm" onClick={() => setTriggerDialog(true)}>
                    <Zap />
                    {t('builder.addTrigger')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={(event) =>
                      setPicker({
                        screen: { x: event.clientX, y: event.clientY },
                        flow: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
                      })
                    }
                  >
                    {t('builder.emptyAddStep')}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          {report ? (
            <div className="absolute bottom-4 left-4 z-10 w-[320px] max-w-[calc(100%-2rem)]">
              <div
                className={cn(
                  'overflow-hidden rounded-lg border text-[12px] shadow-sm',
                  errorCount > 0
                    ? 'border-danger/30 bg-danger/10'
                    : warningCount > 0
                      ? 'border-warning/30 bg-warning/10'
                      : 'border-success/30 bg-success/10',
                )}
              >
                <button
                  type="button"
                  onClick={() => setIssuesOpen((open) => !open)}
                  disabled={report.issues.length === 0}
                  className={cn(
                    'flex w-full items-center gap-1.5 px-3 py-2 text-left',
                    errorCount > 0
                      ? 'text-danger'
                      : warningCount > 0
                        ? 'text-warning'
                        : 'text-success',
                  )}
                >
                  {errorCount > 0 ? (
                    <TriangleAlert className="size-3.5 shrink-0" />
                  ) : (
                    <CheckCircle2 className="size-3.5 shrink-0" />
                  )}
                  <span className="flex-1 font-medium">
                    {errorCount > 0
                      ? `${errorCount} ${t('builder.validation.errors')}`
                      : warningCount > 0
                        ? `${warningCount} ${t('builder.validation.warnings')}`
                        : t('builder.validation.ok')}
                  </span>
                  {report.issues.length > 0 ? (
                    <ChevronDown
                      className={cn('size-3.5 shrink-0 transition-transform', issuesOpen && 'rotate-180')}
                    />
                  ) : null}
                </button>

                {issuesOpen && report.issues.length > 0 ? (
                  <div className="max-h-[240px] overflow-y-auto border-t border-current/15 bg-surface">
                    {report.issues.map((issue, index) => (
                      <button
                        key={`${issue.code}-${issue.nodeId ?? index}`}
                        type="button"
                        onClick={() => issue.nodeId && revealNode(issue.nodeId)}
                        disabled={!issue.nodeId}
                        className={cn(
                          'flex w-full items-start gap-2 border-b border-border/60 px-3 py-2 text-left last:border-b-0',
                          issue.nodeId ? 'hover:bg-elevated' : 'cursor-default',
                        )}
                      >
                        <span
                          className={cn(
                            'mt-1 size-1.5 shrink-0 rounded-full',
                            issue.severity === 'error' ? 'bg-danger' : 'bg-warning',
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[11.5px] leading-snug text-fg">
                            {issue.message[locale]}
                          </span>
                          {issue.nodeId ? (
                            <span className="mt-0.5 block truncate text-[10.5px] text-subtle">
                              {nodeTitle(issue.nodeId)}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
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
            automations={automations.data ?? []}
            onChange={updateSelectedConfig}
            onDelete={deleteSelection}
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
    </BuilderLookupsProvider>
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

/**
 * ReactFlowProvider has to sit above the component that calls useReactFlow, which
 * is what converts a drop's screen coordinates into canvas coordinates.
 */
export default function BuilderPage() {
  return (
    <ReactFlowProvider>
      <Builder />
    </ReactFlowProvider>
  );
}
