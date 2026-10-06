import type {
  AiProvider,
  ChatDelta,
  ClassifyDocumentTypePromptInput,
  DistillHandwritingProfilePromptInput,
  EstimateTopicsPromptInput,
  ExamProfilePromptInput,
  ExtractTopicsPromptInput,
  FlashcardsPromptInput,
  GeneratedWithMeta,
  GradePromptInput,
  OcrTextPromptInput,
  SchemaPromptInput,
  SchemaTranscriptionPromptInput,
  SessionBriefingPromptInput,
  SessionChatPromptInput,
  SimulationPromptInput,
  SummaryPromptInput,
} from './provider.js';
import type {
  ClassifyDocumentTypeOutput,
  DistillHandwritingProfileOutput,
  EstimateTopicsOutput,
  ExamProfile,
  ExtractedTopic,
  ExtractTopicsOutput,
  FlashcardsOutput,
  GeneratedFlashcard,
  GradeOutput,
  OcrTextOutput,
  SchemaGraphOutput,
  SchemaNode,
  SchemaOutput,
  SessionBriefingOutput,
  SimulationOutput,
  SummaryOutput,
  TopicEstimate,
} from './schemas.js';
import { estimateTokens } from './pricing.js';
import { keywordCoverage, keywords, splitSentences, truncate } from './text.js';
import { renderSessionChatUserPrompt } from './promptRender.js';
import { fakeExtractExamProfile, fakeGenerateSimulation, fakeGradeAnswer } from './fakeExam.js';
import {
  CLASSIFY_DOCUMENT_TYPE_PROMPT_VERSION,
  DISTILL_HANDWRITING_PROFILE_PROMPT_VERSION,
  ESTIMATE_TOPICS_PROMPT_VERSION,
  EXAM_PROFILE_PROMPT_VERSION,
  EXTRACT_TOPICS_PROMPT_VERSION,
  FLASHCARDS_PROMPT_VERSION,
  GRADING_PROMPT_VERSION,
  OCR_TEXT_PROMPT_VERSION,
  SCHEMA_PROMPT_VERSION,
  SCHEMA_TRANSCRIPTION_PROMPT_VERSION,
  SESSION_BRIEFING_PROMPT_VERSION,
  SESSION_CHAT_PROMPT_VERSION,
  SIMULATION_PROMPT_VERSION,
  SUMMARY_PROMPT_VERSION,
} from './versions.js';

const FAKE_MODEL = 'fake-v1';

/**
 * Deterministic, offline stand-in for a real LLM. It does real extractive
 * work (splits sentences, picks candidates, quotes them verbatim) rather
 * than returning canned data — so every quote genuinely appears in its
 * source chunk, and the citation-validation step in
 * `functions/generateFlashcards.ts` has something real to check.
 *
 * Deliberately NOT a substitute for a real model's judgment (it can't tell
 * which sentence is a good flashcard front) — it exists to let the rest of
 * the pipeline (job orchestration, persistence, review UI, idempotency,
 * budget guard) be built and tested for real before anyone pays for
 * inference. Swap in `AnthropicProvider` by setting `ANTHROPIC_API_KEY`.
 */
export class FakeProvider implements AiProvider {
  readonly name = 'fake';

  async generateFlashcards(
    input: FlashcardsPromptInput,
    _model: string,
  ): Promise<GeneratedWithMeta<FlashcardsOutput>> {
    const targetCount =
      input.count === 'auto' ? Math.min(input.chunks.length * 2, 20) : input.count;
    const cards: GeneratedFlashcard[] = [];

    for (const chunk of input.chunks) {
      if (cards.length >= targetCount) break;
      for (const sentence of splitSentences(chunk.text)) {
        if (cards.length >= targetCount) break;
        if (sentence.length < 20) continue; // too short to be an atomic fact

        const type = input.types[cards.length % input.types.length] ?? 'basic';
        cards.push({
          type,
          front:
            type === 'cloze'
              ? clozeify(sentence)
              : `Cosa afferma il materiale su: "${truncate(sentence, 50)}"?`,
          back: sentence,
          sourceRef: { docId: chunk.docId, page: chunk.page, quote: sentence },
        });
      }
    }

    const inputTokens = input.chunks.reduce((sum, c) => sum + estimateTokens(c.text), 0);
    const outputTokens = cards.reduce((sum, c) => sum + estimateTokens(c.front + c.back), 0);

    return {
      data: { cards },
      usage: { inputTokens, outputTokens },
      model: FAKE_MODEL,
      promptVersion: FLASHCARDS_PROMPT_VERSION,
    };
  }

