import {
  Ban,
  Bell,
  Clock,
  Flag,
  GitBranch,
  Globe,
  MessageSquare,
  Minus,
  Plus,
  Shuffle,
  Split,
  Square,
  UserCheck,
  Variable,
  Workflow,
  Zap,
  type LucideIcon,
} from 'lucide-react';

export interface NodeMeta {
  icon: LucideIcon;
  /** Tailwind classes for the node's accent, kept token-based for both themes. */
  tone: string;
  labelPt: string;
  labelEn: string;
  category: 'trigger' | 'message' | 'logic' | 'data' | 'integration' | 'inbox' | 'terminal';
}

export const NODE_META: Record<string, NodeMeta> = {
  trigger: { icon: Zap, tone: 'text-accent', labelPt: 'Gatilho', labelEn: 'Trigger', category: 'trigger' },
  send_message: {
    icon: MessageSquare,
    tone: 'text-accent',
    labelPt: 'Enviar mensagem',
    labelEn: 'Send message',
    category: 'message',
  },
  condition: { icon: Split, tone: 'text-warning', labelPt: 'Condição', labelEn: 'Condition', category: 'logic' },
  branch: { icon: GitBranch, tone: 'text-warning', labelPt: 'Ramificação', labelEn: 'Branch', category: 'logic' },
  randomizer: {
    icon: Shuffle,
    tone: 'text-warning',
    labelPt: 'Randomizador',
    labelEn: 'Randomizer',
    category: 'logic',
  },
  start_automation: {
    icon: Workflow,
    tone: 'text-accent',
    labelPt: 'Iniciar automação',
    labelEn: 'Start automation',
    category: 'logic',
  },
  delay: { icon: Clock, tone: 'text-warning', labelPt: 'Espera', labelEn: 'Delay', category: 'logic' },
  add_tag: { icon: Plus, tone: 'text-success', labelPt: 'Adicionar tag', labelEn: 'Add tag', category: 'data' },
  remove_tag: { icon: Minus, tone: 'text-success', labelPt: 'Remover tag', labelEn: 'Remove tag', category: 'data' },
  set_custom_field: {
    icon: Variable,
    tone: 'text-success',
    labelPt: 'Definir campo',
    labelEn: 'Set field',
    category: 'data',
  },
  clear_custom_field: {
    icon: Variable,
    tone: 'text-success',
    labelPt: 'Limpar campo',
    labelEn: 'Clear field',
    category: 'data',
  },
  http_request: {
    icon: Globe,
    tone: 'text-muted',
    labelPt: 'Requisição HTTP',
    labelEn: 'HTTP request',
    category: 'integration',
  },
  assign_conversation: {
    icon: UserCheck,
    tone: 'text-muted',
    labelPt: 'Atribuir conversa',
    labelEn: 'Assign conversation',
    category: 'inbox',
  },
  set_conversation_status: {
    icon: Flag,
    tone: 'text-muted',
    labelPt: 'Status da conversa',
    labelEn: 'Conversation status',
    category: 'inbox',
  },
  notify_team: { icon: Bell, tone: 'text-muted', labelPt: 'Notificar time', labelEn: 'Notify team', category: 'inbox' },
  unsubscribe_contact: {
    icon: Ban,
    tone: 'text-danger',
    labelPt: 'Descadastrar',
    labelEn: 'Unsubscribe',
    category: 'data',
  },
  end: { icon: Square, tone: 'text-subtle', labelPt: 'Fim', labelEn: 'End', category: 'terminal' },
};

export function nodeLabel(type: string, locale: string): string {
  const meta = NODE_META[type];
  if (!meta) return type;
  return locale === 'en' ? meta.labelEn : meta.labelPt;
}
