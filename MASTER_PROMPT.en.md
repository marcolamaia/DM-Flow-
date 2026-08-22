# MASTER PROMPT — BUILD "DM FLOW"

> **Language note:** this is the English edition. A complete Brazilian Portuguese edition
> lives at `MASTER_PROMPT.pt-BR.md`. Both are normative and kept in sync. Use whichever you
> prefer — do not mix, and do not translate section semantics loosely.

---

## 0. WHO YOU ARE AND WHAT THIS DOCUMENT IS

You are a senior full-stack engineering agent. You are going to build **DM FLOW**, a
multi-tenant SaaS platform for automating conversations on Instagram (with Facebook Messenger
and WhatsApp planned as later channels).

This document is your **complete specification**. It is self-sufficient: you should not need
any other input to know what to build, how to research, what you are forbidden from inventing,
and in what order to ship.

**Read this entire document before writing a single line of code.**

This document is written by an agent that was **unable to open Meta's official documentation**
(the research environment blocked `developers.facebook.com`). That is not a flaw in the plan —
it is the reason PHASE 0 exists and is mandatory. Every external-platform claim in this
document is labelled as a **hypothesis you must verify**, never as fact.

---

## 1. PRIME DIRECTIVES (violating any of these is a build failure)

### PD-1 — Never invent external platform behaviour
You must not invent, guess, extrapolate, or "reasonably assume" any of the following for
Instagram, Messenger, WhatsApp, or any Meta product:

- endpoint paths, HTTP methods, or base URLs
- request or response payload shapes
- permission / scope strings
- webhook field names, event names, or payload structures
- rate limits, quotas, or numeric caps
- messaging windows or their durations
- message tags
- account-type requirements
- policy rules

If you cannot confirm it in **Meta's current official documentation**, you do not implement it.
You mark it `PENDING_VALIDATION` in `docs/meta-capabilities.md`, you build the surrounding
system without it, and you move on. A missing feature is a normal outcome. A fabricated
feature is a defect that will fail in production, in front of a paying customer.

### PD-2 — Official documentation outranks everything
Priority order for any external-platform claim:

1. Meta's official developer documentation and official policy pages — **only acceptable source**
2. Official documentation of our own chosen technologies (Next.js, Prisma, BullMQ, etc.)
3. *(no third tier)*

Blogs, Medium posts, YouTube, Reddit, StackOverflow, vendor marketing pages, competitor docs,
and **this document itself** are **not** acceptable sources for a Meta capability. They may be
used only to find *where to look* — never as the basis of an implementation decision.

If a secondary source and the official docs disagree, the official docs win and you note the
discrepancy in `docs/known-limitations.md`.

### PD-3 — Deny by default
The system must be architected so that **an unverified capability is an unavailable capability**.
Not "available and hopefully works". Unavailable. Invisible in the UI. Rejected by the engine.

This is the single most important architectural consequence of PD-1. It is implemented by the
**Capability Engine** (§7). If you build the Capability Engine correctly, PD-1 becomes
structurally enforced rather than a rule you have to remember.

### PD-4 — Only authorised mechanisms
DM FLOW integrates with external platforms **exclusively** through official, documented,
sanctioned APIs with proper OAuth authorisation from the account owner.

Categorically forbidden, with no exception, no "just for testing", no "temporarily":

- scraping any Instagram/Meta surface
- browser automation / headless browser driving a logged-in session
- storing or using end-user passwords for Meta accounts
- session cookie reuse, stolen or borrowed sessions
- reverse-engineered or undocumented private/internal endpoints
- unofficial libraries that emulate the mobile or web client
- any technique whose purpose is to evade rate limits, detection, or review

If a desirable product feature can only exist via one of the above, the feature **does not
exist in DM FLOW**. Document it in `docs/known-limitations.md` under "Deliberately not built".

### PD-5 — Record the date and the version
Every external capability you validate must be recorded with:
- the exact documentation URL you read
- the date you read it
- the API version the documentation describes

APIs change. A capability validated eight months ago is a hypothesis again.

### PD-6 — Never fabricate metrics
Analytics may only display numbers derived from data DM FLOW actually observed and stored.
No estimated reach, no inferred impressions, no placeholder charts with sample data shipped
to production. If a metric cannot be computed from real data, it is not in the product.

### PD-7 — Ask, don't guess, on product ambiguity
If this document is ambiguous about **product behaviour**, choose the simplest coherent
option, implement it, and record the decision in `docs/architecture.md` under "Assumptions".
If this document is ambiguous about **external platform behaviour**, PD-1 applies: stop and
validate. Never resolve an external ambiguity by choosing.

---

## 2. PRODUCT VISION

### 2.1 What DM FLOW is

DM FLOW turns **public engagement into private conversation, automatically**.

Someone comments on a post, replies to a story, mentions the account, or sends a DM.
DM FLOW recognises that event, and runs a visual automation the account owner built — sending
a reply, tagging the person, branching on what is known about them, waiting, and continuing.
Every person touched becomes a persistent, segmentable **Contact** owned by the business.

### 2.2 Who it is for

- Creators and infoproducers who monetise an Instagram audience
- E-commerce and local businesses doing sales and support in DMs
- Agencies and social media teams managing multiple client accounts
- Support and sales teams that need a shared inbox on top of automation

### 2.3 Value proposition

1. **Speed** — replies in seconds, not hours, at any hour.
2. **Capture** — engagement stops being ephemeral; it becomes an owned contact record.
3. **Segmentation** — tags and custom fields make an audience addressable.
4. **Visibility** — the operator sees what ran, what worked, and what failed, per step.
5. **Safety** — the product refuses to build automations the platform would punish.

Point 5 is a differentiator, not a limitation. Competitors let users build flows that silently
fail or get accounts restricted. DM FLOW tells the user *before* they build.

### 2.4 Explicit product limits (tell the user these, in the UI)

- DM FLOW cannot start a conversation with someone who has not interacted first,
  if the platform forbids it. ⟨VERIFY: H23⟩
- DM FLOW's conversation history begins when the account is connected, and may not
  reflect the full history visible in the Instagram app. ⟨VERIFY: H18⟩
- DM FLOW cannot guarantee delivery outside a platform's messaging window. ⟨VERIFY: H04⟩
- DM FLOW is not an Instagram client. It does not browse, follow, like, or post on behalf
  of the user unless a validated official API supports it and the user authorised it.

These limits go in the product's own help content and empty states. Being honest here
prevents the single worst support outcome: a user believing the tool broke, when the platform
never allowed it.

### 2.5 What DM FLOW is not

Manychat is a **conceptual reference for the product category** — nothing else.
Do not copy its code, visual identity, copy, logo, icons, illustrations, assets, layouts, or
proprietary feature names. Use the generic vocabulary of the category: workflow builder, node,
edge, trigger, action, condition, delay, inbox, contact, segment, analytics.

Design DM FLOW's own architecture, UX, information hierarchy, and visual language.

---

## 3. THE THREE LAYERS (classify every feature before building it)

Before you implement anything, decide which layer it belongs to. This classification changes
how you build it, how you test it, and whether you may ship it at all.

### LAYER 1 — Internal DM FLOW functionality
Fully under our control. No external dependency. Build with confidence.

Dashboard · workspaces · users · roles · permissions · contacts database · tags ·
custom fields · segments · flow builder · flow versioning · automation engine ·
conditions · delays · internal analytics · execution history · logs · audit log ·
templates · settings · billing · notifications · i18n

### LAYER 2 — External-API-dependent functionality
Every one of these requires PHASE 0 validation before implementation.

Connecting an account (OAuth) · receiving a DM · sending a DM · receiving a comment ·
replying to a comment · comment-to-DM private reply · story reply events ·
story mention events · sending media · quick replies / buttons · ice breakers ·
reading conversation history · human handoff window extension

Build these **behind a provider interface** (§8) and **behind the Capability Engine** (§7).
Never call an external API directly from a service, controller, or engine node.

### LAYER 3 — Forbidden or unavailable
Never built, never simulated, never "worked around".

Anything from PD-4 · cold broadcasts if the platform forbids them ⟨VERIFY: H23/H24⟩ ·
any feature that requires a private endpoint · any feature that only works by pretending
to be a human user

When a user asks for a Layer 3 feature, the product's answer is an honest explanation of why
it does not exist, not a degraded imitation.

---

## 4. PHASE 0 — MANDATORY CAPABILITY VALIDATION (do this first, before any integration code)

You may build Layer 1 scaffolding in parallel, but **no Layer 2 line of code exists until its
row in `docs/meta-capabilities.md` is filled in with a real reading of official docs.**

### 4.1 Documentation URLs to read

Open and read each of these. They were confirmed to exist in a search index on 2026-08-22,
but their contents were **not** read. Verify they still resolve; if one 404s, find the current
equivalent and record the change.

**Instagram Platform — foundation**
- `https://developers.facebook.com/docs/instagram-platform`
- `https://developers.facebook.com/docs/instagram-platform/overview/`
- `https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login`
- `https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login`

**Messaging**
- `https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/`
- `https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/conversations-api/`
- `https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/ice-breakers/`
- `https://developers.facebook.com/docs/messenger-platform/instagram/features/private-replies/`
- `https://developers.facebook.com/docs/messenger-platform/instagram/features/story-mention/`
- `https://developers.facebook.com/docs/messenger-platform/conversations/`

**Webhooks**
- `https://developers.facebook.com/docs/instagram-platform/webhooks`
- `https://developers.facebook.com/docs/graph-api/webhooks/reference/instagram`
- `https://developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-instagram/`

