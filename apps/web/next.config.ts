import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  // Workspace packages ship raw TypeScript (see docs/01-architettura.md §3);
  // Next only transpiles its own app source by default, so opt these in.
  transpilePackages: ['@studyhub/core', '@studyhub/db', '@studyhub/contracts'],
  // `@studyhub/ai`'s embeddings.ts (used by apps/web/src/lib/search.ts for the
  // query-side embedding) pulls in `@xenova/transformers` -> `onnxruntime-node`,
  // which ships a native `.node` binary. Webpack can't parse that file and the
  // build fails ("Module parse failed: Unexpected character") unless these
  // packages are left external and `require()`d by Node at runtime instead of
  // statically bundled — they only ever run in a route handler (Node runtime),
  // never in client code.
  serverExternalPackages: ['@xenova/transformers', 'onnxruntime-node', 'sharp', '@napi-rs/canvas'],
  webpack: (config) => {
    // Source files use explicit ".js" extensions on relative imports (required
    // by moduleResolution "Bundler"/NodeNext) that actually point at ".ts"
    // siblings; webpack needs to be told to remap them.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
