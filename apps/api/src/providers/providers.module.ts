import { Global, Module } from '@nestjs/common';
import { MockInstagramProvider } from './mock-instagram.provider';
import { LiveInstagramProvider } from './live-instagram.provider';
import { ProviderRegistry } from './provider.registry';

@Global()
@Module({
  providers: [MockInstagramProvider, LiveInstagramProvider, ProviderRegistry],
  exports: [ProviderRegistry, MockInstagramProvider],
})
export class ProvidersModule {}
