import { z } from 'zod';
import { SessionCitationDtoSchema } from './session.js';

/** Modelli ammessi, allineati a `MODEL_OPTIONS` del `ModelPicker`. */
export const ASK_MODEL_IDS = [
  'claude-haiku-4-5-20251001',
  'claude-sonnet-5-5',
  'claude-opus-5-5',
] as const;

/**
 * "Chiedi" a livello materia: una domanda, una risposta con citazioni, nessuno storico.
 * Scope: `docIds` vince su `topicIds`; senza nessuno dei due si cerca in tutta la materia.
 */
export const AskSubjectRequestSchema = z.object({
  question: z.string().trim().min(1, 'Scrivi una domanda').max(2000),
  docIds: z.array(z.string().uuid()).max(50).optional(),
  topicIds: z.array(z.string().uuid()).max(50).optional(),
  /** Modello (gli stessi del `ModelPicker`); assente = quello veloce (Haiku), come la chat di sessione. */
  model: z.enum(ASK_MODEL_IDS).optional(),
});
export type AskSubjectRequest = z.infer<typeof AskSubjectRequestSchema>;

/** Le citazioni sono quelle della chat di sessione, così `AnswerMarkdown` si riusa. */
export const AskSubjectDoneSchema = z.object({
  answer: z.string(),
  citations: z.array(SessionCitationDtoSchema),
});

/** Eventi dello stream SSE di `POST /api/subjects/[slug]/ask`, uno per riga `data:`. */
export type AskSubjectEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; answer: string; citations: z.infer<typeof SessionCitationDtoSchema>[] }
  | { type: 'error'; message: string };
