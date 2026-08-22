import { describe, expect, it } from 'vitest';
import { CAP, getCapabilityEntry, isLiveAvailable, listCapabilities } from '../capabilities';

describe('capability registry', () => {
  it('leaves every live Instagram capability unconfirmed until Meta docs are read', () => {
    // This is the anti-hallucination guarantee expressed as a test: nothing may be
    // marked available for a real account without a validation pass.
    for (const entry of listCapabilities(false)) {
      expect(isLiveAvailable(entry.status)).toBe(false);
      expect(entry.status).toBe('NOT_CONFIRMED');
      expect(entry.doc.validatedAt).toBeNull();
    }
  });

  it('never claims documented limits or scopes for an unvalidated capability', () => {
    for (const entry of listCapabilities(false)) {
      expect(Object.keys(entry.documentedLimits)).toHaveLength(0);
      expect(entry.requiredScopes).toHaveLength(0);
      expect(entry.doc.url).toBe('');
    }
  });

  it('records the open question blocking each capability', () => {
    for (const entry of listCapabilities(false)) {
      expect(entry.pendingQuestion).toBeTruthy();
    }
  });

  it('marks simulator-backed capabilities as SANDBOX_SIMULATED, not as available', () => {
    const sandbox = getCapabilityEntry(CAP.IG_SEND_TEXT, true);
    expect(sandbox?.status).toBe('SANDBOX_SIMULATED');
    // Crucially it is still not "live available" — it describes our simulator.
    expect(isLiveAvailable(sandbox!.status)).toBe(false);
  });

  it('does not simulate capabilities the platform may not support at all', () => {
    // Live comments and persistent-menu style features have no sandbox behaviour,
    // so they cannot be demoed into looking real.
    expect(getCapabilityEntry(CAP.IG_RECEIVE_LIVE_COMMENT, true)?.status).toBe('NOT_CONFIRMED');
    expect(getCapabilityEntry(CAP.IG_HUMAN_AGENT_WINDOW, true)?.status).toBe('NOT_CONFIRMED');
  });

  it('treats private replies as one-shot in both registries', () => {
    expect(getCapabilityEntry(CAP.IG_SEND_PRIVATE_REPLY, true)?.idempotency).toBe('ONE_SHOT_GLOBAL');
    expect(getCapabilityEntry(CAP.IG_SEND_PRIVATE_REPLY, false)?.idempotency).toBe('ONE_SHOT_GLOBAL');
  });
});
