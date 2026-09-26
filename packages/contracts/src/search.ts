import { z } from 'zod';

/** Hybrid FTS + vector search result (docs/fasi/F1-ingest.md: "Cerco 'entropia' e trovo il chunk con pagina esatta"). */
export const SearchResultDtoSchema = z.object({
  chunkId: z.string().uuid(),
  documentId: z.string().uuid(),
  documentName: z.string(),
  pageFrom: z.number().int().positive(),
  pageTo: z.number().int().positive(),
  /** A short excerpt around the match — not the whole chunk. */
  excerpt: z.string(),
  score: z.number(),
});
export type SearchResultDto = z.infer<typeof SearchResultDtoSchema>;
