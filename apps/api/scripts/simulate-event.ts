import { createHmac } from 'node:crypto';
import { loadEnv } from '../src/config/env';

/**
 * Fires a signed webhook at the local API exactly as the sandbox provider would,
 * so the whole ingestion path — signature, dedupe, normalisation, trigger match,
 * execution — is exercised rather than stubbed.
 */
const [, , kindArg, ...rest] = process.argv;
const kind = kindArg ?? 'comment';
const text = rest.join(' ') || 'eu quero esse link!';

const env = loadEnv();
const secret = env.META_APP_SECRET || env.SESSION_SECRET;
const account = process.env.SIM_ACCOUNT ?? 'ig_sandbox_loja_demo';
const sender = process.env.SIM_SENDER ?? `ig_user_${Math.floor(Math.random() * 100000)}`;

const base = {
  providerEventId: `evt_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
  externalAccountId: account,
  sender: {
    externalUserId: sender,
    username: process.env.SIM_USERNAME ?? 'pessoa.interessada',
    displayName: process.env.SIM_NAME ?? 'Pessoa Interessada',
  },
  occurredAt: new Date().toISOString(),
  text,
};

const events: Record<string, Record<string, unknown>> = {
  comment: {
    ...base,
    type: 'comment_created',
    commentId: `cmt_${Date.now()}`,
    mediaId: process.env.SIM_MEDIA ?? 'media_reel_demo',
  },
  dm: { ...base, type: 'message_received', externalMessageId: `msg_${Date.now()}` },
  story_reply: { ...base, type: 'story_reply', storyId: `story_${Date.now()}` },
  story_mention: { ...base, type: 'story_mention', storyId: `story_${Date.now()}` },
};

const event = events[kind];
if (!event) {
  console.error(`Unknown event kind "${kind}". Use one of: ${Object.keys(events).join(', ')}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const body = Buffer.from(JSON.stringify({ events: [event] }));
  const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

  const response = await fetch(`${env.API_URL}/webhooks/instagram`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
    body,
  });

  console.log(`${kind} -> ${response.status} ${await response.text()}`);
  console.log(`  account: ${account}`);
  console.log(`  sender:  ${sender}`);
  console.log(`  text:    "${text}"`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
