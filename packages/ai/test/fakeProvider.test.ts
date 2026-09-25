import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { FakeProvider } from '../src/fakeProvider.js';

const docId = randomUUID();

describe('FakeProvider.generateFlashcards', () => {
  const provider = new FakeProvider();

  it('is deterministic: same input -> same output', async () => {
    const input = {
      subjectName: 'Fisica 1',
      chunks: [
        {
          docId,
          page: 1,
          text: "L'entropia di un sistema isolato non diminuisce mai. Il secondo principio della termodinamica lo formalizza.",
        },
      ],
      count: 2 as const,
      types: ['basic' as const],
      difficulty: 1 as const,
      lang: 'it',
    };
    const a = await provider.generateFlashcards(input, 'irrelevant');
    const b = await provider.generateFlashcards(input, 'irrelevant');
    expect(a.data).toEqual(b.data);
  });

  it('every card quote appears verbatim in its cited chunk text', async () => {
    const text =
      "L'entropia di un sistema isolato non diminuisce mai. Il secondo principio della termodinamica lo formalizza. Boltzmann la collegò al disordine microscopico.";
    const { data } = await provider.generateFlashcards(
      {
        subjectName: 'Fisica 1',
        chunks: [{ docId, page: 5, text }],
        count: 3,
        types: ['basic'],
        difficulty: 1,
        lang: 'it',
      },
      'irrelevant',
    );
    expect(data.cards.length).toBeGreaterThan(0);
    for (const card of data.cards) {
      expect(text).toContain(card.sourceRef.quote);
      expect(card.sourceRef.docId).toBe(docId);
      expect(card.sourceRef.page).toBe(5);
    }
  });

  it('respects the requested count', async () => {
    const text =
      'Una. Due. Tre frasi qui sono più lunghe di venti caratteri ciascuna. Quattro frasi ancora più lunghe di venti caratteri.';
    const { data } = await provider.generateFlashcards(
      {
        subjectName: 'X',
        chunks: [{ docId, page: 1, text }],
        count: 1,
        types: ['basic'],
        difficulty: 1,
        lang: 'it',
      },
      'irrelevant',
    );
    expect(data.cards.length).toBeLessThanOrEqual(1);
  });

  it('cycles through the requested card types', async () => {
    const text =
      'Prima frase abbastanza lunga per contare. Seconda frase abbastanza lunga per contare.';
    const { data } = await provider.generateFlashcards(
      {
        subjectName: 'X',
        chunks: [{ docId, page: 1, text }],
        count: 2,
        types: ['basic', 'cloze'],
        difficulty: 1,
        lang: 'it',
      },
      'irrelevant',
    );
    expect(data.cards.map((c) => c.type)).toEqual(['basic', 'cloze']);
  });

  it('reports zero cost usage semantics via pricing (fake-v1 is free)', async () => {
    const { model } = await provider.generateFlashcards(
      {
        subjectName: 'X',
        chunks: [{ docId, page: 1, text: 'Una frase abbastanza lunga da contare come card.' }],
        count: 1,
        types: ['basic'],
        difficulty: 1,
        lang: 'it',
      },
      'irrelevant',
    );
    expect(model).toBe('fake-v1');
  });
});

