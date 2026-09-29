// Browser-safe subset of @studyhub/core: no node:fs/node:crypto/node:path
// imports anywhere in this file's graph. Client components must import from
// '@studyhub/core/browser', never the root barrel, or a Node built-in
// dependency (manifest.ts, scaffold.ts, paths.ts) gets pulled into the bundle.
export * from './slug.js';
export * from './colors.js';
export * from './documents.js';
export * from './fsrs.js';
export * from './forecast.js';
export * from './mastery.js';
export * from './examTimer.js';
export * from './pomodoro.js';