**Policy, limits, review**
- `https://developers.facebook.com/documentation/business-messaging/messenger-platform/policy`
- `https://developers.facebook.com/docs/graph-api/overview/rate-limiting/`
- `https://developers.facebook.com/docs/instagram-api/changelog/`
- Meta Platform Terms, Meta Developer Policies, Instagram Platform Policy — locate current URLs
- Meta App Review and Business Verification documentation — locate current URLs

### 4.2 ⚠️ First thing to resolve: which documentation tree is canonical

Search indexing revealed the **same topics under two different paths**:

```
developers.facebook.com/docs/instagram-platform/webhooks
developers.facebook.com/documentation/instagram-platform/webhooks

developers.facebook.com/docs/messenger-platform/instagram/features/ice-breakers/
developers.facebook.com/documentation/business-messaging/instagram-messaging/features/ice-breakers
```

This suggests Meta is migrating `/docs/` → `/documentation/`, and the two trees may differ.
**Determine which is current, and record the answer at the top of `docs/meta-capabilities.md`.**
Building against a stale tree is a real and silent failure mode.

### 4.3 Questions PHASE 0 must answer

Answer each with a citation. "I think" is not an answer. If a question cannot be answered from
official docs, the answer is `NOT_CONFIRMED` and every feature depending on it is not built.

**Authentication & accounts**
1. Which API paths exist today, and what does each support?
2. Which account types can be used (Business / Creator / Personal), and is there feature parity?
3. Is a linked Facebook Page required, for which path, and for which features?
4. What are the exact permission strings needed for: reading DMs, sending DMs, reading
   comments, replying to comments, private replies?
5. What token types exist, what is their lifetime, and exactly how are they refreshed?
6. What must be requested together in a single App Review submission?
7. What can be tested without App Review, and with how many test users?

**Webhooks**
8. What is the authoritative list of Instagram webhook fields available today?
9. For each field we need: exact name, exact payload shape, delivery guarantees.
10. How is webhook authenticity verified — exact header name, algorithm, and signing secret?
11. What is the required response (status code, body, timing) to a webhook delivery?
12. What is the retry behaviour when we fail to respond?
13. Does a `live_comments` field still exist, or was it deprecated? In which version?

**Messaging**
14. What is the exact endpoint and payload for sending a message?
15. Which message types are supported **on Instagram specifically** (not Messenger)?
    Text, image, video, audio, quick replies, buttons, generic template, media share?
16. What are the exact limits: number of quick replies, character counts, media size/format?
17. Do buttons and quick replies render on all Instagram surfaces, or mobile app only?
18. What is the messaging window duration, what resets it, and what may be sent inside it?
19. What may be sent **outside** the window? Which message tags exist for Instagram today?
20. Does a human-agent window extension exist for Instagram? Duration? Requirements?
21. Can a business initiate a conversation with a user who never messaged first?

**Comments and private replies**
22. Which event fires when someone comments on a post or reel?
23. How long after a comment may a private reply be sent?
24. How many private replies are permitted per comment — per app, per user, ever?
25. Is any additional user interaction required before a private reply is allowed?
26. Does comment coverage include reels, and does it include comment replies (nested)?
27. What permission is needed to reply publicly to a comment, and is it separate from messaging?

**Stories**
28. How do story replies and story mentions arrive, and how are they distinguished in payload?
29. Are there separate windows or restrictions for story-originated conversations?

**Conversation history**
30. What can the Conversations API return, and what is the actual limit on message detail?
31. Can we retrieve history that predates our app's connection to the account?

**Limits**
32. What is the real rate-limit model? Per app, per account, per endpoint?
33. Which response headers report current usage, so limits can be discovered at runtime?
34. What error codes indicate throttling, and what is the correct backoff?

**Policy**
35. What automated messaging is explicitly prohibited?
36. Is disclosing automation to the user a recommendation or a requirement?
37. What are the consequences and enforcement mechanisms for violations?

### 4.4 The output format: `docs/meta-capabilities.md`

This file is the **single source of truth** for what DM FLOW is allowed to do. The Capability
Engine (§7) is seeded from it. Nothing else in the codebase may assert an external capability.

One row per capability:

```markdown
### CAP_IG_SEND_TEXT

| Field | Value |
|---|---|
| Capability ID   | CAP_IG_SEND_TEXT |
| Channel         | instagram |
| Status          | AVAILABLE_OFFICIAL_API / AVAILABLE_WITH_RESTRICTIONS / REQUIRES_APP_REVIEW / REQUIRES_ADVANCED_ACCESS / DEPENDS_ON_ACCOUNT_TYPE / DEPENDS_ON_CHANNEL / NOT_AVAILABLE / NOT_CONFIRMED |
| Official doc    | <exact URL read> |
| Date validated  | YYYY-MM-DD |
| API version     | <version the doc describes> |
| Permissions     | <exact scope strings, or NOT_CONFIRMED> |
| Account types   | <exact, or NOT_CONFIRMED> |
| Endpoint        | <exact method + path, or NOT_CONFIRMED> |
| Preconditions   | <messaging window state, prior interaction, etc.> |
| Limits          | <exact documented limits; note if discovered at runtime instead> |
| Policy notes    | <what the policy forbids around this> |
| Error modes     | <documented error codes and meanings> |
| Confidence      | CONFIRMED / PARTIAL / UNCONFIRMED |
| Notes           | <ambiguities, open questions> |
```

**Rules for this file:**
- A capability with `Status: NOT_CONFIRMED` **must not** be implemented, exposed in the UI,
  or referenced by any node type.
- A row with an empty `Date validated` is invalid.
- Re-validation is required if the row is older than 90 days. Add a CI check that fails the
  build when a row exceeds that age. This turns doc rot into a visible, blocking event.

### 4.5 Known conflicting secondary claims — resolve, do not inherit

The research that produced this document found **secondary sources contradicting each other**.
Listed here only so you know which numbers are landmines. **None of these may be used.**

| Topic | Conflicting claims found | Action |
|---|---|---|
| DM rate limit | 200/hour · 750/hour · 5,000/hour · 2 calls/sec · 100 calls/sec | Discover at runtime from usage headers. Never hardcode. |
| Private replies per comment | "one per comment, ever" | Verify (Q24). Treat as one-shot until proven otherwise. |
| Private reply window | "7 days" | Verify (Q23). |
| Quick reply count | "up to 13" | Verify (Q16). |
| Ice breakers | "max 4" | Verify (Q16/Q20). |
| Conversation history | "only 20 most recent messages have detail" | Verify (Q30). Has major Inbox consequences. |
| Human agent window | "7 days via HUMAN_AGENT tag" | Verify (Q20) — and verify it applies to Instagram at all. |
| Persistent menu on Instagram | claimed by some vendors | Verify (Q15). May not exist. |

---

## 5. SCOPE AND SEQUENCING

Do not attempt to build everything at once. Ship a working vertical slice, then widen.

### MVP — one channel, one loop, done properly
The goal of the MVP is a **single trustworthy loop**: connect Instagram → receive an event →
run a flow → send a reply → see it in analytics and inbox.

- Auth: email + password, sessions, password reset, 2FA optional
- Workspaces, members, the 5 roles, invitations
- Instagram account connection via OAuth (whichever path PHASE 0 validates)
- Webhook ingestion: signature verification, dedupe, persistence, queue
- Contacts with system fields, tags, custom fields
- Conversations and messages (our own ledger)
- Flow Builder with: Trigger, Send Message (text), Condition, Delay, Add Tag, Remove Tag,
  Set Custom Field, End
- Draft / publish / versioning
- Automation engine with durable executions and resumable delays
- Triggers: only those PHASE 0 confirms — realistically DM keyword, DM default reply,
  and comment→private reply if validated
- Execution history with per-step detail
- Basic analytics: executions, completions, failures, per-node counts
- Integration status surface (§23)
- Error taxonomy (§24)
- Structured logs, metrics, traces
- i18n: en + pt-BR

### V1 — the product becomes competitive
- Shared Inbox with assignment, statuses, internal notes, human handoff
- Rich message nodes: media, quick replies, buttons — each gated by Capability Engine
- Story reply and story mention triggers (if validated)
- Segments (saved filters) reused across conditions and audiences
- Templates: export/import automation logic
- External Request node with SSRF protection
- Outbound webhooks and an event bus for customers
- Richer analytics: funnel per flow, drop-off per node, trigger performance
- Audit log UI
- Team performance analytics for Inbox

### V2 — second channel
- Facebook Messenger, with its **own** capability matrix, its own PHASE 0, its own provider.
  Do not reuse Instagram's assumptions. The channels differ.
- Multi-account and multi-channel contact identity resolution
- A/B branching and experiments

### V3 — WhatsApp
- WhatsApp Business Platform (Cloud API): WABA, phone numbers, message templates and their
  approval categories, service window, opt-in requirements, quality rating, pricing.
- This channel has fundamentally different rules — especially opt-in and templates.
  It requires its own full research pass, its own matrix, its own UI concepts.
  **Do not model WhatsApp as "Instagram with a different provider".**

### Future / deliberately deferred
- AI-assisted reply nodes
- Public template marketplace
- Native e-commerce integrations
- White-label for agencies
- Mobile apps

---

## 6. ARCHITECTURE AND STACK (fixed — deviate only with written justification)

### 6.1 The stack

