// docs/02-filesystem-e-dati.md §5 mastery bands. Lives apart from `overview.ts` (server-only,
// pulls in the db) so client components can share the same thresholds as the server and the heatmap.
export const LOW_MASTERY_THRESHOLD = 0.4;
export const GOOD_MASTERY_THRESHOLD = 0.7;
