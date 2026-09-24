import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDb } from '@studyhub/db/testDb';
import { addSubject } from '../src/commands/subject.js';
import { generatePlanCli, listPlansCli, SubjectNotFoundCliError } from '../src/commands/plan.js';

const WEEKLY = [0, 120, 120, 120, 120, 120, 0];

describe('CLI plan commands', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let subjectSlug: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-cli-plan-'));
    db = await createTestDb();
    const subject = await addSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    subjectSlug = subject.slug;
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('generates a draft plan in-process, no queue/Redis involved', async () => {
    const result = await generatePlanCli(db, {
      subjectSlug,
      startDate: '2026-01-05',
      targetDate: '2026-02-04',
      weekly: WEEKLY,
    });
    expect(result.planId).toBeTruthy();
    expect(result.feasible).toBe(true); // no material yet, trivially feasible
    expect(result.costEur).toBe(0); // FakeProvider, and no material to estimate anyway
  });

  it('throws SubjectNotFoundCliError for an unknown slug', async () => {
    await expect(
      generatePlanCli(db, {
        subjectSlug: 'nope',
        startDate: '2026-01-05',
        targetDate: '2026-02-04',
        weekly: WEEKLY,
      }),
    ).rejects.toBeInstanceOf(SubjectNotFoundCliError);
  });

  it('lists plans newest first with their task count, and throws for an unknown subject', async () => {
    await generatePlanCli(db, {
      subjectSlug,
      startDate: '2026-01-05',
      targetDate: '2026-02-04',
      weekly: WEEKLY,
    });
    // Regenerating replaces the draft (docs/fasi/F6-planner-calendario.md), so there's still one row.
    const second = await generatePlanCli(db, {
      subjectSlug,
      startDate: '2026-01-05',
      targetDate: '2026-02-04',
      weekly: WEEKLY,
    });

    const rows = await listPlansCli(db, subjectSlug);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(second.planId);
    expect(rows[0]!.status).toBe('draft');

    await expect(listPlansCli(db, 'nope')).rejects.toBeInstanceOf(SubjectNotFoundCliError);
  });
});
