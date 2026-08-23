import { DEFAULT_LOCALE, type Locale, type LocalizedMessage, localize } from './locale.js';

export type ErrorCategory =
  | 'VALIDATION'
  | 'AUTH'
  | 'PERMISSION'
  | 'CAPABILITY'
  | 'RATE_LIMIT'
  | 'PROVIDER'
  | 'BILLING'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'POLICY'
  | 'INTERNAL';

export interface ErrorDefinition {
  code: string;
  category: ErrorCategory;
  httpStatus: number;
  retryable: boolean;
  message: LocalizedMessage;
}

/**
 * Every error the product can produce has a row here. Adding a `throw` without
 * a matching definition is a review failure — a user must never see a bare string.
 */
export const ERROR_CATALOG = {
  // ── Validation
  VALIDATION_FAILED: {
    code: 'VALIDATION_FAILED',
    category: 'VALIDATION',
    httpStatus: 422,
    retryable: false,
    message: {
      'pt-BR': 'Alguns campos estão inválidos. Confira os detalhes e tente de novo.',
      en: 'Some fields are invalid. Check the details and try again.',
    },
  },

  // ── Auth
  INVALID_CREDENTIALS: {
    code: 'INVALID_CREDENTIALS',
    category: 'AUTH',
    httpStatus: 401,
    retryable: false,
    message: {
      'pt-BR': 'E-mail ou senha incorretos.',
      en: 'Incorrect email or password.',
    },
  },
  NOT_AUTHENTICATED: {
    code: 'NOT_AUTHENTICATED',
    category: 'AUTH',
    httpStatus: 401,
    retryable: false,
    message: {
      'pt-BR': 'Sua sessão expirou. Entre novamente.',
      en: 'Your session expired. Please sign in again.',
    },
  },
  SESSION_REUSE_DETECTED: {
    code: 'SESSION_REUSE_DETECTED',
    category: 'AUTH',
    httpStatus: 401,
    retryable: false,
    message: {
      'pt-BR':
        'Detectamos uso de uma sessão antiga e encerramos todos os acessos por segurança. Entre novamente.',
      en: 'We detected an old session being reused and signed out every device for safety. Please sign in again.',
    },
  },
  TOTP_REQUIRED: {
    code: 'TOTP_REQUIRED',
    category: 'AUTH',
    httpStatus: 401,
    retryable: false,
    message: {
      'pt-BR': 'Informe o código de verificação em duas etapas.',
      en: 'Enter your two-factor verification code.',
    },
  },
  TOTP_INVALID: {
    code: 'TOTP_INVALID',
    category: 'AUTH',
    httpStatus: 401,
    retryable: false,
    message: {
      'pt-BR': 'Código de verificação inválido ou expirado.',
      en: 'Invalid or expired verification code.',
    },
  },
  EMAIL_ALREADY_REGISTERED: {
    code: 'EMAIL_ALREADY_REGISTERED',
    category: 'CONFLICT',
    httpStatus: 409,
    retryable: false,
    message: {
      'pt-BR': 'Já existe uma conta com este e-mail.',
      en: 'An account with this email already exists.',
    },
  },
  RESET_TOKEN_INVALID: {
    code: 'RESET_TOKEN_INVALID',
    category: 'AUTH',
    httpStatus: 400,
    retryable: false,
    message: {
      'pt-BR': 'Este link de redefinição é inválido ou já foi usado. Solicite um novo.',
      en: 'This reset link is invalid or already used. Request a new one.',
    },
  },

  VERIFICATION_TOKEN_INVALID: {
    code: 'VERIFICATION_TOKEN_INVALID',
    category: 'AUTH',
    httpStatus: 400,
    retryable: false,
    message: {
      'pt-BR': 'Este link de confirmação é inválido, expirou ou já foi usado. Peça um novo.',
      en: 'This confirmation link is invalid, expired or already used. Request a new one.',
    },
  },

  EMAIL_NOT_VERIFIED: {
    code: 'EMAIL_NOT_VERIFIED',
    category: 'AUTH',
    httpStatus: 403,
    retryable: false,
    message: {
      'pt-BR':
        'Confirme seu e-mail antes de fazer esta ação. Enviamos um link para o endereço do seu cadastro.',
      en: 'Confirm your email before doing this. We sent a link to your registered address.',
    },
  },

  // ── Permission / tenancy
  FORBIDDEN: {
    code: 'FORBIDDEN',
    category: 'PERMISSION',
    httpStatus: 403,
    retryable: false,
    message: {
      'pt-BR': 'Seu papel neste workspace não permite esta ação.',
      en: 'Your role in this workspace does not allow this action.',
    },
  },
  WORKSPACE_ACCESS_DENIED: {
    code: 'WORKSPACE_ACCESS_DENIED',
    category: 'PERMISSION',
    httpStatus: 403,
    retryable: false,
    message: {
      'pt-BR': 'Você não tem acesso a este workspace.',
      en: 'You do not have access to this workspace.',
    },
  },
  LAST_OWNER_CANNOT_LEAVE: {
    code: 'LAST_OWNER_CANNOT_LEAVE',
    category: 'CONFLICT',
    httpStatus: 409,
    retryable: false,
    message: {
      'pt-BR':
        'Você é o único proprietário. Transfira a propriedade para outra pessoa antes de sair.',
      en: 'You are the only owner. Transfer ownership to someone else before leaving.',
    },
  },

  // ── Not found / conflict
  NOT_FOUND: {
    code: 'NOT_FOUND',
    category: 'NOT_FOUND',
    httpStatus: 404,
    retryable: false,
    message: {
      'pt-BR': 'Não encontramos o que você procura.',
      en: 'We could not find what you are looking for.',
    },
  },
  ALREADY_EXISTS: {
    code: 'ALREADY_EXISTS',
    category: 'CONFLICT',
    httpStatus: 409,
    retryable: false,
    message: {
      'pt-BR': 'Já existe um registro com estes dados.',
      en: 'A record with these details already exists.',
    },
  },

  // ── Billing
  WORKSPACE_SUSPENDED: {
    code: 'WORKSPACE_SUSPENDED',
    category: 'BILLING',
    httpStatus: 402,
    retryable: false,
    message: {
      'pt-BR':
        'Este workspace está suspenso por pendência no pagamento. As automações estão paradas e seus dados continuam salvos. Regularize a assinatura para reativar.',
      en: 'This workspace is suspended for an outstanding payment. Automations are halted and your data is safe. Update your subscription to reactivate.',
    },
  },
  PLAN_LIMIT_REACHED: {
    code: 'PLAN_LIMIT_REACHED',
    category: 'BILLING',
    httpStatus: 402,
    retryable: false,
    message: {
      'pt-BR': 'Você atingiu o limite do seu plano. Faça upgrade para continuar.',
      en: 'You have reached your plan limit. Upgrade to continue.',
    },
  },
  BILLING_NOT_CONFIGURED: {
    code: 'BILLING_NOT_CONFIGURED',
    category: 'BILLING',
    httpStatus: 503,
    retryable: false,
    message: {
      'pt-BR': 'A cobrança ainda não foi configurada nesta instalação.',
      en: 'Billing is not configured on this installation yet.',
    },
  },
  STRIPE_SIGNATURE_INVALID: {
    code: 'STRIPE_SIGNATURE_INVALID',
    category: 'AUTH',
    httpStatus: 400,
    retryable: false,
    message: {
      'pt-BR': 'Não foi possível validar a origem deste evento de cobrança.',
      en: 'This billing event could not be verified.',
    },
  },

  // ── Capability (the deny-by-default surface)
  CAPABILITY_NOT_VALIDATED: {
    code: 'CAPABILITY_NOT_VALIDATED',
    category: 'CAPABILITY',
    httpStatus: 409,
    retryable: false,
    message: {
      'pt-BR':
        'Este recurso ainda não foi validado na documentação oficial do canal, então está desativado. Nada é executado sem confirmação.',
      en: 'This feature has not been validated against the channel’s official documentation yet, so it is disabled. Nothing runs without confirmation.',
    },
  },
  CAPABILITY_MISSING_PERMISSION: {
    code: 'CAPABILITY_MISSING_PERMISSION',
    category: 'CAPABILITY',
    httpStatus: 409,
    retryable: false,
    message: {
      'pt-BR': 'A conta conectada não concedeu a permissão necessária para esta ação.',
      en: 'The connected account has not granted the permission this action needs.',
    },
  },
  CAPABILITY_ACCOUNT_TYPE: {
    code: 'CAPABILITY_ACCOUNT_TYPE',
    category: 'CAPABILITY',
    httpStatus: 409,
    retryable: false,
    message: {
      'pt-BR': 'O tipo desta conta não suporta esta ação.',
      en: 'This account type does not support this action.',
    },
  },
  CAPABILITY_APP_REVIEW_REQUIRED: {
    code: 'CAPABILITY_APP_REVIEW_REQUIRED',
    category: 'CAPABILITY',
    httpStatus: 409,
    retryable: false,
    message: {
      'pt-BR': 'Este recurso depende de aprovação do app junto à plataforma.',
      en: 'This feature depends on platform app approval.',
    },
  },
  WINDOW_CLOSED: {
    code: 'WINDOW_CLOSED',
    category: 'POLICY',
    httpStatus: 409,
    retryable: false,
    message: {
      'pt-BR':
        'A janela de mensagens com este contato está fechada. Só é possível responder depois que a pessoa enviar uma nova mensagem.',
      en: 'The messaging window with this contact is closed. You can reply once they message you again.',
    },
  },
  WINDOW_UNKNOWN: {
    code: 'WINDOW_UNKNOWN',
    category: 'POLICY',
    httpStatus: 409,
    retryable: false,
    message: {
      'pt-BR':
        'Não conseguimos confirmar a janela de mensagens deste canal, então o envio foi bloqueado por segurança.',
      en: 'We could not confirm this channel’s messaging window, so the send was blocked for safety.',
    },
  },
  ONE_SHOT_ALREADY_USED: {
    code: 'ONE_SHOT_ALREADY_USED',
    category: 'POLICY',
    httpStatus: 409,
    retryable: false,
    message: {
      'pt-BR': 'Esta ação já foi usada para este alvo e não pode ser repetida.',
      en: 'This action was already used for this target and cannot be repeated.',
    },
  },
  CONTACT_UNSUBSCRIBED: {
    code: 'CONTACT_UNSUBSCRIBED',
    category: 'POLICY',
    httpStatus: 409,
    retryable: false,
    message: {
      'pt-BR': 'Este contato pediu para não receber mensagens.',
      en: 'This contact opted out of messages.',
    },
  },

  // ── Provider / limits
  PROVIDER_ERROR: {
    code: 'PROVIDER_ERROR',
    category: 'PROVIDER',
    httpStatus: 502,
    retryable: true,
    message: {
      'pt-BR': 'O canal externo respondeu com erro. Vamos tentar de novo automaticamente.',
      en: 'The external channel returned an error. We will retry automatically.',
    },
  },
  PROVIDER_TOKEN_INVALID: {
    code: 'PROVIDER_TOKEN_INVALID',
    category: 'PROVIDER',
    httpStatus: 409,
    retryable: false,
    message: {
      'pt-BR': 'A autorização desta conta expirou. Reconecte a conta para voltar a enviar.',
      en: 'This account’s authorization expired. Reconnect it to resume sending.',
    },
  },
  RATE_LIMITED: {
    code: 'RATE_LIMITED',
    category: 'RATE_LIMIT',
    httpStatus: 429,
    retryable: true,
    message: {
      'pt-BR': 'Muitas requisições agora. Aguarde um instante.',
      en: 'Too many requests right now. Please wait a moment.',
    },
  },

  // ── Flow / engine
  FLOW_INVALID: {
    code: 'FLOW_INVALID',
    category: 'VALIDATION',
    httpStatus: 422,
    retryable: false,
    message: {
      'pt-BR': 'Este fluxo tem erros que impedem a publicação.',
      en: 'This flow has errors that prevent publishing.',
    },
  },
  FLOW_NOT_PUBLISHED: {
    code: 'FLOW_NOT_PUBLISHED',
    category: 'CONFLICT',
    httpStatus: 409,
    retryable: false,
    message: {
      'pt-BR': 'Publique o fluxo antes de executá-lo.',
      en: 'Publish the flow before running it.',
    },
  },
  EXECUTION_STEP_BUDGET_EXCEEDED: {
    code: 'EXECUTION_STEP_BUDGET_EXCEEDED',
    category: 'POLICY',
    httpStatus: 409,
    retryable: false,
    message: {
      'pt-BR':
        'A execução passou do limite de passos. Provavelmente há um laço infinito no fluxo.',
      en: 'The execution exceeded its step budget. There is probably an infinite loop in the flow.',
    },
  },
  SSRF_BLOCKED: {
    code: 'SSRF_BLOCKED',
    category: 'POLICY',
    httpStatus: 400,
    retryable: false,
    message: {
      'pt-BR': 'Este endereço não é permitido para requisições externas.',
      en: 'This address is not allowed for outbound requests.',
    },
  },

  // ── Fallback
  INTERNAL_ERROR: {
    code: 'INTERNAL_ERROR',
    category: 'INTERNAL',
    httpStatus: 500,
    retryable: true,
    message: {
      'pt-BR':
        'Tivemos um problema interno e já registramos o ocorrido. Informe o código de rastreio ao suporte.',
      en: 'We hit an internal problem and logged it. Share the trace code with support.',
    },
  },
} as const satisfies Record<string, ErrorDefinition>;

