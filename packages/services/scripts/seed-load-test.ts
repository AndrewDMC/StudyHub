import { randomUUID } from 'node:crypto';
import { artifacts, createDb, documents, flashcards, type DocumentType } from '@studyhub/db';
import { createSubjectRow } from '../src/subjects.js';

/**
 * Seeds one subject with 200 documents and 2000 flashcards (docs/fasi/F2-materie.md "La pagina
 * con 200 documenti e 2000 flashcard resta reattiva" — a manual load-test fixture for
 * `DocumentList`/`FlashcardListPanel`'s virtualization, no worker/OCR pipeline involved).
 *
 * Usage (against a running Postgres, e.g. `docker compose -f docker/docker-compose.yml up postgres`):
 *   DATABASE_URL=postgres://studyhub:studyhub@localhost:5432/studyhub \
 *   STUDYHUB_DATA_DIR=./data \
 *   pnpm --filter @studyhub/services exec tsx scripts/seed-load-test.ts
 */
const DOC_COUNT = 200;
const CARD_COUNT = 2000;
const DOC_TYPES: DocumentType[] = ['appunti', 'schemi', 'esami'];
const CARD_STATES = ['new', 'learning', 'review', 'relearning'] as const;

async function main() {
  const dataRoot = process.env.STUDYHUB_DATA_DIR ?? process.argv[2];
  if (!dataRoot) {
    console.error(
      'Serve una cartella dati: STUDYHUB_DATA_DIR=<path> pnpm --filter @studyhub/services exec tsx scripts/seed-load-test.ts',
    );
    process.exit(1);
  }

  const db = createDb(process.env.DATABASE_URL);

  const subject = await createSubjectRow(db, dataRoot, {
    name: `Load Test ${new Date().toISOString().slice(0, 19)}`,
    color: 'blue',
  });
  console.log(`Materia creata: ${subject.slug} (${subject.id})`);

  await db.insert(documents).values(
    Array.from({ length: DOC_COUNT }, (_, i) => ({
      id: randomUUID(),
      subjectId: subject.id,
      type: DOC_TYPES[i % DOC_TYPES.length]!,
      originalName: `documento-${i}.pdf`,
      storedPath: `/load-test/${i}.pdf`,
      mime: 'application/pdf',
      bytes: 1024 * (i + 1),
      sha256: i.toString().padStart(64, '0'),
      status: 'parsed' as const,
      pages: 10 + (i % 40),
    })),
  );
  console.log(`${DOC_COUNT} documenti inseriti (tutti "parsed").`);

  const deckId = randomUUID();
  await db.insert(artifacts).values({
    id: deckId,
    subjectId: subject.id,
    kind: 'flashcard_deck',
    title: 'Load test deck',
    path: '/load-test/deck.json',
    model: 'fake-v1',
    promptVersion: 'flashcards/v1',
  });
  await db.insert(flashcards).values(
    Array.from({ length: CARD_COUNT }, (_, i) => ({
      id: randomUUID(),
      deckId,
      type: 'basic' as const,
      front: `Domanda di prova #${i}`,
      back: `Risposta di prova #${i}`,
      sourceRef: { docId: randomUUID(), page: 1, quote: 'x' },
      state: CARD_STATES[i % CARD_STATES.length]!,
    })),
  );
  console.log(`${CARD_COUNT} flashcard inserite.`);
  console.log(
    `Apri /materie/${subject.slug} (tab Appunti/Schemi/Esami/Flashcard) per il test di carico.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