| Layer | Choice | Rationale |
|---|---|---|
| Language | TypeScript, strict | One type model from canvas node to provider payload |
| Frontend | Next.js (App Router) + React | SSR shell, server components for heavy lists |
| UI | Tailwind + Radix primitives + own design system | Real accessibility without a recognisable third-party look |
| Canvas | React Flow (`@xyflow/react`) | Solved pan/zoom/handles/minimap; do not hand-roll |
| Client data | TanStack Query | Cache and invalidation without a global store |
| Backend | NestJS | Modules and DI matter with pluggable providers and an engine |
| Database | PostgreSQL 16+ | Transactions, JSONB, partial/GIN indexes, `FOR UPDATE SKIP LOCKED` |
| ORM | Prisma + raw SQL where needed | Typed migrations; raw SQL for analytics and locking |
| Cache/locks | Redis | Dedupe, distributed locks, rate counters, presence |
| Queues | BullMQ | Backoff, **delayed jobs** (required by Delay nodes), DLQ |
| Realtime | WebSocket + Redis adapter | Live inbox, execution status |
| Storage | S3-compatible + presigned URLs | Never proxy media through the app server |
| Our auth | httpOnly session cookie + rotating refresh; optional TOTP | JWT in localStorage is an XSS-to-takeover path |
| Secrets | AES-256-GCM, envelope encryption, key in KMS | Channel tokens are the crown jewels |
| Observability | OpenTelemetry + Pino (JSON) + Sentry | Trace must span webhook → queue → execution → API call |
| Testing | Vitest, Supertest, Playwright, Testcontainers | Real Postgres and Redis in integration tests |
| Deploy | Docker; separate `web`, `api`, `worker`, `scheduler` processes | See 6.2 |

### 6.2 Process topology — this is not negotiable

Run **four separate process types**:

```
web        Next.js frontend
api        HTTP API + webhook receiver + WebSocket gateway
worker     BullMQ consumers: event processing, flow execution, outbound API calls
scheduler  timers: delayed execution wakeups, token refresh, retention jobs, health checks
```

The webhook receiver must never share a thread pool with flow execution. If a slow automation
can delay a webhook response, then a traffic spike causes **lost webhook deliveries** — and a
lost delivery is data that no longer exists anywhere. Isolation here is a correctness property,
not an optimisation.

### 6.3 Request path for an inbound event

```
Meta → POST /webhooks/instagram
         ├─ verify signature                     (reject 401 if invalid)
         ├─ persist raw payload to WebhookEvent  (append-only)
         ├─ enqueue job with WebhookEvent id
         └─ return 200 immediately               (target < 200ms, always)
                    ↓
worker → dedupe by provider event id (Redis SETNX + DB unique constraint)
       → normalise into internal NormalizedEvent
       → resolve workspace / connected account / channel
       → resolve or create Contact + Conversation + Message
       → match published triggers
       → create Execution(s)
       → run the engine loop
```

The HTTP handler does **three** things: verify, persist, enqueue. Any logic beyond that belongs
in the worker.

---

## 7. THE CAPABILITY ENGINE (the heart of PD-1 and PD-3)

This is the most important internal subsystem in DM FLOW. Build it early — before the Flow
Builder, before any provider — because everything else depends on it.

### 7.1 What it does

It answers one question, at three different times, with the same logic:

> **"Is this action permitted, right now, for this channel, account, contact, and conversation state?"**

- **Design time** — the Flow Builder asks it to decide which nodes to show and which
  configurations to allow. A user must not be able to draw an impossible flow.
- **Publish time** — flow validation asks it to reject a flow that references a capability
  no longer available (e.g. permission revoked since the flow was built).
- **Run time** — the engine asks it immediately before executing an action node.

The same decision function serves all three. Divergence between design-time and run-time rules
is a category of bug that produces flows that look valid and fail silently in production.

### 7.2 Inputs to a capability decision

```
capabilityId          e.g. CAP_IG_SEND_QUICK_REPLIES
channel               instagram | messenger | whatsapp
connectedAccount      account type, granted scopes, token state, app review status
conversationState     last inbound message timestamp, window state, origin event type
originEvent           what started this execution (comment / DM / story reply / manual)
actionContext         e.g. the comment id, and whether a private reply was already used
now                   timestamp (windows are time-dependent)
```

### 7.3 Output

Never a boolean. A structured decision:

```ts
type CapabilityDecision =
  | { allowed: true; constraints?: CapabilityConstraint[] }
  | { allowed: false; reason: CapabilityDenialReason; userMessage: LocalizedMessage;
      remediation?: Remediation }

type CapabilityDenialReason =
  | 'NOT_VALIDATED'            // no confirmed row in meta-capabilities registry
  | 'MISSING_PERMISSION'       // scope not granted
  | 'ACCOUNT_TYPE_UNSUPPORTED'
  | 'APP_REVIEW_REQUIRED'
  | 'ADVANCED_ACCESS_REQUIRED'
  | 'OUTSIDE_MESSAGING_WINDOW'
  | 'ONE_SHOT_ALREADY_USED'    // e.g. private reply already sent for this comment
  | 'TOKEN_INVALID'
  | 'RATE_LIMITED'
  | 'POLICY_PROHIBITED'
```

The `userMessage` is what the operator sees. It must explain the cause in plain language and,
where possible, offer `remediation` (reconnect the account, request the permission, wait for
the contact to reply). Never surface a raw provider error to the operator.

### 7.4 The capability registry

Capabilities are **data, not code**. Seed them from `docs/meta-capabilities.md` into a
versioned registry (a checked-in TypeScript/JSON manifest, loaded at boot and cached).

A capability entry carries: id, channel, status, required scopes, required account types,
window requirements, one-shot semantics, documented limits, the validation date, and the
doc URL.

**Hard rule:** a capability whose status is not one of the "available" statuses resolves to
`allowed: false, reason: 'NOT_VALIDATED'` — always, everywhere, with no override flag.
There is no environment variable that turns this off. If someone needs to bypass it, the
correct action is to validate the capability and update the registry.

### 7.5 Messaging window state as a first-class domain concept

Because window rules govern whether an action is legal, the system must always know the
window state of a conversation. Model it explicitly on `Conversation`:

```
lastInboundAt          when the contact last messaged us
windowState            OPEN | EXTENDED | CLOSED | UNKNOWN
windowExpiresAt        computed from validated rules — never from a guessed constant
windowBasis            which validated rule produced this (registry reference)
```

`windowExpiresAt` must be derived from the **validated** capability registry. If the window
rule is `NOT_CONFIRMED`, `windowState` is `UNKNOWN` and sending is denied. That is the correct
behaviour: refusing to send is recoverable, sending in violation of policy may not be.

---

## 8. META INTEGRATION LAYER (providers)

### 8.1 The rule

No Meta API call may originate anywhere except inside a provider. Not in a controller, not in
a service, not in an engine node, not in a script. Grep for the HTTP client in the codebase:
every hit must be inside `src/providers/`.

### 8.2 Provider interface

Each channel implements a common interface. **The interface is defined by our domain, not by
Meta's API shape** — that is what makes it possible to add channels without rewriting the engine.

```ts
interface ChannelProvider {
  readonly channel: Channel

  // ---- Authorisation
  getAuthorizationUrl(params: AuthStartParams): string
  completeAuthorization(callback: AuthCallbackParams): Promise<ConnectedAccountDraft>
  refreshCredentials(account: ConnectedAccount): Promise<CredentialRefreshResult>
  revoke(account: ConnectedAccount): Promise<void>
  getAccountHealth(account: ConnectedAccount): Promise<AccountHealth>

  // ---- Webhooks
  verifyWebhookSignature(rawBody: Buffer, headers: Headers): boolean
  handleVerificationChallenge(query: Record<string, string>): string | null
  normalizeWebhook(raw: unknown): NormalizedEvent[]

  // ---- Outbound actions (each one gated by the Capability Engine before it is called)
  sendMessage(ctx: SendContext, message: OutboundMessage): Promise<SendResult>
  replyToComment?(ctx: CommentContext, body: string): Promise<SendResult>
  sendPrivateReply?(ctx: CommentContext, message: OutboundMessage): Promise<SendResult>

  // ---- Reads
  fetchConversations?(account: ConnectedAccount, cursor?: string): Promise<Page<RemoteConversation>>
  fetchMessages?(account: ConnectedAccount, conversationId: string, cursor?: string): Promise<Page<RemoteMessage>>

  // ---- Introspection
  describeCapabilities(account: ConnectedAccount): Promise<CapabilitySnapshot>
}
```

Optional methods (`?`) exist because **not every channel supports every action**, and a channel
must be able to honestly declare that it does not. Never implement a method by faking it.

### 8.3 Implementation constraints

- Methods are implemented **only** for capabilities validated in PHASE 0. An unvalidated method
  throws `CapabilityNotValidatedError` — it does not "try anyway".
- All endpoint paths, scope strings, field names, and version strings live in **one constants
  file per provider**, each annotated with the doc URL and validation date. Never inline them.
- The API version is explicit and configurable. Never call an unversioned endpoint.
- Every provider call goes through a shared HTTP client with: timeout, retry policy that
  distinguishes retryable from terminal errors, circuit breaker, rate limiter fed by response
  headers, and full request/response logging **with secrets redacted**.
- Every provider call emits an OpenTelemetry span with channel, capability id, account id,
  and outcome.

### 8.4 Rate limiting: discover, do not hardcode

Research found secondary sources disagreeing by a factor of 25 on Instagram send limits.
Therefore:

- Parse the platform's usage headers on every response and store current usage per account.
- Implement a token-bucket limiter whose capacity is **adjusted from observed headers**,
  starting from a deliberately conservative floor.
- On a throttling error, back off exponentially with jitter and lower the local ceiling.
- Expose current usage per connected account in the UI so operators can see headroom.

A hardcoded constant taken from a blog will either throttle customers unnecessarily or get
their accounts flagged. Both are worse than a self-tuning limiter.

