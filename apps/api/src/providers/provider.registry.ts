import { Injectable } from '@nestjs/common';
import { DmFlowError, type Channel } from '@dmflow/shared';
import { loadEnv } from '../config/env';
import { MockInstagramProvider } from './mock-instagram.provider';
import { LiveInstagramProvider } from './live-instagram.provider';
import type { ChannelProvider } from './channel-provider';

@Injectable()
export class ProviderRegistry {
  constructor(
    private readonly mockInstagram: MockInstagramProvider,
    private readonly liveInstagram: LiveInstagramProvider,
  ) {}

  /**
   * Resolution is driven by the account, not by global config: a workspace can hold
   * a sandbox account and a live one at the same time, and each must be served by
   * the provider that matches it. Config only decides what a NEW connection becomes.
   */
  forAccount(channel: Channel, isSandbox: boolean): ChannelProvider {
    if (channel !== 'INSTAGRAM') {
      throw new DmFlowError('CAPABILITY_NOT_VALIDATED', {
        context: { channel },
        cause: `${channel} has no provider yet; it needs its own capability validation pass`,
      });
    }
    return isSandbox ? this.mockInstagram : this.liveInstagram;
  }

  /** Provider used when creating a new connection. */
  forNewConnection(channel: Channel): ChannelProvider {
    const env = loadEnv();
    return this.forAccount(channel, env.INSTAGRAM_PROVIDER === 'mock');
  }

  get sandboxInstagram(): MockInstagramProvider {
    return this.mockInstagram;
  }
}
