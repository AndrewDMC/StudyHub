import { pipeline, type FeatureExtractionPipeline } from '@xenova/transformers';

/**
 * Local, free embedding — no provider abstraction needed since there's only
 * one implementation (the user picked "locale/gratuito" over a paid API,
 * see docs/fasi/F1-ingest.md "Stato"). `Xenova/all-MiniLM-L6-v2` runs fully
 * offline in Node (ONNX runtime), 384 dimensions, matching
 * `packages/db/src/schema.ts`'s `chunks.embedding` column. The model is
 * downloaded once and cached under the OS cache dir on first use.
 */
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
export const EMBEDDING_DIMENSIONS = 384;

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

function loadExtractor(): Promise<FeatureExtractionPipeline> {
  extractorPromise ??= pipeline(
    'feature-extraction',
    MODEL_NAME,
  ) as Promise<FeatureExtractionPipeline>;
  return extractorPromise;
}

/** Mean-pooled, L2-normalized sentence embedding — the standard recipe for this model family. */
export async function embedText(text: string): Promise<number[]> {
  const extractor = await loadExtractor();
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data as Float32Array);
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const extractor = await loadExtractor();
  const results: number[][] = [];
  for (const text of texts) {
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    results.push(Array.from(output.data as Float32Array));
  }
  return results;
}