export type ErrorCode = keyof typeof ERROR_CATALOG;

export interface Remediation {
  action: string;
  url?: string;
}

export interface DmFlowErrorPayload {
  code: ErrorCode;
  category: ErrorCategory;
  httpStatus: number;
  retryable: boolean;
  /** ids only — never PII, never secrets */
  context: Record<string, unknown>;
  cause?: string;
  attempt: number;
  nextRetryAt?: string;
  userMessage: string;
  remediation?: Remediation;
  correlationId: string;
  occurredAt: string;
  details?: unknown;
}

export class DmFlowError extends Error {
  readonly code: ErrorCode;
  readonly category: ErrorCategory;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly context: Record<string, unknown>;
  readonly attempt: number;
  readonly remediation?: Remediation;
  readonly details?: unknown;
  readonly upstreamCause?: string;
  correlationId: string;

  constructor(
    code: ErrorCode,
    options: {
      context?: Record<string, unknown>;
      cause?: string;
      attempt?: number;
      remediation?: Remediation;
      details?: unknown;
      correlationId?: string;
      retryable?: boolean;
    } = {},
  ) {
    const def = ERROR_CATALOG[code];
    super(`${code}: ${def.message.en}`);
    this.name = 'DmFlowError';
    this.code = code;
    this.category = def.category;
    this.httpStatus = def.httpStatus;
    this.retryable = options.retryable ?? def.retryable;
    this.context = options.context ?? {};
    this.attempt = options.attempt ?? 0;
    this.remediation = options.remediation;
    this.details = options.details;
    this.upstreamCause = options.cause;
    this.correlationId = options.correlationId ?? '';
  }

  toPayload(locale: Locale = DEFAULT_LOCALE): DmFlowErrorPayload {
    return {
      code: this.code,
      category: this.category,
      httpStatus: this.httpStatus,
      retryable: this.retryable,
      context: this.context,
      cause: this.upstreamCause,
      attempt: this.attempt,
      userMessage: localize(ERROR_CATALOG[this.code].message, locale),
      remediation: this.remediation,
      correlationId: this.correlationId,
      occurredAt: new Date().toISOString(),
      details: this.details,
    };
  }
}

export function isDmFlowError(value: unknown): value is DmFlowError {
  return value instanceof DmFlowError;
}
