import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';
import { studyPlans, tasks } from '@studyhub/db';
import {
  dayOffset,
  db,
  deleteSubject,
  planStatus,
  seedPlan,
  taskStatus,
} from './fixtures/lacune-piano-seed';

/**
 * Slice C dei residui mobile: modifiche a un piano attivo (Modifica ritmo -> nuova bozza, escludi
 * argomento con conferma, "Sposta di 1 giorno" a gruppo, Fissa) a 375×812. Il worker non gira:
 * la bozza generata si simula via DB, come negli altri e2e del piano.
 */

test.use({ viewport: { width: 375, height: 812 } });

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBe(0);
}

/** Controlli interattivi visibili più bassi di 44px. */
async function smallTargets(page: Page, scope: string) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return ['(scope mancante)'];
    return Array.from(
      root.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea'),
    )
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
      })
      .filter((el) => el.getBoundingClientRect().height < 43.5)
      .filter((el) => {
        const label = el.closest('label');
        return !(
          el instanceof HTMLInputElement &&
          label &&
          label.getBoundingClientRect().height >= 43.5
        );
      })
      .map(
        (el) =>
          `${el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)}" ${Math.round(el.getBoundingClientRect().height)}px`,
      );
  }, scope);
}

test.describe('Materia mobile — Piano attivo: modifiche (slice C)', () => {
  let slug: string | undefined;

  test.afterEach(async ({ request, baseURL }) => {
    if (slug) await deleteSubject(request, baseURL!, slug);
    slug = undefined;
  });

  const pianoUrl = (s: { slug: string }) => `/materie/${s.slug}/piano`;

  test('Modifica ritmo: sheet precompilato con i valori dell’attivo, bozza generata, l’attivo resta finché non si conferma', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(150_000);
    const seed = await seedPlan(request, baseURL!, {
      status: 'active',
      targetOffset: 12,
      tasks: [
        { offset: 0, title: 'Studia Termodinamica', topicKey: 'doc-a' },
        { offset: 1, title: 'Studia Ottica', topicKey: 'doc-b' },
      ],
    });
    slug = seed.slug;
    await page.goto(pianoUrl(seed));

    const summary = page.getByRole('region', { name: 'Piano di studio' });
    await expect(summary).toContainText('Attivo', { timeout: 30_000 });
    const edit = summary.getByTestId('plan-edit-pace');
    await expect(edit).toBeVisible();
    await edit.click();

    const sheet = page.getByRole('dialog', { name: 'Modifica ritmo' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByLabel('Data esame')).toHaveValue(dayOffset(12));
    const rhythm = sheet.getByRole('group', { name: 'Ritmo del piano' });
    await expect(rhythm.getByRole('button', { name: 'Standard' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Media di [60, 90, 90, 90, 90, 90, 60] = ~81.
    const minutesField = sheet.getByLabel('Minuti al giorno');
    const original = Number(await minutesField.inputValue());
    expect(original).toBeGreaterThanOrEqual(80);
    expect(original).toBeLessThanOrEqual(82);
    await expect(sheet.getByTestId('plan-edit-note')).toContainText(
      'non tiene conto delle lezioni già fatte',
    );
    expect(await smallTargets(page, '[role="dialog"]')).toEqual([]);

    await rhythm.getByRole('button', { name: 'Sprint' }).click();
    await minutesField.fill('120');

    const post = page.waitForRequest(
      (r) => r.method() === 'POST' && /\/plan$/.test(new URL(r.url()).pathname),
    );
    await sheet.getByTestId('plan-sheet-submit').click();
    const body = (await post).postDataJSON();
    expect(body.prefs.intensity).toBe('sprint');
    expect(body.targetDate).toBe(dayOffset(12));
    const week: number[] = body.availability.perWeekday;
    expect(Math.abs(week.reduce((a, b) => a + b, 0) / week.length - 120)).toBeLessThanOrEqual(3);

    await expect(sheet).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByText('Generazione in corso — la bozza appare a breve.')).toBeVisible({
      timeout: 20_000,
    });
    // L'attivo resta invariato durante la generazione.
    expect(await planStatus(seed.planId)).toBe('active');
    await expect(summary).toContainText('Attivo');
    await expect(edit).toBeDisabled();

    // Il worker non gira: simula la bozza con le nuove prefs.
    const draftId = randomUUID();
    await db.insert(studyPlans).values({
      id: draftId,
      subjectId: seed.subjectId,
      status: 'draft',
      startDate: dayOffset(0),
      targetDate: dayOffset(12),
      availability: { perWeekday: [120, 120, 120, 120, 120, 120, 120], blackoutDates: [] },
      prefs: {
        sessionLength: 50,
        intensity: 'sprint',
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
      promptVersion: 'estimate_topics/v1',
    });
    await db.insert(tasks).values({
      id: randomUUID(),
      subjectId: seed.subjectId,
      planId: draftId,
      taskKey: 'read:e2e:900',
      date: dayOffset(1),
      kind: 'read',
      minutes: 45,
      title: 'Studia Termodinamica',
      description: '',
      payload: { action: 'read' },
      status: 'proposed',
    });

    // La vista passa alla bozza con le nuove prefs e l'avviso.
    await expect(page.getByRole('button', { name: 'Conferma piano' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(summary).toContainText('Bozza');
    await expect(summary).toContainText('Sprint');
    await expect(summary).toContainText('~120');
    await expect(page.getByTestId('plan-notice')).toContainText(
      'Bozza pronta: controllala e confermala.',
    );
    await expect(summary.getByTestId('plan-edit-pace')).toHaveCount(0);
    expect(await planStatus(seed.planId)).toBe('active');

    // Con attivo e bozza insieme: chip dei piani e ritorno all'attivo, con "Apri la bozza".
    const chips = page.getByRole('group', { name: 'Piani della materia' });
    await expect(chips.getByRole('button')).toHaveCount(2);
    await chips.getByRole('button', { pressed: false }).click();
    await expect(summary).toContainText('Attivo');
    await page.getByTestId('plan-draft-pending-open').click();
    await expect(summary).toContainText('Bozza');
    await noHorizontalScroll(page);

    // Conferma: l'attivo precedente è superseded.
    await page.getByRole('button', { name: 'Conferma piano' }).click();
    await expect(page.getByRole('button', { name: 'Conferma piano' })).toHaveCount(0, {
      timeout: 20_000,
    });
    await expect.poll(() => planStatus(draftId), { timeout: 20_000 }).toBe('active');
    expect(await planStatus(seed.planId)).toBe('superseded');
  });

  test('Escludi un argomento su attivo: conferma con il conteggio, Indietro non cambia nulla, poi aperte skipped e fatte invariate', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const seed = await seedPlan(request, baseURL!, {
      status: 'active',
      targetOffset: 12,
      tasks: [
        { offset: 0, title: 'Studia Termodinamica — cap. 1', topicKey: 'doc-a' },
        { offset: 1, title: 'Studia Termodinamica — cap. 2', topicKey: 'doc-a' },
        { offset: -1, kind: 'flashcards', title: 'Flashcard termo', topicKey: 'doc-a' },
        { offset: 0, title: 'Termodinamica già fatta', topicKey: 'doc-a', status: 'done' },
        { offset: 0, title: 'Studia Ottica — cap. 1', topicKey: 'doc-b' },
      ],
    });
    slug = seed.slug;
    await page.goto(pianoUrl(seed));

    const open = page.getByTestId('plan-exclude-open');
    await expect(open).toBeVisible({ timeout: 30_000 });
    await expect(open).toHaveText('Escludi un argomento…');
    await open.click();

    const sheet = page.getByRole('dialog', { name: 'Escludi un argomento' });
    await expect(sheet.getByRole('radio')).toHaveCount(2);
    await expect(sheet.getByText('3 da fare')).toBeVisible();
    await expect(sheet.getByText('1 da fare')).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Continua' })).toBeDisabled();
    expect(await smallTargets(page, '[role="dialog"]')).toEqual([]);

    await sheet.getByRole('radio', { name: /Termodinamica/ }).check();
    await sheet.getByRole('button', { name: 'Continua' }).click();
    await expect(sheet.getByTestId('plan-exclude-confirm-text')).toHaveText(
      '3 lezioni verranno segnate come saltate.',
    );
    await expect(sheet.getByRole('heading', { name: 'Escludere «Termodinamica»?' })).toBeVisible();
    expect(await smallTargets(page, '[role="dialog"]')).toEqual([]);

    // Indietro: nessuna modifica.
    await sheet.getByRole('button', { name: 'Indietro' }).click();
    await expect(sheet.getByRole('radio', { name: /Termodinamica/ })).toBeChecked();
    for (const i of [0, 1, 2, 4]) expect((await taskStatus(seed.taskIds[i]!))!.status).toBe('todo');

    await sheet.getByRole('button', { name: 'Continua' }).click();
    await sheet.getByTestId('plan-exclude-confirm').click();
    await expect(sheet).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByTestId('plan-notice')).toHaveText('3 lezioni segnate come saltate.');
    await expect(
      page.getByRole('button', { name: /^Lettura, Studia Termodinamica — cap\. 1.*· saltata/ }),
    ).toBeVisible({ timeout: 20_000 });

    for (const i of [0, 1, 2]) {
      expect((await taskStatus(seed.taskIds[i]!))!.status).toBe('skipped');
    }
    expect((await taskStatus(seed.taskIds[3]!))!.status).toBe('done');
    expect((await taskStatus(seed.taskIds[4]!))!.status).toBe('todo');
    expect(await planStatus(seed.planId)).toBe('active');
    await noHorizontalScroll(page);
  });

  test('DriftCard: "Sposta di 1 giorno" sposta tutte le task in ritardo con una sola richiesta', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedPlan(request, baseURL!, {
      status: 'active',
      targetOffset: 12,
      tasks: [
        { offset: -3, title: 'Arretrata uno', minutes: 20 },
        { offset: -2, title: 'Arretrata due', minutes: 20 },
        { offset: -1, title: 'Arretrata tre', minutes: 20 },
        { offset: 0, title: 'Task di oggi', minutes: 20 },
      ],
    });
    slug = seed.slug;
    const moves: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/plan\/tasks\/move$/.test(new URL(r.url()).pathname)) {
        moves.push(r.postData() ?? '');
      }
    });
    await page.goto(pianoUrl(seed));

    const drift = page.getByRole('status').filter({ hasText: 'Sei indietro di 3 task' });
    await expect(drift).toBeVisible({ timeout: 30_000 });
    const btn = drift.getByTestId('drift-move-day');
    await expect(btn).toHaveText('Sposta di 1 giorno');
    await expect(btn).toHaveAccessibleName('Sposta di 1 giorno le 3 task in ritardo');
    expect(await smallTargets(page, '[role="status"]')).toEqual([]);
    await noHorizontalScroll(page);

    await btn.click();
    await expect(page.getByTestId('plan-notice')).toHaveText('3 task spostate.', {
      timeout: 20_000,
    });
    expect(moves).toHaveLength(1);
    const sent = JSON.parse(moves[0]!);
    expect([...sent.taskIds].sort()).toEqual([...seed.taskIds.slice(0, 3)].sort());
    expect(sent.days).toBe(1);

    expect((await taskStatus(seed.taskIds[0]!))!.date).toBe(dayOffset(-2));
    expect((await taskStatus(seed.taskIds[1]!))!.date).toBe(dayOffset(-1));
    expect((await taskStatus(seed.taskIds[2]!))!.date).toBe(dayOffset(0));
    expect((await taskStatus(seed.taskIds[3]!))!.date).toBe(dayOffset(0));
    // Restano 2 task in ritardo: la card si aggiorna.
    await expect(
      page.getByRole('status').filter({ hasText: 'Sei indietro di 2 task' }),
    ).toBeVisible({ timeout: 20_000 });
  });

  test('Fissa su task di piano attivo: persistito dopo il reload; non compare su task fatta', async ({
    page,
    request,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const seed = await seedPlan(request, baseURL!, {
      status: 'active',
      targetOffset: 12,
      tasks: [
        { offset: 0, title: 'Da fissare', minutes: 30 },
        { offset: 0, title: 'Già fatta', minutes: 20, status: 'done' },
      ],
    });
    slug = seed.slug;
    await page.goto(pianoUrl(seed));

    // Task chiusa: niente Fissa.
    await page.getByRole('button', { name: /^Lettura, Già fatta/ }).click({ timeout: 30_000 });
    const done = page.getByRole('dialog', { name: 'Già fatta' });
    await expect(done.getByRole('button', { name: 'Riapri' })).toBeVisible();
    await expect(done.getByTestId('task-pin')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(done).toHaveCount(0);

    await page.getByRole('button', { name: /^Lettura, Da fissare/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Da fissare' });
    const pin = sheet.getByTestId('task-pin');
    await expect(pin).toHaveText('Fissa');
    await expect(sheet).toContainText('Una nuova bozza la tiene alla stessa data.');
    expect(await smallTargets(page, '[role="dialog"]')).toEqual([]);
    await pin.click();
    await expect(sheet).toHaveCount(0, { timeout: 20_000 });
    expect((await taskStatus(seed.taskIds[0]!))!.pinned).toBe(true);
    await expect(page.getByRole('button', { name: /^Lettura, Da fissare.*· fissata/ })).toBeVisible(
      { timeout: 20_000 },
    );

    await page.reload();
    const row = page.getByRole('button', { name: /^Lettura, Da fissare.*· fissata/ });
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();
    await expect(
      page.getByRole('dialog', { name: 'Da fissare' }).getByTestId('task-pin'),
    ).toHaveText('Sblocca');
    await noHorizontalScroll(page);
  });
});