  async generateSummary(
    input: SummaryPromptInput,
    _model: string,
  ): Promise<GeneratedWithMeta<SummaryOutput>> {
    const sentencesPerChunk = input.length === 'flash' ? 1 : input.length === 'esteso' ? 4 : 2;
    const sections = input.chunks.map((chunk, i) => {
      const bullets = splitSentences(chunk.text).slice(0, sentencesPerChunk);
      return [`## Sezione ${i + 1} (pag. ${chunk.page})`, ...bullets.map((b) => `- ${b}`)].join(
        '\n',
      );
    });

    const markdown = [`# Riassunto — ${input.subjectName}`, '', ...sections, ''].join('\n\n');
    const inputTokens = input.chunks.reduce((sum, c) => sum + estimateTokens(c.text), 0);
    const outputTokens = estimateTokens(markdown);

    return {
      data: { markdown, glossary: [] },
      usage: { inputTokens, outputTokens },
      model: FAKE_MODEL,
      promptVersion: SUMMARY_PROMPT_VERSION,
    };
  }

  /**
   * Extractive stand-in: key points are the first substantial sentence of spread-out chunks, exercises
   * are cloze blanks on a long word of such a sentence. Every quote is a verbatim sentence of its chunk.
   */
  async generateSessionBriefing(
    input: SessionBriefingPromptInput,
    _model: string,
  ): Promise<GeneratedWithMeta<SessionBriefingOutput>> {
    const candidates = input.chunks.flatMap((chunk) => {
      const sentence = splitSentences(chunk.text).find((s) => s.length >= 30);
      return sentence ? [{ chunk, sentence }] : [];
    });
    const spread = <T>(items: T[], count: number): T[] => {
      if (count <= 0 || items.length === 0) return [];
      if (items.length <= count) return items;
      return Array.from(
        { length: count },
        (_, i) => items[Math.floor((i * items.length) / count)]!,
      );
    };

    const keyPoints = spread(candidates, input.keyPointCount).map(({ chunk, sentence }) => ({
      title: truncate(sentence, 80),
      explanation: sentence,
      sourceRef: { docId: chunk.docId, page: chunk.page, quote: sentence },
    }));

    const existing = new Set(input.existingExercises);
    const blanks = candidates.flatMap(({ chunk, sentence }) => {
      const word = sentence
        .split(/\s+/)
        .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
        .filter((w) => w.length >= 6)
        .sort((a, b) => b.length - a.length)[0];
      if (!word) return [];
      const prompt = `Completa la frase: "${sentence.replace(word, '____')}"`;
      return existing.has(prompt) ? [] : [{ chunk, sentence, word, prompt }];
    });
    const exercises = spread(blanks, input.exerciseCount).map(
      ({ chunk, sentence, word, prompt }, i) => ({
        prompt,
        solution: `${word} — «${sentence}»`,
        difficulty: Math.min(3, 1 + Math.floor((i * 3) / Math.max(1, input.exerciseCount))),
        sourceRef: { docId: chunk.docId, page: chunk.page, quote: sentence },
      }),
    );

    const data: SessionBriefingOutput = { keyPoints, exercises };
    return {
      data,
      usage: {
        inputTokens: input.chunks.reduce((sum, c) => sum + estimateTokens(c.text), 0),
        outputTokens: estimateTokens(JSON.stringify(data)),
      },
      model: FAKE_MODEL,
      promptVersion: SESSION_BRIEFING_PROMPT_VERSION,
    };
  }

