export * from './provider.js';
export * from './schemas.js';
export * from './pricing.js';
export * from './fakeProvider.js';
export * from './anthropicProvider.js';
export * from './claudeCliProvider.js';
export * from './claudeAuth.js';
export * from './claudeBinary.js';
export * from './providerPreference.js';
export * from './promptRender.js';
export * from './resolveProvider.js';
export * from './promptLoader.js';
export * from './versions.js';
export * from './text.js';
// embeddings.js is deliberately NOT re-exported from the main barrel: it pulls
// in `@xenova/transformers` -> `onnxruntime-node` (a native binary), and every
// consumer of this barrel — including web routes that only need
// `resolveProvider()` — would otherwise drag it into their own module graph.
// Import `@studyhub/ai/embeddings` directly where actually needed
// (apps/worker/src/processors/embedChunks.ts, apps/web/src/lib/search.ts).
