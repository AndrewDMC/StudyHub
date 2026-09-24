import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 20000,
    // Default 10s hookTimeout is tight for a beforeEach that scaffolds a
    // subject + migrates a pglite instance under heavy parallel CPU load
    // (e.g. `turbo run test` across every package at once).
    hookTimeout: 20000,
  },
});