  async generateSchema(
    input: SchemaPromptInput,
    _model: string,
  ): Promise<GeneratedWithMeta<SchemaOutput>> {
    const nodes: SchemaNode[] = input.chunks.map((chunk, i) => {
      const quote =
        splitSentences(chunk.text).find((s) => s.length >= 20) ?? chunk.text.slice(0, 50);
      return {
        nodeId: `n${i + 1}`,
        label: truncate(quote, 60),
        sourceRef: { docId: chunk.docId, page: chunk.page, quote },
      };
    });

    const sections = nodes.map((n) => `## ${n.label}\n\n- Fonte: pag. ${n.sourceRef.page}`);
    const markdown = [`# Schema — ${input.subjectName}`, '', ...sections, ''].join('\n\n');

    // A 'confronto' reads better as a table in Markdown alone (docs/03 §3.2) — no diagram.
    const mermaid =
      input.style === 'confronto'
        ? undefined
        : [
            'graph TD',
            ...nodes.map((n) => `  ${n.nodeId}["${n.label.replace(/"/g, "'")}"]`),
            ...nodes.slice(1).map((n, i) => `  ${nodes[i]!.nodeId} --> ${n.nodeId}`),
          ].join('\n');

    const data: SchemaOutput = { markdown, mermaid, nodes };
    const inputTokens = input.chunks.reduce((sum, c) => sum + estimateTokens(c.text), 0);
    const outputTokens = estimateTokens(JSON.stringify(data));

    return {
      data,
      usage: { inputTokens, outputTokens },
      model: FAKE_MODEL,
      promptVersion: SCHEMA_PROMPT_VERSION,
    };
  }

  /**
   * Unlike text extraction, a photo's pixels can't be read deterministically
   * without a real vision model — there's nothing honest to fabricate here
   * (docs/fasi/F3-ai-core.md "Stato" addendum spirit: simulate what can
   * genuinely be computed offline, never invent what can't). Returns a
   * single block explaining that, so the verification screen has something
   * real to show instead of silently doing nothing.
   */
  async transcribeSchema(
    _input: SchemaTranscriptionPromptInput,
    _model: string,
  ): Promise<GeneratedWithMeta<SchemaGraphOutput>> {
    const data: SchemaGraphOutput = {
      nodes: [
        {
          key: 'n1',
          label: 'Trascrizione non disponibile in modalità simulata — inserisci i nodi a mano.',
          kind: 'concetto',
          crop: null,
          confidence: 'unreadable',
        },
      ],
      edges: [],
      groups: [],
    };
    return {
      data,
      usage: { inputTokens: 0, outputTokens: 0 },
      model: FAKE_MODEL,
      promptVersion: SCHEMA_TRANSCRIPTION_PROMPT_VERSION,
    };
  }

  /** Same "no honest pixel-reading offline" reasoning as transcribeSchema. */
  async ocrText(
    _input: OcrTextPromptInput,
    _model: string,
  ): Promise<GeneratedWithMeta<OcrTextOutput>> {
    const data: OcrTextOutput = {
      text: '',
      confidence: 'illegible',
    };
    return {
      data,
      usage: { inputTokens: 0, outputTokens: 0 },
      model: FAKE_MODEL,
      promptVersion: OCR_TEXT_PROMPT_VERSION,
    };
  }

  /**
   * Unlike vision, this one *can* be honestly simulated from text: a few
   * keyword heuristics genuinely correlate with the document type, so this
   * returns a real (if crude) guess with a correspondingly modest
   * confidence, rather than punting outright.
   */
  async classifyDocumentType(
    input: ClassifyDocumentTypePromptInput,
    _model: string,
  ): Promise<GeneratedWithMeta<ClassifyDocumentTypeOutput>> {
    const sample = (input.textSample ?? '').toLowerCase();
    const data: ClassifyDocumentTypeOutput = (() => {
      if (!sample.trim()) {
        // No text sample (e.g. a photo) — FakeProvider can't read pixels either.
        return { type: 'altro' as const, confidence: 0.1 };
      }
      if (/\besam[ei]\b|\bappell[oi]\b|\bcompito\b/.test(sample)) {
        return { type: 'esami' as const, confidence: 0.55 };
      }
      if (/\bslide\b|\bdiapositiv/.test(sample)) {
        return { type: 'slide' as const, confidence: 0.5 };
      }
      return { type: 'appunti' as const, confidence: 0.4 };
    })();

    return {
      data,
      usage: { inputTokens: estimateTokens(sample), outputTokens: 4 },
      model: FAKE_MODEL,
      promptVersion: CLASSIFY_DOCUMENT_TYPE_PROMPT_VERSION,
    };
  }