---

## 9. MULTI-TENANT DATA MODEL

### 9.1 Tenancy rules

- `Workspace` is the tenant boundary. **Every** tenant-scoped table carries `workspaceId`.
- Enable PostgreSQL **Row Level Security** on every tenant-scoped table, with policies keyed
  to a session variable set per request/job. Application-level filtering alone is one forgotten
  `where` clause away from a cross-tenant data leak.
- Every tenant-scoped query path must be covered by a test that asserts workspace B cannot read
  workspace A's rows.
- Primary keys: UUID v7 (time-sortable, avoids index hotspots, non-enumerable).
- All timestamps `timestamptz`, stored UTC. Workspace timezone is a display and scheduling
  concern, stored on `Workspace`.
- Soft-delete (`deletedAt`) for user-facing entities; hard-delete only for LGPD erasure (§19).

### 9.2 Entities

Validate and improve this model — it is a strong starting point, not a finished schema.

**Identity & tenancy**
- `User` — id, email (citext, unique), passwordHash (argon2id), name, avatarUrl, locale,
  totpSecret (encrypted), emailVerifiedAt, lastLoginAt, timestamps
- `Workspace` — id, name, slug, timezone, locale, planId, status, timestamps
- `WorkspaceMember` — id, workspaceId, userId, role, invitedBy, joinedAt; unique(workspaceId, userId)
- `Invitation` — id, workspaceId, email, role, token (hashed), expiresAt, acceptedAt
- `Session` — id, userId, refreshTokenHash, userAgent, ip, expiresAt, revokedAt

**Channel connection**
- `ConnectedAccount` — id, workspaceId, channel, externalAccountId, username, displayName,
  avatarUrl, accountType, grantedScopes (text[]), accessTokenEnc, refreshTokenEnc,
  tokenExpiresAt, status, lastHealthCheckAt, lastErrorCode, connectedByUserId, timestamps;
  unique(channel, externalAccountId) — one external account, one workspace
- `ChannelSubscription` — id, connectedAccountId, webhookFields (text[]), subscribedAt,
  status, lastVerifiedAt

**People & conversations**
- `Contact` — id, workspaceId, primaryChannel, displayName, avatarUrl, locale, timezone,
  status (ACTIVE / UNSUBSCRIBED / BLOCKED), source, firstSeenAt, lastInteractionAt,
  consentState, consentUpdatedAt, timestamps
- `ContactIdentity` — id, workspaceId, contactId, channel, connectedAccountId,
  externalUserId, username, timestamps; unique(channel, connectedAccountId, externalUserId).
  **Separate from Contact so one person can be unified across channels later.**
- `Conversation` — id, workspaceId, contactId, connectedAccountId, channel,
  externalConversationId, status (OPEN / SNOOZED / CLOSED), assigneeId, lastInboundAt,
  lastOutboundAt, windowState, windowExpiresAt, windowBasis, unreadCount, timestamps
- `Message` — id, workspaceId, conversationId, direction (INBOUND / OUTBOUND),
  externalMessageId, senderType (CONTACT / AUTOMATION / AGENT / SYSTEM), senderUserId,
  contentType, content (jsonb), attachments (jsonb), status (QUEUED / SENT / DELIVERED /
  FAILED), failureCode, executionId, sentAt, timestamps;
  unique(workspaceId, externalMessageId) where externalMessageId is not null
- `ConversationNote` — id, workspaceId, conversationId, authorUserId, body, timestamps

**Segmentation**
- `Tag` — id, workspaceId, name, color, description; unique(workspaceId, name)
- `ContactTag` — contactId, tagId, appliedAt, appliedBy (jsonb: user or automation);
  primary key(contactId, tagId)
- `CustomField` — id, workspaceId, key, label, type (TEXT / NUMBER / BOOLEAN / DATE /
  DATETIME / SELECT), options (jsonb), scope (CONTACT), timestamps; unique(workspaceId, key)
- `CustomFieldValue` — id, workspaceId, contactId, customFieldId, value (jsonb);
  unique(contactId, customFieldId)
- `Segment` — id, workspaceId, name, filter (jsonb — the predicate AST), timestamps

**Automation**
- `Automation` — id, workspaceId, name, description, status (DRAFT / PUBLISHED / PAUSED /
  ARCHIVED), publishedVersionId, draftVersionId, folderId, createdBy, timestamps
- `AutomationVersion` — id, workspaceId, automationId, versionNumber, graph (jsonb),
  schemaVersion, publishedAt, publishedBy, changelog, validationReport (jsonb).
  **Immutable once published.**
- `Trigger` — id, workspaceId, automationId, automationVersionId, type, channel,
  connectedAccountId, config (jsonb), matchPriority, enabled, timestamps
- `Node` and `Edge` — may be normalised tables or live inside `AutomationVersion.graph` as
  JSONB. **Recommendation: JSONB inside the version.** A published version must be an
  atomic, immutable snapshot; normalised rows make that harder and buy little, since the graph
  is always read whole. Index what you need to query (trigger types, capability references)
  into separate columns or a projection table.

**Execution**
- `Execution` — id, workspaceId, automationId, automationVersionId, contactId,
  conversationId, triggerId, triggerEventId, status (RUNNING / WAITING / COMPLETED /
  FAILED / CANCELLED), currentNodeId, variables (jsonb), resumeAt, attemptCount,
  startedAt, finishedAt, lastError (jsonb), timestamps
- `ExecutionStep` — id, workspaceId, executionId, nodeId, nodeType, sequence, status,
  input (jsonb), output (jsonb), errorCode, errorDetail (jsonb), startedAt, finishedAt,
  durationMs
- `IdempotencyRecord` — id, workspaceId, scope, key, resultRef, createdAt, expiresAt;
  unique(workspaceId, scope, key). **This is what protects one-shot actions like private replies.**

**Events & integrations**
- `WebhookEvent` — id, workspaceId (nullable until resolved), channel, providerEventId,
  receivedAt, rawPayload (jsonb), signatureValid, status (RECEIVED / PROCESSING / PROCESSED /
  FAILED / DISCARDED), processedAt, attemptCount, lastError, dedupeKey;
  unique(channel, providerEventId). **Append-only.** This table is what makes event replay possible.
- `OutboundWebhook` — id, workspaceId, url, secret (encrypted), events (text[]), enabled, timestamps
- `OutboundWebhookDelivery` — id, workspaceId, outboundWebhookId, eventType, payload (jsonb),
  responseStatus, attemptCount, nextAttemptAt, status
- `Integration` — id, workspaceId, type, name, config (jsonb, secrets encrypted), status, timestamps
- `AutomationTemplate` — id, workspaceId (nullable for global), name, description, category,
  graph (jsonb), requiredCapabilities (text[]), createdBy, visibility, timestamps

**Governance**
- `AuditLog` — id, workspaceId, actorType (USER / SYSTEM / AUTOMATION), actorUserId, action,
  entityType, entityId, before (jsonb), after (jsonb), ip, userAgent, createdAt.
  **Append-only, never updated or deleted by application code.**
- `ApiKey` — id, workspaceId, name, keyHash, prefix, scopes (text[]), lastUsedAt, expiresAt,
  revokedAt, createdBy
- `DataSubjectRequest` — id, workspaceId, contactId, type (EXPORT / ERASURE), status,
  requestedAt, completedAt, requestedBy, artifactRef

### 9.3 Indexing and retention

- Index every foreign key used in a hot path.
- Composite indexes matching real access patterns:
  `(workspaceId, lastInteractionAt DESC)` on Contact,
  `(workspaceId, status, assigneeId)` on Conversation,
  `(conversationId, createdAt DESC)` on Message,
  `(workspaceId, automationId, startedAt DESC)` on Execution,
  `(status, resumeAt)` on Execution — this one drives the scheduler.
- Partition or time-roll the high-volume append-only tables (`WebhookEvent`, `ExecutionStep`,
  `Message`) from day one. Retrofitting partitioning under load is painful.
- Retention policy is configurable per workspace and enforced by a scheduled job (§19).

---

## 10. EVENT INGESTION

### 10.1 Receiving

```
POST /webhooks/:channel
  1. Read the RAW body — signature verification requires exact bytes.
     Configure the framework to preserve the raw buffer before JSON parsing.
  2. Verify the signature via provider.verifyWebhookSignature().
     Invalid → 401, log, do not process, do not retry.
  3. Insert WebhookEvent (append-only) with rawPayload and providerEventId.
     Unique constraint on (channel, providerEventId) makes duplicate inserts harmless.
  4. Enqueue { webhookEventId } onto the ingestion queue.
  5. Return 200. Target p99 < 200ms.

GET /webhooks/:channel
  Verification challenge handshake, per provider.handleVerificationChallenge().
```

**Never** do business logic in the HTTP handler. If step 4 fails, still return 200 — the event
is persisted and a reconciliation job will pick it up. Returning non-200 causes the platform to
retry, which is fine, but persisting-then-failing-to-enqueue must not lose the event.

### 10.2 Processing

```
worker:
  1. Load WebhookEvent, mark PROCESSING (with optimistic locking on attemptCount)
  2. Dedupe: Redis SETNX on dedupeKey with TTL, backed by the DB unique constraint
  3. provider.normalizeWebhook(raw) → NormalizedEvent[]
     A single delivery may contain multiple logical events. Handle each independently.
  4. For each NormalizedEvent:
       resolve ConnectedAccount by external account id → workspace
       unknown account → status DISCARDED with a reason (do NOT error-loop on it)
       resolve/create Contact + ContactIdentity
       resolve/create Conversation; update lastInboundAt and window state
       persist Message if the event carries one
       emit internal domain event
  5. Trigger matching (§12.1)
  6. Mark PROCESSED
```

