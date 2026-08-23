import { z } from 'zod';

const hex64 = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hex characters (openssl rand -hex 32)');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_URL: z.string().url().default('http://localhost:4000'),
  WEB_URL: z.string().url().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  SESSION_SECRET: z.string().min(32),
  ENCRYPTION_KEY: hex64,

  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  STRIPE_PORTAL_RETURN_URL: z.string().url().default('http://localhost:3000/settings/billing'),
  BILLING_GRACE_DAYS: z.coerce.number().int().min(0).max(90).default(7),

  INSTAGRAM_PROVIDER: z.enum(['mock', 'live']).default('mock'),
  META_APP_ID: z.string().default(''),
  META_APP_SECRET: z.string().default(''),
  META_WEBHOOK_VERIFY_TOKEN: z.string().min(1).default('dmflow-verify-token'),
  META_API_VERSION: z.string().default(''),

  // Mail. The default transport writes the message to the log instead of sending
  // it, so the whole flow is exercisable without an SMTP dependency. Production
  // refuses to start on that default — see the cross-field check below.
  MAIL_TRANSPORT: z.enum(['log', 'smtp']).default('log'),
  MAIL_FROM: z.string().email().default('nao-responda@dmflow.local'),
  MAIL_FROM_NAME: z.string().default('DM FLOW'),
  SMTP_URL: z.string().default(''),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/**
 * The app refuses to start on bad configuration. A service that boots with a
 * missing encryption key and fails hours later, mid-send, is far worse than one
 * that never starts.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;

  // Heroku — and every platform that assigns a port — injects PORT and kills a
  // process that binds anything else. Honoured before API_PORT, because a
  // container that ignores the port it was given is a container that never
  // serves a request and gets terminated a minute later with a timeout.
  const withPlatformPort = source.PORT
    ? { ...source, API_PORT: source.PORT }
    : source;

  const parsed = envSchema.safeParse(withPlatformPort);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  const env = parsed.data;

  if (env.NODE_ENV === 'production') {
    if (env.INSTAGRAM_PROVIDER === 'live' && !env.META_API_VERSION) {
      throw new Error(
        'META_API_VERSION must be set explicitly when INSTAGRAM_PROVIDER=live. ' +
          'Never call an unversioned platform endpoint.',
      );
    }
    if (env.SESSION_SECRET.startsWith('change-me')) {
      throw new Error('SESSION_SECRET still holds its placeholder value.');
    }
    if (/^0+$/.test(env.ENCRYPTION_KEY)) {
      throw new Error('ENCRYPTION_KEY still holds its placeholder value.');
    }
    // The log transport is a development convenience that silently swallows every
    // message. Booting production with it would mean invitations and password
    // resets simply never arrive, with nothing to show that anything is wrong.
    if (env.MAIL_TRANSPORT === 'log') {
      throw new Error(
        'MAIL_TRANSPORT=log does not deliver anything. Set MAIL_TRANSPORT=smtp and SMTP_URL in production.',
      );
    }
  }

  if (env.MAIL_TRANSPORT === 'smtp' && !env.SMTP_URL) {
    throw new Error('MAIL_TRANSPORT=smtp requires SMTP_URL.');
  }

  cached = env;
  return env;
}

export function isBillingConfigured(env: Env): boolean {
  return env.STRIPE_SECRET_KEY.length > 0;
}