  /** Real pattern distillation needs real judgment — honestly returns nothing rather than guessing. */
  async distillHandwritingProfile(
    _input: DistillHandwritingProfilePromptInput,
    _model: string,
  ): Promise<GeneratedWithMeta<DistillHandwritingProfileOutput>> {
    return {
      data: { lines: [] },
      usage: { inputTokens: 0, outputTokens: 0 },
      model: FAKE_MODEL,
      promptVersion: DISTILL_HANDWRITING_PROFILE_PROMPT_VERSION,
    };
  }

  async extractExamProfile(
    input: ExamProfilePromptInput,
    _model: string,
  ): Promise<GeneratedWithMeta<ExamProfile>> {
    const data = fakeExtractExamProfile(input);
    return {
      data,
      usage: {
        inputTokens:
          input.chunks.reduce((sum, c) => sum + estimateTokens(c.text), 0) +
          (input.pageImages?.length ?? 0) * 1500, // rough per-page image cost
        outputTokens: estimateTokens(JSON.stringify(data)),
      },
      model: FAKE_MODEL,
      promptVersion: EXAM_PROFILE_PROMPT_VERSION,
    };
  }

  async generateSimulation(
    input: SimulationPromptInput,
    _model: string,
  ): Promise<GeneratedWithMeta<SimulationOutput>> {
    const data = fakeGenerateSimulation(input);
    return {
      data,
      usage: {
        inputTokens: input.chunks.reduce((sum, c) => sum + estimateTokens(c.text), 0),
        outputTokens: estimateTokens(JSON.stringify(data)),
      },
      model: FAKE_MODEL,
      promptVersion: SIMULATION_PROMPT_VERSION,
    };
  }

  async gradeAnswer(
    input: GradePromptInput,
    _model: string,
  ): Promise<GeneratedWithMeta<GradeOutput>> {
    const data = fakeGradeAnswer(input);
    return {
      data,
      usage: {
        inputTokens: estimateTokens(JSON.stringify(input.item) + input.answer),
        outputTokens: estimateTokens(JSON.stringify(data)),
      },
      model: FAKE_MODEL,
      promptVersion: GRADING_PROMPT_VERSION,
    };
  }

  async estimateTopics(
    input: EstimateTopicsPromptInput,
    _model: string,
  ): Promise<GeneratedWithMeta<EstimateTopicsOutput>> {
    const totalPages = input.units.reduce((s, u) => s + u.pages, 0) || 1;
    const topics: TopicEstimate[] = input.units.map((u) => ({
      key: u.key,
      // ~3.5 min/page (first read, not memorization), never below one session block.
      estimatedMinutes: Math.max(20, Math.round(u.pages * 3.5)),
      difficulty: estimateDifficulty(u.excerpt),
      // Relative to the other units in the same call, proportional to length —
      // a real model would weigh centrality, not just size (see docs/fasi/F6 "Stato").
      examWeight: Math.round((u.pages / totalPages) * 100) / 100,
      prerequisites: [], // no ordering signal available without real judgment
    }));

    const inputTokens = input.units.reduce((sum, u) => sum + estimateTokens(u.excerpt), 0);
    const outputTokens = estimateTokens(JSON.stringify(topics));

    return {
      data: { topics },
      usage: { inputTokens, outputTokens },
      model: FAKE_MODEL,
      promptVersion: ESTIMATE_TOPICS_PROMPT_VERSION,
    };
  }