### 10.3 Reliability requirements

- **Idempotency** — processing the same `WebhookEvent` twice must produce the same end state
  and must not send a second message. Enforced by `IdempotencyRecord` at the action level,
  not just by dedupe at the ingestion level. Dedupe can fail; idempotency at the point of
  side effect cannot be skipped.
- **Retries** — exponential backoff with jitter. Distinguish retryable (network, 5xx,
  throttling) from terminal (invalid signature, unknown account, malformed payload,
  permission revoked). Never retry a terminal error.
- **Dead-letter queue** — after max attempts, move to DLQ with full context. DLQ depth is an
  alerting metric. Provide an admin UI to inspect and requeue.
- **Timeouts** — every external call and every job has an explicit timeout. A job without a
  timeout is a job that can hang a worker forever.
- **Event replay** — because `WebhookEvent` is append-only with raw payloads, you can replay a
  time range for a workspace after fixing a bug. Build this as an admin tool from the start.
  ⚠️ Replay must run in a mode that **suppresses outbound side effects by default**, with
  explicit opt-in to re-send. Replaying a day of comment events and re-sending every private
  reply would be catastrophic and, if private replies are one-shot, unrecoverable.
- **Observability** — count received / processed / failed / discarded, and measure
  receive→process latency. Alert on ingestion lag.

---

## 11. AUTOMATION ENGINE

### 11.1 Execution model

An `Execution` is a **durable state machine**, persisted in Postgres. It is not a function
call, not an in-memory object, and not a queue message. A Delay of three days means the
Execution sleeps for three days and resumes at exactly the node where it stopped, even across
deploys, restarts, and Redis flushes.

```
loop:
  load Execution FOR UPDATE (row lock — one worker per execution, always)
  resolve current node from the PUBLISHED AutomationVersion graph
  create ExecutionStep (status RUNNING)
  execute node:
      Trigger        → entry point, evaluate entry conditions
      SendMessage    → ask Capability Engine → provider call → persist Message
      Condition      → evaluate predicate → choose outgoing edge
      Delay          → set status WAITING + resumeAt → schedule wakeup → RETURN
      AddTag / RemoveTag / SetCustomField → mutate contact state
      Webhook        → outbound HTTP (SSRF-guarded)
      Branch         → multi-way split
      End            → status COMPLETED
  persist ExecutionStep result
  advance currentNodeId
  if terminal → finish; else → continue loop
```

### 11.2 Non-negotiable engine properties

1. **Executions run against the published version they started on.** Editing or republishing
   an automation must never mutate an in-flight execution. This is why `AutomationVersion` is
   immutable after publish.
2. **One worker per execution at a time.** Use `SELECT … FOR UPDATE` (or `SKIP LOCKED` when
   claiming work). Two workers advancing the same execution will double-send.
3. **Every side effect is idempotent.** Before any outbound action, write an
   `IdempotencyRecord` keyed by `(executionId, nodeId, attempt-invariant key)`. If the record
   exists with a result, return that result instead of re-executing.
4. **Distinguish "failed before the side effect" from "failed after".** A network timeout on a
   send is ambiguous: the message may or may not have gone out. Record intent *before* the
   call and reconcile *after*. For one-shot capabilities (private replies), an ambiguous
   outcome must be treated as **used**, not as retryable. Losing one reply is far better than
   burning the only permitted attempt or double-messaging a customer.
5. **Step budget and loop protection.** Cap steps per execution and detect cycles. A user can
   and will draw an infinite loop.
6. **Delay correctness.** `resumeAt` is stored in the DB; the scheduler polls
   `Execution WHERE status='WAITING' AND resumeAt <= now()`. Do not rely solely on a delayed
   queue message — Redis is transport, Postgres is truth. If a Delay has a permitted-hours
   window, compute the next valid instant using the workspace timezone (and contact timezone
   if known), including DST transitions.
7. **Cancellation.** Executions can be cancelled by the operator, by contact unsubscribe, by
   account disconnection, or by a new execution superseding them per flow policy.
8. **Concurrency policy per contact.** Decide and make configurable: may a contact be in two
   executions of the same automation at once? Default: no — re-entry either restarts or is
   skipped, per flow setting. Ship a default; make it explicit in the UI.
9. **Capability check at run time, not only at design time.** Permissions get revoked, windows
   close, tokens expire between publish and execution. Check immediately before acting.
10. **Structured failure.** A failed step records a typed error (§24), never a bare string.

### 11.3 Variables and expressions

- Execution `variables` hold trigger payload data, contact fields, and step outputs.
- Message content supports interpolation of contact fields and variables.
- **The expression evaluator must be a sandboxed, non-Turing-complete evaluator over an
  allow-listed AST.** Never `eval`, never `new Function`, never a full scripting language.
  This is multi-tenant: an expression is untrusted input that runs on our servers.
- Undefined variable resolution has a defined, documented behaviour (default value or
  step failure — pick one, make it visible in the builder).

---

## 12. TRIGGERS AND ACTIONS

### 12.1 Trigger matching

When a `NormalizedEvent` is resolved, find candidate triggers:

```
triggers WHERE workspaceId = ?
             AND channel = ?
             AND connectedAccountId IN (?, NULL)
             AND type = <event type>
             AND enabled = true
             AND automationVersionId = automation.publishedVersionId
```

Then apply, in this order:
1. **Specificity** — a trigger scoped to a specific post/keyword beats a catch-all.
2. **Explicit priority** — `matchPriority`, operator-controlled.
3. **Deterministic tie-break** — creation time. Never random.

Define and document whether one event may start multiple automations. **Default: one.**
The highest-ranked matching trigger wins; others are recorded as "matched but not run" so the
operator can debug why their flow did not fire. That debugging surface matters more than it
sounds — "why didn't my automation run" is the top support question in this category.

Catch-all triggers (default reply) must only match when no specific trigger matched.

### 12.2 Trigger registry — populate ONLY from validated capabilities

Every trigger type must be declared with this metadata before it can exist in the product:

```ts
interface TriggerDefinition {
  type: string                     // 'instagram.comment', 'instagram.dm.keyword', ...
  channel: Channel
  requiredCapabilities: string[]   // capability ids that must be AVAILABLE
  sourceWebhookField: string       // exact validated field name — NEVER guessed
  payloadSchema: JSONSchema        // exact validated payload shape
  configSchema: JSONSchema         // what the operator configures
  accountRequirements: string[]
  limitations: LocalizedText       // shown in the builder, in the operator's language
  docReference: { url: string; validatedAt: string; apiVersion: string }
}
```

**Candidate trigger types, all pending PHASE 0:**

| Candidate | Status until validated | Depends on |
|---|---|---|
| DM received — keyword match | PENDING_VALIDATION | Q8, Q9, Q14 |
| DM received — default/catch-all | PENDING_VALIDATION | Q8, Q9 |
| Comment on post or reel | PENDING_VALIDATION | Q22, Q26 |
| Story reply | PENDING_VALIDATION | Q28 |
| Story mention | PENDING_VALIDATION | Q28 |
| Live comment | PENDING_VALIDATION — **may be deprecated** | Q13 |
| Ice breaker / conversation starter selected | PENDING_VALIDATION | Q15, Q20 |
| Manual enrolment by operator | **AVAILABLE — Layer 1** | — |
| Contact tag added | **AVAILABLE — Layer 1** | — |
| Inbound API/webhook call to DM FLOW | **AVAILABLE — Layer 1** | — |

Layer 1 triggers can be built immediately and are a good way to test the engine end-to-end
before any Meta integration exists. **Do this.** It lets you validate the whole engine with
zero external dependencies.

### 12.3 Action registry

Same discipline. Every action declares:

```ts
interface ActionDefinition {
  type: string
  channel: Channel | 'internal'
  requiredCapabilities: string[]
  configSchema: JSONSchema
  preconditions: PreconditionRule[]   // e.g. messaging window must be OPEN
  idempotency: 'NONE' | 'PER_EXECUTION_NODE' | 'ONE_SHOT_GLOBAL'
  errorMapping: Record<string, InternalErrorCode>
  docReference?: { url: string; validatedAt: string; apiVersion: string }
}
```

**Internal actions (Layer 1 — build now):**
Add Tag · Remove Tag · Set Custom Field · Clear Custom Field · Branch · Condition · Delay ·
External HTTP Request · Emit outbound webhook · Notify team member · Assign conversation ·
Set conversation status · Unsubscribe contact · End execution

**Channel actions (Layer 2 — pending validation):**
Send text · Send media · Send quick replies · Send buttons · Reply to comment publicly ·
Send private reply to a comment · Set ice breakers · Mark seen / typing indicator

Note `idempotency: 'ONE_SHOT_GLOBAL'` — reserved for actions like private replies where the
platform may permit exactly one attempt per target, ever. These need a global idempotency key
scoped to the target (the comment id), not to the execution. Two different automations must
not each burn an attempt on the same comment.

---

## 13. FLOW BUILDER

### 13.1 Canvas
- Pan, zoom (with fit-to-view and zoom-to-selection), minimap, grid snapping
- Multi-select, box select, copy/paste, duplicate, align/distribute
- Keyboard: delete, undo (Cmd/Ctrl+Z), redo, save, search nodes, navigate between nodes
- Node search / command palette for adding nodes
- Auto-layout as an explicit user action, never automatic on load (it would scramble
  a layout the user arranged deliberately)

### 13.2 Nodes
Trigger · Send Message · Condition · Branch · Delay · Add Tag · Remove Tag ·
Set Custom Field · HTTP Request · Notify · Assign · End

