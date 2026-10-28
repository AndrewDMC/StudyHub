import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@studyhub/db/testDb';
import { jobs, studyPlans } from '@studyhub/db';
import { FakeProvider } from '@studyhub/ai';
import { GeneratePlanRequestSchema } from '@studyhub/contracts';
import { createSubject } from '../src/lib/subjects';
import { proposePlanChange } from '../src/lib/planChange';
import { NotFoundError } from '../src/lib/examPrep';

describe('Modifica piano a parole', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let slug: string;
  let subjectId: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-change-'));
    db = await createTestDb();
    const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    slug = subject.slug;
    subjectId = subject.id;
  });
  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  async function addPlan() {
    const id = randomUUID();
    await db.insert(studyPlans).values({
      id,
      subjectId,
      startDate: '2026-10-20',
      targetDate: '2026-11-03',
      availability: { perWeekday: [0, 45, 45, 45, 45, 45, 60], blackoutDates: [] },
      prefs: {
        sessionLength: 50,
        intensity: 'standard',
        simulationCount: 'auto',
        simulationMinutes: 90,
        reviewMinutesPerCard: 0.5,
      },
      feasibility: {
        feasible: true,
        requiredMinutes: 0,
        availableMinutes: 0,
        shortfallMinutes: 0,
        unscheduledTopicKeys: [],
        strategies: [],
      },
      warnings: [],
      model: 'fake-v1',
      promptVersion: 'estimate_topics/v2',
      status: 'active',
    });
    return id;
  }

  it('turns the request into a new draft request, from today, without touching the plan', async () => {
    const planId = await addPlan();
    const proposal = await proposePlanChange(
      db,
      slug,
      { instruction: '3 ore al giorno, sabato libero, più intenso', planId },
      new FakeProvider(),
      '2026-10-28',
    );
    expect(proposal.request.startDate).toBe('2026-10-28');
    expect(proposal.request.availability.perWeekday).toEqual([0, 180, 180, 180, 180, 180, 0]);
    expect(proposal.request.prefs.intensity).toBe('sprint');
    expect(proposal.request.targetDate).toBe('2026-11-03');
    expect(proposal.changes.length).toBeGreaterThan(0);
    expect(GeneratePlanRequestSchema.safeParse(proposal.request).success).toBe(true);

    // A proposal writes nothing on the plan; only the cost ledger.
    const [plan] = await db.select().from(studyPlans).where(eq(studyPlans.id, planId));
    expect(plan!.availability.perWeekday).toEqual([0, 45, 45, 45, 45, 45, 60]);
    expect((await db.select().from(jobs)).map((j: { type: string }) => j.type)).toEqual([
      'plan_change',
    ]);
  });

  it('says plainly what it could not do', async () => {
    await addPlan();
    const proposal = await proposePlanChange(
      db,
      slug,
      { instruction: 'metti la fisica alle 9 di mattina' },
      new FakeProvider(),
      '2026-10-28',
    );
    expect(proposal.changes).toEqual([]);
    expect(proposal.notApplied).toHaveLength(1);
  });

  it('needs a plan to change', async () => {
    await expect(
      proposePlanChange(db, slug, { instruction: '3 ore' }, new FakeProvider(), '2026-10-28'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
