// Reusable, side-effect-free exports for apps/cli ("apps/cli è lo stesso
// codice del worker invocato one-shot", docs/01-architettura.md §1).
// Never import src/index.ts for this purpose: it runs main() on load.
export * from './processors/ping.js';
export * from './processors/reconcile.js';
export * from './processors/extractText.js';
export * from './processors/generation/generateFlashcards.js';
export * from './processors/generation/generateSummary.js';
export * from './processors/generation/shared.js';
export * from './processors/exam/extractExamProfile.js';
export * from './processors/exam/generateSimulation.js';
export * from './processors/exam/gradeAttempt.js';
export * from './processors/planner/generatePlan.js';
export * from './jobRunner.js';