**Channel-dependent nodes appear only when the Capability Engine allows them for the connected
account.** Not greyed out with a lock and a nice tooltip only — actually filtered from the
palette when the capability is `NOT_VALIDATED`. Show unavailable-but-known capabilities
(e.g. `APP_REVIEW_REQUIRED`) as disabled with a clear reason and a remediation link. The
difference matters: "we haven't verified this exists" and "this exists but you need approval"
are different messages to an operator.

### 13.3 Editing model
- **Autosave the draft** with debounce; explicit "Publish" for the live version
- Optimistic local updates; conflict detection if the same automation is edited in two tabs
- Undo/redo over a command stack (not naive full-state snapshots — the canvas gets large)
- Version history with diff view and one-click restore to a previous version
- Draft and published states clearly distinguished in the UI at all times

### 13.4 Validation (runs continuously, blocks publish)
- Trigger present and configured
- No unreachable nodes; no node without a path to an End
- No cycles without a delay or a bounded iteration guard
- All required node config filled
- **All referenced capabilities currently available** — this is the check that prevents
  publishing a flow that will fail at run time
- Variable references resolve
- Message content within validated length limits
- Errors and warnings distinguished: errors block publish, warnings do not
- Clicking a validation message focuses and highlights the offending node

### 13.5 Testing and debugging
- **Test mode**: run the flow against a designated test contact, with the Capability Engine
  in strict mode and outbound calls either real (to a test account) or captured to a preview
  panel. Make which one is happening unmistakably obvious.
- **Live execution inspector**: per execution, show the path taken through the graph with
  per-node timings, inputs, outputs, and errors — overlaid on the canvas itself.
- A published flow's canvas shows aggregate counts per node (how many contacts reached it,
  how many failed there). This is how operators find drop-off.

---

## 14. INBOX

### 14.1 The critical design constraint

⚠️ Research suggests the platform's conversation API may only return **detailed content for a
small number of recent messages** per conversation ⟨VERIFY: Q30⟩. If that is confirmed, then:

**DM FLOW's Inbox is not a mirror of Instagram. It is our own ledger.**

Every message we receive via webhook and every message we send is persisted by us. The history
we display is the history we recorded, starting from the moment the account was connected.

This must be stated plainly in the UI — an empty-state line like *"History starts when you
connected this account"* — and reflected in `docs/known-limitations.md`. Do not let a user
believe messages are missing because of a bug.

### 14.2 Features
- Unified conversation list across connected accounts, with real-time updates over WebSocket
- Filters: channel, status, assignee, tag, unread, window state, date range, search
- Assignment: to a member or a team; unassigned queue; assignment rules
- Statuses: open / snoozed (with wake time) / closed
- Contact panel alongside the thread: identity, tags, custom fields, source, last interaction,
  active executions, and **current messaging window state with a countdown**
- Internal notes (never sent to the contact — make this visually unmistakable)
- Human handoff: pause automations for this conversation while a human is handling it,
  with an explicit resume
- Canned responses / saved replies
- Typing and presence indicators for agents

### 14.3 Sending from the Inbox
Every manual send goes through the **same Capability Engine** as automated sends. If the window
is closed, the composer is disabled with a clear explanation and, where a validated mechanism
exists (e.g. a human-agent extension ⟨VERIFY: Q20⟩), it is offered explicitly with its
conditions stated — never applied silently. An operator must know when they are using a
special-case mechanism.

---

## 15. CONTACTS

- List with search, filters, saved segments, sorting, pagination, bulk actions
- Contact detail: identities per channel, tags, custom fields, conversation history,
  execution history, source, consent state, timeline of everything that happened
- Import via CSV **only where a legitimate basis exists** — and note that imported contacts
  usually cannot be messaged, because messaging requires the platform's window and the
  contact must have initiated. Say so during import, or you will ship a feature that
  generates support tickets and policy violations. ⟨VERIFY: Q21⟩
- Export (CSV/JSON), respecting permissions and producing an audit log entry
- Merge duplicate contacts across channels, with a reversible audit trail
- Unsubscribe/block state that the engine **must** honour before any send
- Full deletion path for LGPD erasure (§19)

---

## 16. ANALYTICS

Only real, derived metrics. No estimates, no placeholders.

**Automation level:** executions started / completed / failed / cancelled, completion rate,
median and p95 duration, executions over time, top triggers.

**Node level:** entered, exited, failed, drop-off between nodes, average dwell time,
per-node error breakdown. Rendered as an overlay on the flow canvas.

**Messaging level:** messages sent / delivered / failed by type and by channel, failure reasons
grouped by internal error code, inbound volume, response rate (contact replied after our
message), median time to first reply.

**Contacts:** new contacts over time, by source, by trigger; tag distribution;
active vs unsubscribed.

**Inbox:** conversations opened/closed, median first response time, median resolution time,
volume by assignee, backlog age.

**Integration health:** API errors by code, rate limit usage over time, webhook delivery
volume and processing lag, token expiry runway.

Implementation notes: pre-aggregate into rollup tables via scheduled jobs for anything spanning
long ranges. Do not compute dashboards with live scans over `ExecutionStep` — that table is the
largest in the system. Define every metric precisely in `docs/analytics.md`; ambiguous metric
definitions destroy trust in a dashboard faster than missing metrics do.

---

## 17. TEMPLATES

- Save an automation's **logic** as a reusable template
- A template stores: graph structure, node configuration, required capability ids, declared
  tags and custom fields it expects, and metadata
- A template **never** stores: tokens, secrets, connected account ids, contact data,
  workspace identifiers, or any customer PII. Enforce this with a sanitiser on export **and**
  a validator on import — do not rely on the export path being correct.
- On import: show which capabilities the template requires and whether the target workspace's
  connected account satisfies them; create missing tags/custom fields with user confirmation;
  refuse import if a required capability is unavailable, with a clear explanation
- Versioned, with an explicit schema version so old templates remain importable

---

## 18. SECURITY

### 18.1 Secrets and tokens
- Channel access tokens, refresh tokens, integration credentials, and outbound webhook secrets
  are encrypted at rest with **AES-256-GCM**, using envelope encryption with the data key
  managed by a KMS / secrets manager.
- Encryption keys are versioned; support key rotation with re-encryption without downtime.
- No secret in source control, in logs, in error messages, in traces, in analytics events,
  or in any API response. Implement a **redaction layer in the logger** — do not rely on
  developers remembering.
- Add a CI secret-scanning step and a pre-commit hook.

### 18.2 Authentication and sessions
- Argon2id for password hashing, sensible parameters, enforced password policy
- Session cookies: `httpOnly`, `Secure`, `SameSite=Lax`, short-lived access + rotating refresh
- Refresh token reuse detection → revoke the whole session family
- Optional TOTP 2FA; recovery codes; enforceable per workspace
- Rate limit and progressively delay authentication endpoints; lock out after repeated failures
- Email enumeration protection on login, signup, and password reset

### 18.3 Authorisation (RBAC)
Roles, as a starting model:

| Role | Capabilities |
|---|---|
| **Owner** | Everything, including billing, workspace deletion, ownership transfer |
| **Admin** | Everything except ownership transfer and workspace deletion |
| **Editor** | Create/edit/publish automations, manage contacts, tags, fields; no billing, no member management |
| **Agent** | Inbox only: conversations, tags, custom field values on contacts they handle |
| **Viewer** | Read-only across analytics and automations |

- Enforce authorisation **server-side on every request**. Hiding a button is UX, not security.
- Centralise policy checks in a single guard/policy layer — never scatter `if (role === …)`.
- Every permission-relevant action writes an `AuditLog` entry.
- Add a test suite that asserts, for each role, both the allowed and the **denied** actions.
  The denied half is the half that gets skipped, and it is the half that matters.

### 18.4 Tenant isolation
- Postgres RLS on every tenant table, plus application-level scoping. Belt and braces.
- Automated tests proving cross-workspace access fails, for every tenant-scoped endpoint.
- Workspace id resolved from the session/API key server-side — **never** from a client-supplied
  body or query parameter.

### 18.5 Webhook security
- Verify signatures on the raw body before any parsing
- Reject unsigned or invalid deliveries with 401 and log the attempt
- Constant-time comparison for signature checks
- Idempotency and replay protection via `providerEventId` and timestamp bounds
- Separate verification secrets per environment

### 18.6 Outbound request security (the HTTP Request node)
This node lets tenants make our servers issue arbitrary HTTP requests. Treat it as hostile:
- Deny private, loopback, link-local, and metadata IP ranges (`169.254.169.254` above all)
- Resolve DNS and validate the **resolved IP**, then pin it for the request —
  otherwise DNS rebinding walks straight past the check
- Do not follow redirects to denied targets; re-validate on every hop
- Enforce timeouts, response size caps, and a per-workspace rate limit
- Allow-list schemes (https only) and ports
- Never forward our own credentials or headers

### 18.7 Application security
- Validate every input with a schema (Zod) at the boundary; reject unknown fields
- Parameterised queries only; no string-built SQL
- Output encoding and a strict CSP; sanitise any rich content rendered from contact input
- CSRF protection on cookie-authenticated state-changing routes
- Rate limiting per IP, per user, per workspace, per endpoint class
- Security headers: HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy
- Dependency scanning in CI; pin and review updates
- Upload validation: type, size, content sniffing; serve user media from a separate origin

### 18.8 Operational security
- Least privilege for every service account and database role
- Separate credentials per environment; production secrets never leave production
- Encrypted, tested backups — a backup that has never been restored is a hypothesis
- Documented incident response and a defined breach notification path
- Regular restore drills