  async extractTopics(
    input: ExtractTopicsPromptInput,
    _model: string,
  ): Promise<GeneratedWithMeta<ExtractTopicsOutput>> {
    // Groups documents by their most prominent shared keyword — same
    // "real signal, not real judgment" trade-off as estimateDifficulty
    // below: it proves the pipeline (dedup-by-name, document_topics
    // tagging) moves genuine per-document data, not a canned answer.
    const docIdsByKeyword = new Map<string, string[]>();
    const keywordsByDoc = new Map<string, string[]>();
    for (const doc of input.documents) {
      const docKeywords = keywords(doc.excerpt);
      keywordsByDoc.set(doc.docId, docKeywords);
      const topKeyword = docKeywords[0] ?? `documento-${doc.docId.slice(0, 8)}`;
      const docIds = docIdsByKeyword.get(topKeyword) ?? [];
      docIds.push(doc.docId);
      docIdsByKeyword.set(topKeyword, docIds);
    }

    // A topic's parent is its member documents' second-ranked keyword, but only when that
    // keyword actually names another known topic (existing in the subject, or proposed in this
    // same batch) — otherwise it stays top-level, same "real signal, never invented" discipline
    // as the docId citations above.
    const knownNames = new Set([
      ...(input.existingTopics ?? []).map((t) => t.name.toLowerCase()),
      ...docIdsByKeyword.keys(),
    ]);
    const topics: ExtractedTopic[] = [...docIdsByKeyword.entries()].map(([keyword, docIds]) => {
      const name = keyword.charAt(0).toUpperCase() + keyword.slice(1);
      const secondKeyword = keywordsByDoc.get(docIds[0]!)?.[1];
      const parentName =
        secondKeyword && secondKeyword !== keyword && knownNames.has(secondKeyword)
          ? secondKeyword.charAt(0).toUpperCase() + secondKeyword.slice(1)
          : null;
      return { name, docIds, confidence: 0.5, parentName };
    });

    const inputTokens = input.documents.reduce((sum, d) => sum + estimateTokens(d.excerpt), 0);
    const outputTokens = estimateTokens(JSON.stringify(topics));

    return {
      data: { topics },
      usage: { inputTokens, outputTokens },
      model: FAKE_MODEL,
      promptVersion: EXTRACT_TOPICS_PROMPT_VERSION,
    };
  }

  /**
   * Extractive stand-in for the session chat: quotes the best-matching sentences of the provided
   * sources, each cited with its `[n]` — or says the material doesn't cover the question. It can't
   * explain anything, but it exercises the whole pipeline (SSE, citation parsing, validation, costs).
   */
  async *chatStream(input: SessionChatPromptInput, _model: string): AsyncIterable<ChatDelta> {
    const query = `${input.focus?.text ?? ''} ${input.question}`;
    const scored = input.sources
      .flatMap((source) =>
        splitSentences(source.text).map((sentence) => ({
          ref: source.ref,
          sentence,
          score: keywordCoverage(query, sentence),
        })),
      )
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score || a.ref - b.ref)
      .slice(0, 2);

    const answer =
      scored.length === 0
        ? 'Questo non è nel materiale della sessione: prova a riformulare la domanda o ad aggiungere un argomento.'
        : `Dal materiale:\n\n${scored.map((c) => `- ${truncate(c.sentence, 400)} [${c.ref}]`).join('\n')}`;

    // Emit in small pieces so the streaming path is exercised for real, not one lump.
    for (let i = 0; i < answer.length; i += 24) {
      yield { type: 'text', text: answer.slice(i, i + 24) };
    }
    yield {
      type: 'done',
      usage: {
        inputTokens: estimateTokens(renderSessionChatUserPrompt(input)),
        outputTokens: estimateTokens(answer),
      },
      model: FAKE_MODEL,
      promptVersion: SESSION_CHAT_PROMPT_VERSION,
    };
  }
}

/**
 * Deterministic stand-in for conceptual difficulty: unique content-word
 * density per sentence. Real judgment ("this chapter is conceptually
 * harder") needs a real model — this only proves the pipeline moves a
 * genuine per-unit signal through, not a constant (docs/fasi/F6 "Stato").
 */
function estimateDifficulty(excerpt: string): 1 | 2 | 3 | 4 | 5 {
  const sentences = splitSentences(excerpt);
  const density = sentences.length === 0 ? 0 : keywords(excerpt).length / sentences.length;
  return Math.min(5, Math.max(1, Math.round(1 + density))) as 1 | 2 | 3 | 4 | 5;
}

function clozeify(sentence: string): string {
  const words = sentence.split(' ').filter((w) => w.length > 5);
  if (words.length === 0) return sentence.replace(/\w+/, '{{...}}');
  const target = words[Math.floor(words.length / 2)]!;
  return sentence.replace(target, '{{...}}');
}