describe('FakeProvider.estimateTopics', () => {
  const provider = new FakeProvider();

  it('is deterministic: same input -> same output', async () => {
    const input = {
      subjectName: 'Fisica 1',
      units: [
        {
          key: 'doc-a',
          name: 'Cap. 1',
          excerpt: "L'entropia di un sistema isolato non diminuisce mai.",
          pages: 10,
        },
        {
          key: 'doc-b',
          name: 'Cap. 2',
          excerpt: 'Il secondo principio della termodinamica lo formalizza.',
          pages: 20,
        },
      ],
    };
    const a = await provider.estimateTopics(input, 'irrelevant');
    const b = await provider.estimateTopics(input, 'irrelevant');
    expect(a.data).toEqual(b.data);
  });

  it('echoes back one estimate per unit, keyed the same way', async () => {
    const { data } = await provider.estimateTopics(
      {
        subjectName: 'X',
        units: [
          { key: 'doc-a', name: 'A', excerpt: 'Testo breve.', pages: 5 },
          { key: 'doc-b', name: 'B', excerpt: 'Altro testo breve.', pages: 15 },
        ],
      },
      'irrelevant',
    );
    expect(data.topics.map((t) => t.key).sort()).toEqual(['doc-a', 'doc-b']);
  });

  it('gives more exam weight to a longer unit', async () => {
    const { data } = await provider.estimateTopics(
      {
        subjectName: 'X',
        units: [
          { key: 'short', name: 'Short', excerpt: 'Poco materiale.', pages: 5 },
          { key: 'long', name: 'Long', excerpt: 'Molto più materiale qui.', pages: 45 },
        ],
      },
      'irrelevant',
    );
    const short = data.topics.find((t) => t.key === 'short')!;
    const long = data.topics.find((t) => t.key === 'long')!;
    expect(long.examWeight).toBeGreaterThan(short.examWeight);
  });

  it('never estimates below one session block, even for a near-empty unit', async () => {
    const { data } = await provider.estimateTopics(
      { subjectName: 'X', units: [{ key: 'tiny', name: 'Tiny', excerpt: 'x', pages: 1 }] },
      'irrelevant',
    );
    expect(data.topics[0]!.estimatedMinutes).toBeGreaterThanOrEqual(20);
  });

  it('difficulty stays within 1..5', async () => {
    const { data } = await provider.estimateTopics(
      {
        subjectName: 'X',
        units: [
          {
            key: 'dense',
            name: 'Dense',
            excerpt:
              'Termodinamica statistica entropia microstati macrostati Boltzmann distribuzione probabilità equilibrio irreversibilità.',
            pages: 10,
          },
        ],
      },
      'irrelevant',
    );
    expect(data.topics[0]!.difficulty).toBeGreaterThanOrEqual(1);
    expect(data.topics[0]!.difficulty).toBeLessThanOrEqual(5);
  });
});

describe('FakeProvider.generateSchema', () => {
  const provider = new FakeProvider();

  it('every node quote appears verbatim in its cited chunk text', async () => {
    const text =
      "L'entropia di un sistema isolato non diminuisce mai. Il secondo principio della termodinamica lo formalizza.";
    const { data } = await provider.generateSchema(
      {
        subjectName: 'Fisica 1',
        chunks: [{ docId, page: 3, text }],
        depth: 2,
        style: 'gerarchico',
      },
      'irrelevant',
    );
    expect(data.nodes.length).toBeGreaterThan(0);
    for (const node of data.nodes) {
      expect(text).toContain(node.sourceRef.quote);
      expect(node.sourceRef.docId).toBe(docId);
      expect(node.sourceRef.page).toBe(3);
    }
  });

  it('omits the mermaid diagram for a confronto-style schema', async () => {
    const { data } = await provider.generateSchema(
      {
        subjectName: 'X',
        chunks: [{ docId, page: 1, text: 'Contenuto sufficientemente lungo da generare un nodo.' }],
        depth: 1,
        style: 'confronto',
      },
      'irrelevant',
    );
    expect(data.mermaid).toBeUndefined();
  });

  it('includes a mermaid graph for a gerarchico-style schema', async () => {
    const { data } = await provider.generateSchema(
      {
        subjectName: 'X',
        chunks: [{ docId, page: 1, text: 'Contenuto sufficientemente lungo da generare un nodo.' }],
        depth: 1,
        style: 'gerarchico',
      },
      'irrelevant',
    );
    expect(data.mermaid).toContain('graph TD');
  });
});

describe('FakeProvider.generateSummary', () => {
  const provider = new FakeProvider();

  it('produces markdown with one section per chunk', async () => {
    const { data } = await provider.generateSummary(
      {
        subjectName: 'Fisica 1',
        chunks: [
          { docId, page: 1, text: 'Prima sezione di contenuto.' },
          { docId, page: 2, text: 'Seconda sezione di contenuto.' },
        ],
        length: 'standard',
      },
      'irrelevant',
    );
    expect(data.markdown).toContain('Sezione 1');
    expect(data.markdown).toContain('Sezione 2');
    expect(data.markdown).toContain('Fisica 1');
  });
});