---

## 19. PRIVACY AND LGPD

⚠️ **This section is engineering guidance, not legal advice.** DM FLOW processes personal data
of end users who never signed up for DM FLOW — a genuinely sensitive position. Every item below
must be reviewed by a qualified privacy lawyer before production launch. Mark unresolved legal
questions in `docs/known-limitations.md` under "Requires legal review" rather than guessing.

### 19.1 Build these capabilities
- **Retention policy**, configurable per workspace, with sane defaults, enforced by a scheduled
  job that actually deletes — including from backups per a documented schedule
- **Erasure**: delete a contact and all derived data (messages, execution steps, field values,
  logs referencing them) on request, with a `DataSubjectRequest` record proving it happened
- **Export**: machine-readable export of everything held about a contact
- **Anonymisation** as an alternative to deletion, so aggregate analytics survive erasure
  (replace identifiers, keep counts)
- **Consent state** on `Contact` where applicable, with timestamp and source
- **Data minimisation**: store only what a feature needs. Do not hoard payloads "just in case".
  Raw webhook payloads especially — set a retention window on `WebhookEvent`.
- **Access logging**: who viewed which contact's conversation, and when
- **Sub-processor register** in documentation
- **Regional data residency** consideration: know where data physically lives and say so

### 19.2 Questions to route to legal, not to resolve yourself
- Controller vs processor: is DM FLOW a processor for its customers, a controller, or both?
- What is the legal basis for processing end-user data received via the platform?
- What must the workspace owner's own privacy policy say, and do we require them to have one?
- How do the platform's own data policies constrain our retention and sharing?
- What are the cross-border transfer implications of our hosting choices?
- What contractual terms (DPA) must we offer customers?

Build the mechanisms; let legal set the parameters.

---

## 20. META APP REVIEW AND ENVIRONMENTS

### 20.1 Likely prerequisites (all pending PHASE 0 confirmation)
- A Meta App of the appropriate type
- A Business Portfolio / Business Manager
- Business Verification
- App Review submission for each required permission, with a working demo, screencast,
  and clearly written use case
- Advanced Access for serving accounts the app does not own ⟨VERIFY: Q6, Q7⟩

Plan for this as a **multi-week external dependency with an uncertain outcome**, not a
checkbox. Sequence the roadmap so that Layer 1 and internal triggers are demonstrable while
review is pending — otherwise the whole project stalls on someone else's queue.

Maintain `docs/app-review.md` with: permissions requested, current status per permission,
submission dates, reviewer feedback, and what each permission unlocks in the product.

### 20.2 Environments

| Environment | Purpose | Rules |
|---|---|---|
| **development** | Local work | Own Meta app in dev mode, own test accounts, own webhook tunnel, seeded data. **Never production credentials.** |
| **staging** | Pre-production verification | Separate Meta app, separate DB, production-like config, synthetic data only |
| **production** | Real customers | Real credentials, restricted access, full observability, change control |

- One `.env` schema, validated at boot — the app must **refuse to start** on a missing or
  malformed variable rather than failing mysteriously later.
- Migrations run as a separate, reviewable deploy step.
- Feature flags for progressive rollout of channel features as they clear review.

---

## 21. TESTING

| Level | Scope | Notes |
|---|---|---|
| **Unit** | Predicate evaluator, capability decisions, normalisers, window calculations, expression interpolation | Fast, no I/O |
| **Integration** | API + real Postgres + real Redis via Testcontainers | Includes RLS/tenant isolation tests |
| **Contract** | Provider adapters against **recorded** fixtures of real responses | Fixtures captured from real calls in dev, checked in, dated |
| **Webhook** | Signature verification, dedupe, malformed payloads, replayed payloads, out-of-order delivery, unknown account | Every one of these will happen in production |
| **Queue** | Retry, backoff, DLQ routing, requeue, poison messages | — |
| **Concurrency** | Two workers claiming one execution; simultaneous publish and execute; duplicate webhook arriving in parallel | Use real locking, not mocks |
| **Idempotency** | Same event processed twice → exactly one side effect | Dedicated suite. Non-negotiable. |
| **Rate limit** | Backoff behaviour, limiter adjustment from headers, throttle recovery | — |
| **E2E** | Playwright: signup → workspace → connect (mocked provider) → build flow → publish → trigger → verify execution and analytics | The full loop, automated |
| **Security** | Authz matrix per role, cross-tenant access, SSRF guard, injection attempts | — |

**Mocking rules:**
- Mocks exist **only** in test environments. Never a mock provider in staging or production.
- A mock must be built from a **real recorded response**, and the recording is dated and
  checked in. A hand-written mock encodes your assumption about the API, which is precisely
  what PD-1 forbids — a green test suite against an invented mock is worse than no test,
  because it manufactures false confidence.
- When a capability is `NOT_CONFIRMED`, do not write a mock for it. Write nothing.

---

## 22. OBSERVABILITY

- **Structured JSON logs** with correlation ids threaded from webhook receipt through queue,
  execution, and provider call. Every log line carries `workspaceId`, `executionId`,
  `webhookEventId` where applicable. Secrets redacted by the logger itself.
- **Metrics**: webhook received/processed/failed/lag, queue depth and age per queue, execution
  started/completed/failed and duration, provider call latency/errors/rate-limit usage by
  account, token expiry runway, WebSocket connections, DB pool saturation.
- **Tracing**: OpenTelemetry spans across the full path — the trace for a single inbound
  comment should show ingestion, normalisation, trigger match, each node, and each API call.
- **Error tracking**: Sentry with release tagging and source maps.
- **Alerts** with defined thresholds and owners: ingestion lag, queue depth growth, DLQ
  non-empty, provider error rate spike, tokens expiring within N days, webhook subscription
  unhealthy, execution failure rate above baseline, p99 webhook response above 500ms.
- **Health endpoints**: liveness, readiness, and a deep health check covering DB, Redis,
  queue, and provider reachability.
- **Per-workspace status page** so operators can see their own integration health without
  contacting support.

---

## 23. INTEGRATION STATUS MODEL

The UI must be able to express every one of these states distinctly, with a specific message
and a specific remediation:

| State | Meaning | What the user is told |
|---|---|---|
| `CONNECTED` | Everything working | Healthy, with last-checked time |
| `AUTHORIZATION_INCOMPLETE` | OAuth started but not finished | Resume connection |
| `MISSING_PERMISSION` | A required scope was not granted | Which scope, what it unlocks, reconnect to grant |
| `PENDING_APP_REVIEW` | Capability blocked pending review | What is unavailable meanwhile |
| `TOKEN_EXPIRING` | Expiry approaching | Days remaining, refresh/reconnect action |
| `TOKEN_INVALID` | Expired or revoked | Reconnect required; automations are paused |
| `WEBHOOK_UNHEALTHY` | Subscription missing or not delivering | What is affected, retry action |
| `RATE_LIMITED` | Currently throttled | Expected recovery, current usage |
| `PROVIDER_ERROR` | Upstream failing | Nature of the error, whether we are retrying |
| `DISCONNECTED` | User disconnected | What stopped, how to restore |
| `ACCOUNT_RESTRICTED` | Platform restricted the account | Honest explanation; we cannot fix it for them |

Run a scheduled health check per connected account. Detect degradation **before** an automation
fails, and notify the workspace. Automations that cannot run must be visibly paused with the
reason attached — never failing silently in the background.

---

## 24. ERROR HANDLING

### 24.1 Never ship "Something went wrong"

Every error is a structured object:

```ts
interface DmFlowError {
  code: string              // 'IG_WINDOW_CLOSED', 'IG_TOKEN_INVALID', 'FLOW_NODE_INVALID'
  category: 'VALIDATION' | 'AUTH' | 'PERMISSION' | 'CAPABILITY' | 'RATE_LIMIT'
          | 'PROVIDER' | 'INTERNAL' | 'POLICY'
  provider?: Channel
  operation?: string        // internal operation name
  cause?: string            // upstream code/message, sanitised
  context: Record<string, unknown>   // ids only, never PII, never secrets
  attempt: number
  retryable: boolean
  nextRetryAt?: string
  userMessage: LocalizedMessage      // en + pt-BR, plain language
  remediation?: { action: string; url?: string }
  correlationId: string
  occurredAt: string
}
```

### 24.2 Rules
- Every error carries an internal code. Maintain the full catalogue in `docs/error-codes.md`.
- The user-facing message explains **what happened, why, and what to do next** — in their
  language, without jargon, without provider internals.
- Never expose tokens, secrets, raw provider payloads, stack traces, or internal hostnames
  to a user.
- The `correlationId` is shown to the user so support can trace it. This one detail
  disproportionately reduces support time.
- Failed executions display the failing node, the typed error, the attempt count, and the retry
  schedule — visible in the execution inspector, on the canvas.
- Errors are classified retryable vs terminal at the point of creation, not guessed later.
- Policy-caused failures (`category: 'POLICY'`) get special treatment: explain the platform
  rule that blocked the action, so the operator learns the constraint instead of assuming
  the product is broken.

---

## 25. INTERNATIONALISATION

DM FLOW ships bilingual from the MVP: **English (`en`)** and **Brazilian Portuguese (`pt-BR`)**.

- All user-facing strings in locale files; **zero hardcoded copy** in components
- Locale resolved per user, with a workspace default; switchable in settings, persisted
- Dates, times, numbers, and currency formatted per locale; timezone per workspace
- **Error messages, capability denial reasons, and validation messages are localised too** —
  these are the strings users see when confused, and they are the ones most often forgotten
- Pluralisation handled properly (ICU message format)
- Locale files organised by domain, not one giant file
- A CI check that fails when a key exists in one locale and not the other

