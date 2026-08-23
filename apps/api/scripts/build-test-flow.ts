import { loadEnv } from '../src/config/env';

/**
 * Builds the branching flow from the builder specification, through the same API
 * the interface uses.
 *
 * Its purpose is not to be published. It is a shape the canvas has to be able to
 * represent and persist: a sequence, a fork with several destinations, a
 * condition with two independent exits, a wait, and paths that converge.
 *
 *   Trigger
 *     └─ Message 1  "Olá! O que você deseja?"
 *          └─ Wait for reply
 *               ├─ "Quero saber mais" ─ Condition ─ yes ─ Message A
 *               │                                 └ no ── Message B
 *               ├─ "Não tenho interesse" ─ Delay ─ Message C
 *               ├─ any reply ─────────────────────── Message B
 *               └─ no reply ──────────────────────── End
 */
const env = loadEnv();
const API = `http://localhost:${env.API_PORT}`;
const EMAIL = process.env.SEED_EMAIL ?? 'demo@dmflow.app';
const PASSWORD = process.env.SEED_PASSWORD ?? 'dmflow-demo-2026';

async function main(): Promise<void> {
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!login.ok) throw new Error(`login failed: ${login.status} ${await login.text()}`);

  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
  const headers = { 'content-type': 'application/json', cookie };

  const me = await (await fetch(`${API}/auth/me`, { headers })).json();
  const workspaceId = me.workspaces[0].id;
  const scoped = { ...headers, 'x-dmflow-workspace': workspaceId };

  const [tags, fields] = await Promise.all([
    (await fetch(`${API}/tags`, { headers: scoped })).json(),
    (await fetch(`${API}/custom-fields`, { headers: scoped })).json(),
  ]);

  const created = await fetch(`${API}/automations`, {
    method: 'POST',
    headers: scoped,
    body: JSON.stringify({ name: `Cenário de teste ${new Date().toISOString().slice(0, 16)}` }),
  });
  if (!created.ok) throw new Error(`create failed: ${created.status} ${await created.text()}`);
  const automation = await created.json();

  const message = (id: string, text: string, x: number, y: number) => ({
    id,
    type: 'send_message',
    position: { x, y },
    config: { blocks: [{ type: 'text', text }], quickReplies: [], asPrivateReply: false },
  });

  const graph = {
    schemaVersion: 1,
    nodes: [
      { id: 'trigger-1', type: 'trigger', position: { x: 80, y: 320 }, config: {} },
      message('msg-1', 'Olá! O que você deseja?', 420, 320),
      {
        id: 'wait-1',
        type: 'wait_for_reply',
        position: { x: 760, y: 300 },
        config: {
          options: [
            {
              id: 'mais',
              label: 'Quero saber mais',
              match: { kind: 'keywords', keywords: ['quero', 'mais', 'sim'] },
            },
            {
              id: 'nao',
              label: 'Não tenho interesse',
              match: { kind: 'keywords', keywords: ['não', 'nao', 'depois'] },
            },
          ],
          timeoutAmount: 2,
          timeoutUnit: 'hours',
        },
      },
      {
        id: 'cond-1',
        type: 'condition',
        position: { x: 1120, y: 120 },
        config: {
          predicate: tags[0]
            ? { kind: 'condition', source: 'tag', field: tags[0].id, operator: 'is_set' }
            : { kind: 'always' },
        },
      },
      message('msg-a', 'Perfeito! Já mando o material completo.', 1460, 40),
      message('msg-b', 'Sem problema. Se mudar de ideia, é só chamar.', 1460, 220),
      {
        id: 'delay-1',
        type: 'delay',
        position: { x: 1120, y: 420 },
        config: {
          mode: 'duration',
          amount: 2,
          unit: 'days',
          resumeWindow: { enabled: true, startHour: 9, endHour: 20 },
        },
      },
      message('msg-c', 'Passando para saber se ainda faz sentido.', 1460, 420),
      { id: 'end-1', type: 'end', position: { x: 1460, y: 600 }, config: {} },
    ],
    edges: [
      { id: 'e-t-m1', source: 'trigger-1', target: 'msg-1', sourceHandle: null },
      { id: 'e-m1-w', source: 'msg-1', target: 'wait-1', sourceHandle: null },
      // One exit per answer, each going somewhere different.
      { id: 'e-w-cond', source: 'wait-1', target: 'cond-1', sourceHandle: 'mais' },
      { id: 'e-w-delay', source: 'wait-1', target: 'delay-1', sourceHandle: 'nao' },
      { id: 'e-w-any', source: 'wait-1', target: 'msg-b', sourceHandle: 'any' },
      { id: 'e-w-timeout', source: 'wait-1', target: 'end-1', sourceHandle: 'timeout' },
      // The condition's two exits are independent destinations.
      { id: 'e-c-yes', source: 'cond-1', target: 'msg-a', sourceHandle: 'true' },
      { id: 'e-c-no', source: 'cond-1', target: 'msg-b', sourceHandle: 'false' },
      { id: 'e-delay-c', source: 'delay-1', target: 'msg-c', sourceHandle: null },
      // Three paths converging on one ending, which the graph must allow.
      { id: 'e-a-end', source: 'msg-a', target: 'end-1', sourceHandle: null },
      { id: 'e-b-end', source: 'msg-b', target: 'end-1', sourceHandle: null },
      { id: 'e-c-end', source: 'msg-c', target: 'end-1', sourceHandle: null },
    ],
  };

  const saved = await fetch(`${API}/automations/${automation.id}/draft`, {
    method: 'PUT',
    headers: scoped,
    body: JSON.stringify({ graph }),
  });
  if (!saved.ok) throw new Error(`save failed: ${saved.status} ${await saved.text()}`);

  const accounts = await (await fetch(`${API}/channels`, { headers: scoped })).json();
  const trigger = await fetch(`${API}/automations/${automation.id}/triggers`, {
    method: 'POST',
    headers: scoped,
    body: JSON.stringify({
      type: 'ig_dm_keyword',
      connectedAccountId: accounts[0]?.id ?? null,
      config: { keywords: ['oi', 'ola', 'quero'] },
      enabled: true,
    }),
  });
  if (!trigger.ok) {
    // Loudly: a flow with no trigger cannot be published, and a silent failure
    // here would look like a validation bug in the builder.
    throw new Error(`trigger failed: ${trigger.status} ${await trigger.text()}`);
  }

  // Re-validate now that the trigger exists.
  const revalidated = await fetch(`${API}/automations/${automation.id}/draft`, {
    method: 'PUT',
    headers: scoped,
    body: JSON.stringify({ graph }),
  });
  const finalReport = (await revalidated.json()).validationReport;

  console.log(`automation: ${automation.id}`);
  console.log(`nodes: ${graph.nodes.length}  edges: ${graph.edges.length}`);
  console.log(`valid: ${finalReport.valid}`);
  for (const issue of finalReport.issues) {
    console.log(`  [${issue.severity}] ${issue.code}: ${issue.message['pt-BR']}`);
  }
  console.log(`open: http://localhost:3000/automations/${automation.id}`);
  console.log(`fields available: ${fields.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
