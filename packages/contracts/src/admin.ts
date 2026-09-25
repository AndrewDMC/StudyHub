import { z } from 'zod';
import { JobStatusSchema } from './job.js';
import { RecentJobDtoSchema } from './dashboard.js';

/** `/admin` (docs/fasi/F7-dashboard-polish.md scope: "job, costi per mese, stato sync FS, log, reset indice"). */
export const AdminJobsQuerySchema = z.object({
  status: JobStatusSchema.optional(),
  limit: z.number().int().positive().max(200).default(50),
  offset: z.number().int().nonnegative().default(0),
});
export type AdminJobsQuery = z.infer<typeof AdminJobsQuerySchema>;

export const AdminJobsResponseSchema = z.object({
  jobs: z.array(RecentJobDtoSchema),
  total: z.number().int(),
});
export type AdminJobsResponse = z.infer<typeof AdminJobsResponseSchema>;

export const MonthlyCostDtoSchema = z.object({
  /** `YYYY-MM`, UTC. */
  month: z.string(),
  costEur: z.number(),
  jobCount: z.number().int(),
});
export type MonthlyCostDto = z.infer<typeof MonthlyCostDtoSchema>;

/** Snapshot of the most recent `reconcile` job (docs/fasi/F0-fondamenta.md), whatever its scope. */
export const FsSyncStatusDtoSchema = z.object({
  lastRunAt: z.string().datetime().nullable(),
  status: JobStatusSchema.nullable(),
  imported: z.array(z.string()),
  alreadyIndexed: z.array(z.string()),
  skippedInvalid: z.array(z.object({ slug: z.string(), reason: z.string() })),
});
export type FsSyncStatusDto = z.infer<typeof FsSyncStatusDtoSchema>;

export const AdminOverviewDtoSchema = z.object({
  costsByMonth: z.array(MonthlyCostDtoSchema),
  fsSync: FsSyncStatusDtoSchema,
});
export type AdminOverviewDto = z.infer<typeof AdminOverviewDtoSchema>;
