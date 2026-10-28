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
  PlanChangePromptInput,
  SubjectAskPromptInput,
  SimulationPromptInput,
  SortFlashcardsPromptInput,
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
  PlanChangeOutput,
  SchemaGraphOutput,
  SchemaNode,
  SchemaOutput,
  SessionBriefingOutput,
  SimulationOutput,
  SortFlashcardsAiOutput,
  SummaryOutput,
  TopicEstimate,
} from './schemas.js';
import { basename } from 'node:path';
import { estimateTokens } from './pricing.js';
import { keywordCoverage, keywords, splitSentences, truncate } from './text.js';
import { normalizeTopicName } from './topicMatch.js';
import {
  renderPlanChangeUserPrompt,
  renderSessionChatUserPrompt,
  renderSubjectAskUserPrompt,
} from './promptRender.js';
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
  SESSION_CHAT_DEEP_PROMPT_VERSION,
  PLAN_CHANGE_PROMPT_VERSION,
  SUBJECT_ASK_PROMPT_VERSION,
  SIMULATION_PROMPT_VERSION,
  SORT_FLASHCARDS_PROMPT_VERSION,
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
          // Only when the prompt carried topics: a real signal (the sentence names the topic),
          // otherwise null — the worker's fallbacks (single scope topic, document topic) take over.
          ...(input.topics && input.topics.length > 0
            ? { topicName: pickTopicByKeywords(sentence, input.topics) }
            : {}),
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

  /**
   * Keyword stand-in for the classifier: a card goes to the topic whose name (or most of whose
   * content words) appears in its text, `null` when none does. Not judgment — it proves the
   * pipeline (batching, name matching, document fallback, "don't touch cards with a topic")
   * moves a genuine per-card signal, never a constant.
   */
  async sortFlashcards(
    input: SortFlashcardsPromptInput,
    _model: string,
  ): Promise<GeneratedWithMeta<SortFlashcardsAiOutput>> {
    const data: SortFlashcardsAiOutput = {
      assignments: input.cards.map((card) => ({
        cardId: card.id,
        topicName: pickTopicByKeywords(`${card.front} ${card.back}`, input.topics),
      })),
    };
    return {
      data,
      usage: {
        inputTokens: input.cards.reduce((sum, c) => sum + estimateTokens(c.front + c.back), 0),
        outputTokens: estimateTokens(JSON.stringify(data)),
      },
      model: FAKE_MODEL,
      promptVersion: SORT_FLASHCARDS_PROMPT_VERSION,
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

  /**
   * No honest pixel-reading offline (same reasoning as transcribeSchema): documents and scanned
   * pages get an empty, illegible reading rather than a fabricated one. The exception is a photo
   * of a handwritten answer (`purpose: 'answer_photo'`): there a clearly marked placeholder, a pure
   * function of the file name and mime, lets the grading flow be exercised without an API key.
   */
  async ocrText(
    input: OcrTextPromptInput,
    _model: string,
  ): Promise<GeneratedWithMeta<OcrTextOutput>> {
    const data: OcrTextOutput =
      input.purpose === 'answer_photo'
        ? {
            text: `[Trascrizione simulata] ${basename(input.imagePath)} (${input.mime})`,
            confidence: 'uncertain',
          }
        : { text: '', confidence: 'illegible' };
    return {
      data,
      usage: {
        inputTokens: 0,
        outputTokens: input.purpose === 'answer_photo' ? estimateTokens(data.text) : 0,
      },
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
   * Rule-based stand-in for `plan_change`: understands hours or minutes per day, a weekday off, the pace
   * and an exam date written as YYYY-MM-DD. Anything else is reported back as not understood.
   */
  async interpretPlanChange(
    input: PlanChangePromptInput,
    _model: string,
  ): Promise<GeneratedWithMeta<PlanChangeOutput>> {
    const text = input.instruction.toLowerCase();
    const out: PlanChangeOutput = {
      targetDate: null,
      perWeekday: null,
      addBlackoutDates: [],
      removeBlackoutDates: [],
      intensity: null,
      sessionLength: null,
      simulationCount: null,
      excludeTopicIds: [],
      includeTopicIds: [],
      changes: [],
      notUnderstood: [],
    };
    const days: (number | null)[] = [null, null, null, null, null, null, null];
    const perDay = /(\d+(?:[.,]\d+)?)\s*(ore|ora|h|minuti|min)\b/.exec(text);
    if (perDay) {
      const n = Number(perDay[1]!.replace(',', '.'));
      const minutes = Math.round(perDay[2]!.startsWith('m') ? n : n * 60);
      input.perWeekday.forEach((m, i) => {
        if (m > 0) days[i] = minutes;
      });
      out.changes.push(`${minutes} minuti nei giorni di studio`);
    }
    const weekdays = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
    weekdays.forEach((name, i) => {
      if (new RegExp(`${name.slice(0, 5)}[^ ]* +(libero|liberi|no|niente)`).test(text)) {
        days[i] = 0;
        out.changes.push(`${name[0]!.toUpperCase()}${name.slice(1)}: nessuno studio`);
      }
    });
    if (days.some((d) => d !== null)) out.perWeekday = days;
    if (/sprint|condens|spinger|intens/.test(text)) {
      out.intensity = 'sprint';
      out.changes.push('Ritmo: sprint');
    } else if (/leggero|sostenibil|rilassat/.test(text)) {
      out.intensity = 'sostenibile';
      out.changes.push('Ritmo: sostenibile');
    }
    const date = /\b(\d{4}-\d{2}-\d{2})\b/.exec(text);
    if (date && /esame|data/.test(text)) {
      out.targetDate = date[1]!;
      out.changes.push(`Esame il ${date[1]}`);
    }
    if (out.changes.length === 0) out.notUnderstood.push(input.instruction);
    return {
      data: out,
      usage: {
        inputTokens: estimateTokens(renderPlanChangeUserPrompt(input)),
        outputTokens: estimateTokens(JSON.stringify(out)),
      },
      model: FAKE_MODEL,
      promptVersion: PLAN_CHANGE_PROMPT_VERSION,
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

    const fromMaterial =
      scored.length === 0
        ? 'Questo non è nel materiale della sessione: prova a riformulare la domanda o ad aggiungere un argomento.'
        : `Dal materiale:\n\n${scored.map((c) => `- ${truncate(c.sentence, 400)} [${c.ref}]`).join('\n')}`;
    // Offline: no web to search, but the "ricerca approfondita" shape (a separate outside part) is kept.
    const answer = input.deepSearch
      ? `${fromMaterial}\n\n**Fuori dagli appunti**\n\nIl provider offline non può cercare sul web: configura un provider reale per la ricerca approfondita.`
      : fromMaterial;

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
      promptVersion: input.deepSearch
        ? SESSION_CHAT_DEEP_PROMPT_VERSION
        : SESSION_CHAT_PROMPT_VERSION,
    };
  }

  /**
   * Extractive stand-in for "Chiedi" on a subject. Always cites the first source (its best-matching
   * sentence, or its first one) and adds the best match from the other sources when it overlaps the
   * question; with no sources at all it says the material is not enough. Streamed in small pieces.
   */
  async *askStream(input: SubjectAskPromptInput, _model: string): AsyncIterable<ChatDelta> {
    const [first, ...others] = input.sources;
    let answer: string;
    if (!first) {
      answer =
        'Le fonti selezionate non bastano per rispondere: prova a riformulare la domanda o a includere più documenti.';
    } else {
      const best = (sources: typeof input.sources) =>
        sources
          .flatMap((source) =>
            splitSentences(source.text).map((sentence) => ({
              ref: source.ref,
              sentence,
              score: keywordCoverage(input.question, sentence),
            })),
          )
          .sort((a, b) => b.score - a.score || a.ref - b.ref)[0];
      const lines = [best([first]) ?? { ref: first.ref, sentence: first.text, score: 0 }];
      const other = best(others);
      if (other && other.score > 0) lines.push(other);
      answer = `Dal materiale:\n\n${lines.map((c) => `- ${truncate(c.sentence, 400)} [${c.ref}]`).join('\n')}`;
    }

    for (let i = 0; i < answer.length; i += 24) {
      yield { type: 'text', text: answer.slice(i, i + 24) };
    }
    yield {
      type: 'done',
      usage: {
        inputTokens: estimateTokens(renderSubjectAskUserPrompt(input)),
        outputTokens: estimateTokens(answer),
      },
      model: FAKE_MODEL,
      promptVersion: SUBJECT_ASK_PROMPT_VERSION,
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

/**
 * The topic (verbatim name) best matching `text`, or `null`: a topic whose whole normalized name
 * occurs in the text scores 1, otherwise the fraction of its content words found; ties go to the
 * earlier topic, zero overlap is no match.
 */
function pickTopicByKeywords(text: string, topics: readonly { name: string }[]): string | null {
  const haystack = normalizeTopicName(text);
  const words = new Set(keywords(text));
  let best: { name: string; score: number } | null = null;
  for (const topic of topics) {
    const needle = normalizeTopicName(topic.name);
    if (!needle) continue;
    const topicWords = keywords(topic.name);
    const score = haystack.includes(needle)
      ? 1
      : topicWords.length === 0
        ? 0
        : topicWords.filter((w) => words.has(w)).length / topicWords.length;
    if (score > 0 && (!best || score > best.score)) best = { name: topic.name, score };
  }
  return best?.name ?? null;
}

function clozeify(sentence: string): string {
  const words = sentence.split(' ').filter((w) => w.length > 5);
  if (words.length === 0) return sentence.replace(/\w+/, '{{...}}');
  const target = words[Math.floor(words.length / 2)]!;
  return sentence.replace(target, '{{...}}');
}