---

## 26. UI AND UX

### 26.1 Principles
Clean and quiet · fast · strong visual hierarchy · low chrome · content-first ·
keyboard-friendly · responsive · genuinely accessible

Conceptual references for *quality bar and interaction patterns only* — copy nothing:
Linear (speed, keyboard, density), Stripe (clarity in complexity), n8n/Make (canvas ergonomics),
Intercom (inbox patterns).

### 26.2 Required states — every list, every panel, every async surface
- **Empty state** with an explanation and a primary action, not a shrug
- **Loading**: skeletons matching final layout; never a spinner where a skeleton fits
- **Error**: what failed, why, and a retry
- **Partial/degraded**: e.g. connected account unhealthy — show the data you have with a banner
- **Success feedback**: immediate, specific, non-blocking
- **Destructive confirmation**: name the exact object being destroyed and its consequences;
  require typing the name for irreversible operations (delete workspace, delete automation
  with running executions)

### 26.3 Accessibility (WCAG 2.1 AA as the floor)
Full keyboard operability including the canvas · visible focus indicators · correct semantics
and ARIA · 4.5:1 contrast minimum · screen-reader labelling on every control ·
`prefers-reduced-motion` respected · never colour alone to convey state

The flow canvas is the hard part. Provide a keyboard-navigable node list as an alternative
representation, so the builder is not a mouse-only feature.

### 26.4 Performance targets
Initial load under 2s on a mid-range connection · canvas at 60fps with 100+ nodes ·
virtualised long lists · optimistic updates on mutations · realtime inbox updates without
full refetch

### 26.5 Design system
Own tokens (colour, spacing, radius, typography, elevation, motion), light and dark themes,
a documented component library, and consistent iconography from an openly licensed set.
Do not use another product's proprietary icons, illustrations, or brand assets.

---

## 27. IMPLEMENTATION PLAN

Build in vertical slices. Each phase ends with something demonstrable and tested. Do not start
a phase before the previous one's exit criteria are met.

### PHASE 0 — Capability validation (blocking for all Layer 2 work)
Do the research in §4. Produce `docs/meta-capabilities.md` with a real row per capability.
Resolve the `/docs/` vs `/documentation/` question. Produce a written go/no-go per MVP feature.
**Exit:** every MVP Layer 2 feature is either validated with a citation, or dropped from the MVP
with a written reason. No exceptions, no "we'll check later".

### PHASE 1 — Foundation
Monorepo, TypeScript strict, lint/format, CI, Docker Compose (Postgres, Redis), env schema
validation, base Next.js and NestJS apps, health endpoints, structured logging, error handling
middleware, i18n scaffolding.
**Exit:** `docker compose up` gives a running, health-checked, logging system.

### PHASE 2 — Identity and tenancy
User, Workspace, WorkspaceMember, Session, Invitation. Signup, login, password reset, 2FA.
RBAC guard layer. RLS policies. AuditLog. Workspace switcher.
**Exit:** two workspaces exist; the authz matrix test suite passes; cross-tenant tests fail
closed.

### PHASE 3 — Contacts and segmentation (Layer 1 only)
Contact, ContactIdentity, Tag, ContactTag, CustomField, CustomFieldValue, Segment.
The predicate evaluator — **one implementation** serving conditions, segments, and filters.
Contact list, detail, import/export.
**Exit:** contacts manageable and segmentable with no channel connected at all.

### PHASE 4 — Capability Engine
Capability registry seeded from PHASE 0. Decision function with structured denials. Window
state modelling. Registry staleness CI check.
**Exit:** the engine correctly denies everything unvalidated, and the denial reasons are
localised and specific. Ship this before providers — it is the guardrail everything else
leans on.

### PHASE 5 — Automation engine with Layer 1 triggers and actions only
Automation, AutomationVersion, Trigger, Execution, ExecutionStep, IdempotencyRecord.
Engine loop, durable delays, scheduler, cancellation, concurrency policy, step budget.
Triggers: manual enrolment, tag added, inbound API call. Actions: tags, custom fields,
conditions, delays, HTTP request, end.
**Exit:** a multi-step automation with a three-day delay runs correctly across a restart,
with full per-step history and idempotency tests passing. **The engine is proven with zero
external dependencies.**

### PHASE 6 — Flow Builder
Canvas, node palette gated by the Capability Engine, config panels, validation, autosave,
publish, versioning, undo/redo, execution inspector overlay.
**Exit:** a non-technical user can build, validate, publish, and debug a Layer 1 automation.

### PHASE 7 — First channel provider (Instagram)
Provider skeleton, OAuth, token storage and refresh, ConnectedAccount lifecycle, health checks,
integration status surface. **Implement only capabilities validated in PHASE 0.**
**Exit:** an account connects, appears healthy, refreshes its token, and reports status
correctly through every state in §23.

### PHASE 8 — Event ingestion
Webhook endpoints, signature verification, WebhookEvent persistence, dedupe, normalisation,
queue, DLQ, replay tooling (side-effect-suppressed by default), ingestion metrics and alerts.
**Exit:** real events arrive, are deduped, normalised, and produce Contacts, Conversations,
and Messages. Replay works and does not re-send.

### PHASE 9 — Channel triggers and actions
Wire validated triggers into matching; implement validated send actions behind the Capability
Engine; rate limiter fed by response headers; error mapping to the internal catalogue.
**Exit:** the flagship loop works end to end on a real test account — event in, automation runs,
message out, execution recorded, analytics updated.

### PHASE 10 — Inbox
Conversation list, thread view, realtime, assignment, statuses, notes, handoff, manual send
through the Capability Engine, contact panel with live window state.

### PHASE 11 — Analytics
Rollup jobs, dashboards, per-node canvas overlay, integration health analytics.

### PHASE 12 — Templates, outbound webhooks, integrations
Template export/import with sanitisation, outbound webhook delivery with retries, public API
with API keys and scopes.

### PHASE 13 — Hardening and launch
Security review, load testing, backup/restore drill, runbooks, retention and erasure jobs
verified, alerting tuned, documentation complete, App Review submitted and tracked.

---

## 28. REQUIRED DOCUMENTATION

Maintain these in the repository, updated as part of the work — not written at the end:

| File | Contents |
|---|---|
| `docs/meta-capabilities.md` | **The most important file.** One row per capability, per §4.4. Source of truth for the Capability Engine. |
| `docs/architecture.md` | System design, process topology, decisions and their rationale, assumptions |
| `docs/data-model.md` | Entities, relationships, indexes, tenancy and RLS strategy, retention |
| `docs/automation-engine.md` | Execution semantics, idempotency, delays, concurrency, failure handling |
| `docs/security.md` | Threat model, controls, secret handling, incident response |
| `docs/api-integrations.md` | Provider architecture, per-channel specifics, rate limiting, error mapping |
| `docs/known-limitations.md` | What the product cannot do and why — split into "platform limitation", "pending validation", "deliberately not built", "requires legal review" |
| `docs/error-codes.md` | Full internal error catalogue with user-facing messages in both locales |
| `docs/analytics.md` | Precise definition of every metric |
| `docs/app-review.md` | Permissions, submission status, feedback, what each unlocks |
| `docs/runbooks/` | Operational procedures: token expiry, webhook outage, DLQ drain, incident response |
| `docs/adr/` | Architecture Decision Records for significant choices |

---

## 29. ANTI-HALLUCINATION CLAUSE (restated, because it is the point)

> **If you cannot confirm a capability in current official documentation, do not implement it
> assuming it exists. Mark it `PENDING_VALIDATION`, build the rest of the system without it,
> and continue.**

You may not, under any circumstance:
- invent an endpoint, path, or method
- invent a request or response payload
- invent a permission or scope string
- invent a webhook field or event name
- invent a policy rule or a limit
- assume a behaviour because it exists on a different Meta product
- assume a behaviour because a competitor appears to have the feature
- assume a behaviour because this document mentioned it as a hypothesis

**Everything in this document marked ⟨VERIFY⟩, "hypothesis", "candidate", or
`PENDING_VALIDATION` is unverified.** Including — especially — the parts that sound confident.

When you hit an unverifiable point, the correct output is a clearly stated open question in
`docs/known-limitations.md` and a request for a decision. Not a guess. Not a plausible default.
A stated unknown is a professional result; a confident fabrication is a defect that reaches a
customer.

---

## 30. DEFINITION OF DONE

A feature is done when all of the following hold:

1. It works end to end in a real environment, not only in tests
2. It has unit and integration tests, including failure paths
3. Layer 2 features cite a validated capability row with a date and API version
4. Errors are typed, localised, and actionable
5. It is observable: logs, metrics, and traces exist for it
6. Authorisation is enforced server-side and tested per role
7. Tenant isolation is tested
8. All UI states exist: empty, loading, error, partial, success
9. Strings are localised in both `en` and `pt-BR`
10. Documentation is updated in the same change
11. No secret is exposed anywhere in the path
12. Anything unverified is recorded as a limitation rather than silently assumed

---

## 31. HOW TO START

1. Read this document completely.
2. Execute PHASE 0. Produce `docs/meta-capabilities.md`. **Do not skip this to "get moving" —
   every hour spent here saves days of building against imagined APIs.**
3. Report back with: what was confirmed, what was not, which MVP features survive validation,
   and any question this document did not answer.
4. Only then begin PHASE 1.

If PHASE 0 reveals that a core assumption of this document is wrong — for instance, that the
comment-to-private-reply loop is not available as described — **say so plainly and propose a
revised product scope.** That is the correct response. Building the wrong thing accurately is
still building the wrong thing.
