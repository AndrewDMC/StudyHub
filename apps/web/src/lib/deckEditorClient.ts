import type {
  ArtifactDto,
  BulkFlashcardsRequest,
  CreateFlashcardRequest,
  FlashcardDto,
  UpdateFlashcardRequest,
} from '@studyhub/contracts';

/** Thin fetch wrappers for the deck editor endpoints; every failure surfaces the server's message. */
async function call<T>(url: string, init: RequestInit | undefined, fallback: string): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? fallback);
  return body as T;
}

const json = (method: string, data: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});

export async function fetchDecks(slug: string): Promise<ArtifactDto[]> {
  const { artifacts } = await call<{ artifacts: ArtifactDto[] }>(
    `/api/subjects/${slug}/artifacts`,
    undefined,
    'Impossibile caricare i mazzi',
  );
  return artifacts.filter((a) => a.kind === 'flashcard_deck');
}

export async function fetchTags(slug: string): Promise<{ tag: string; count: number }[]> {
  const { tags } = await call<{ tags: { tag: string; count: number }[] }>(
    `/api/subjects/${slug}/tags`,
    undefined,
    'Impossibile caricare i tag',
  );
  return tags;
}

export async function createDeck(slug: string, title: string): Promise<ArtifactDto> {
  const { deck } = await call<{ deck: ArtifactDto }>(
    `/api/subjects/${slug}/decks`,
    json('POST', { title }),
    'Creazione del mazzo fallita',
  );
  return deck;
}

export async function createCard(
  slug: string,
  input: CreateFlashcardRequest,
): Promise<FlashcardDto> {
  const { flashcard } = await call<{ flashcard: FlashcardDto }>(
    `/api/subjects/${slug}/flashcards`,
    json('POST', input),
    'Creazione della card fallita',
  );
  return flashcard;
}

export async function updateCard(
  slug: string,
  cardId: string,
  patch: UpdateFlashcardRequest,
): Promise<FlashcardDto> {
  const { flashcard } = await call<{ flashcard: FlashcardDto }>(
    `/api/subjects/${slug}/flashcards/${cardId}`,
    json('PATCH', patch),
    'Aggiornamento fallito',
  );
  return flashcard;
}

export async function deleteCard(slug: string, cardId: string): Promise<void> {
  await call(
    `/api/subjects/${slug}/flashcards/${cardId}`,
    { method: 'DELETE' },
    'Eliminazione fallita',
  );
}

export async function bulkCards(slug: string, request: BulkFlashcardsRequest): Promise<number> {
  const { affected } = await call<{ affected: number }>(
    `/api/subjects/${slug}/flashcards/bulk`,
    json('POST', request),
    'Operazione in blocco fallita',
  );
  return affected;
}

export async function mergeDecks(
  slug: string,
  sourceDeckId: string,
  targetDeckId: string,
): Promise<number> {
  const { moved } = await call<{ moved: number }>(
    `/api/subjects/${slug}/decks/merge`,
    json('POST', { sourceDeckId, targetDeckId }),
    'Unione dei mazzi fallita',
  );
  return moved;
}

export interface ImportDeckOutcome {
  deck: ArtifactDto;
  imported: number;
  duplicates: number;
  warnings: string[];
}

/** Uploads a `.apkg` / `.csv`; into `deckId` if given, otherwise into a new deck. */
export async function importDeck(
  slug: string,
  file: File,
  deckId?: string,
): Promise<ImportDeckOutcome> {
  const form = new FormData();
  form.set('file', file);
  if (deckId) form.set('deckId', deckId);
  return call<ImportDeckOutcome>(
    `/api/subjects/${slug}/decks/import`,
    { method: 'POST', body: form },
    'Importazione fallita',
  );
}
