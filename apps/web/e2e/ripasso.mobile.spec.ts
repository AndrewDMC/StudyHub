import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * Ripasso rapido end to end at phone size (docs/09-ripasso-mobile.md §5): home → expand subject
 * → start a topic → reveal → swipe → undo → summary → "Ripassa gli errori". Runs only in the
 * `mobile` project (playwright.config.ts).
 */

async function seedSubject(request: APIRequestContext, baseURL: string) {
  const name = `E2E Ripasso ${Date.now()}`;
  const created = await request.post(`${baseURL}/api/subjects`, { data: { name, color: 'teal' } });
  const { subject } = await created.json();
  const slug: string = subject.slug;
  const deckRes = await request.post(`${baseURL}/api/subjects/${slug}/decks`, {
    data: { title: 'Mazzo e2e' },
  });
  const { deck } = await deckRes.json();
  const topicRes = await request.post(`${baseURL}/api/subjects/${slug}/topics`, {
    data: { name: 'Argomento e2e' },
  });
  const { topic } = await topicRes.json();
  for (const i of [1, 2, 3]) {
    const res = await request.post(`${baseURL}/api/subjects/${slug}/flashcards`, {
      data: {
        deckId: deck.id,
        topicId: topic.id,
        front: `Domanda e2e ${i}`,
        back: `Risposta ${i}`,
      },
    });
    expect(res.status()).toBe(201);
  }
  return { name, slug };
}

test('Ripasso rapido: sessione completa con swipe, annulla e riepilogo', async ({
  page,
  request,
  baseURL,
}) => {
  test.setTimeout(90_000);
  const { name, slug } = await seedSubject(request, baseURL!);

  try {
    await page.goto('/ripasso');
    await expect(page.getByRole('heading', { name: 'Ripasso rapido' })).toBeVisible();
    await page.getByRole('button', { name: '5', exact: true }).click();
    await expect(page.getByRole('button', { name: '5', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    const toggle = page.getByRole('button', { name: `Argomenti di ${name}` });
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    await page
      .getByRole('listitem')
      .filter({ has: toggle })
      .getByRole('button', { name: 'Ripassa Argomento e2e, 3 card' })
      .click();

    const session = page.getByRole('dialog');
    const position = session.locator('p.font-mono').first();
    await expect(position).toHaveText('1 / 3');
    await expect(page.getByRole('navigation', { name: 'Navigazione principale' })).toBeHidden();

    // Reveal, then swipe left = "Di nuovo": the card goes back to the end of the session.
    await session.getByRole('button', { name: 'Mostra risposta' }).click();
    await expect(session.getByRole('group', { name: 'Quanto la ricordavi?' })).toBeVisible();
    const box = (await page.getByTestId('swipe-card').boundingBox())!;
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.7, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.4, y, { steps: 5 });
    await page.mouse.move(box.x + 10, y, { steps: 5 });
    await page.mouse.up();
    await expect(position).toHaveText('2 / 4');

    // Undo: back to the first card, answer still visible, the re-queued copy gone.
    await session.getByRole('button', { name: 'Annulla ultima valutazione' }).click();
    await expect(position).toHaveText('1 / 3');
    await expect(session.getByRole('group', { name: 'Quanto la ricordavi?' })).toBeVisible();

    const rate = async (label: string) => {
      await session
        .getByRole('button', { name: new RegExp(`^${label}, prossimo ripasso`) })
        .click();
    };
    await rate('Di nuovo');
    for (let i = 0; i < 3; i += 1) {
      await session.getByRole('button', { name: 'Mostra risposta' }).click();
      await rate('Bene');
    }

    await expect(session.getByRole('heading', { name: 'Sessione completata' })).toBeVisible();
    await expect(session.getByText('67%')).toBeVisible(); // 2 of 3 right at the first try
    await session.getByRole('button', { name: /Ripassa gli errori/ }).click();
    await expect(position).toHaveText('1 / 1');

    await session.getByRole('button', { name: 'Chiudi sessione' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByRole('navigation', { name: 'Navigazione principale' })).toBeVisible();
  } finally {
    await request.delete(`${baseURL}/api/subjects/${slug}`);
  }
});

test('Il deep link apre direttamente la sessione', async ({ page, request, baseURL }) => {
  const { slug } = await seedSubject(request, baseURL!);
  try {
    await page.goto(`/ripasso?materia=${slug}&n=2`);
    await expect(page.getByRole('dialog').locator('p.font-mono').first()).toHaveText('1 / 2');
  } finally {
    await request.delete(`${baseURL}/api/subjects/${slug}`);
  }
});
