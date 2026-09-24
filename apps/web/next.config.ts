import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  // Workspace packages ship raw TypeScript (see docs/01-architettura.md §3);
  // Next only transpiles its own app source by default, so opt these in.
  transpilePackages: ['@studyhub/core', '@studyhub/db', '@studyhub/contracts'],
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
