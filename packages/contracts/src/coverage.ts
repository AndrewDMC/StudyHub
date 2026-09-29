import { z } from 'zod';

export const GapFlagSchema = z.enum(['no_material', 'no_cards', 'weak']);

/** One topic of the subject crossed with material, cards and past-exam frequency (docs/06-miglioramenti.md #2). */
export const CoverageTopicDtoSchema = z.object({
  topicId: z.string().uuid(),
  name: z.string(),
  examMentions: z.number().int(),
  examTotal: z.number().int(),
  recurring: z.boolean(),
  materialDocs: z.number().int(),
  materialPages: z.number().int(),
  cards: z.number().int(),
  mastery: z.number().nullable(),
  flags: z.array(GapFlagSchema),
  priority: z.number(),
  /** Human sentence ("Non hai materiale su X, che compare in 4 esami su 5."); null when there is no gap. */
  message: z.string().nullable(),
});
export type CoverageTopicDto = z.infer<typeof CoverageTopicDtoSchema>;

export const UnmappedExamTopicDtoSchema = z.object({
  name: z.string(),
  materialMentions: z.number().int(),
});

export const CoverageMapDtoSchema = z.object({
  examTotal: z.number().int(),
  topics: z.array(CoverageTopicDtoSchema),
  unmapped: z.array(UnmappedExamTopicDtoSchema),
});
export type CoverageMapDto = z.infer<typeof CoverageMapDtoSchema>;
