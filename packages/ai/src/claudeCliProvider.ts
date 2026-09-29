import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { z } from 'zod';
import type {
  AiProvider,
  AiUsage,
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
  SimulationPromptInput,
  SummaryPromptInput,
} from './provider.js';
import {
  ClassifyDocumentTypeOutputSchema,
  DistillHandwritingProfileOutputSchema,
  EstimateTopicsOutputSchema,
  ExamProfileSchema,
  ExtractTopicsOutputSchema,
  FlashcardsOutputSchema,
  GradeOutputSchema,
  OcrTextOutputSchema,
  SchemaGraphOutputSchema,
  SchemaOutputSchema,
  SimulationOutputSchema,
  SummaryOutputSchema,
  type ClassifyDocumentTypeOutput,
  type DistillHandwritingProfileOutput,
  type EstimateTopicsOutput,
  type ExamProfile,
  type ExtractTopicsOutput,
  type FlashcardsOutput,
  type GradeOutput,
  type OcrTextOutput,
  type SchemaGraphOutput,
  type SchemaOutput,
  type SimulationOutput,
  type SummaryOutput,
} from './schemas.js';
import { loadPrompt } from './promptLoader.js';
import {
  renderEstimateTopicsUserPrompt,
  renderExamProfileUserPrompt,
  renderExtractTopicsUserPrompt,
  renderFlashcardsUserPrompt,
  renderGradeUserPrompt,
  renderSchemaTranscriptionUserPrompt,
  renderSchemaUserPrompt,
  renderSimulationUserPrompt,
  renderSummaryUserPrompt,
} from './promptRender.js';

const MAX_VALIDATION_RETRIES = 2; // same discipline as AnthropicProvider (docs/03-ai-e-worker.md §3)

// Tool access disabled: this provider wants one structured JSON answer per
// call, not an agentic session that reads/writes files or hits the network.
// `--tools ""` (not a --disallowedTools blocklist) so this stays true even as
// Claude Code adds new built-in tools — a blocklist here would silently miss
// them (e.g. Grep/Glob can still read arbitrary files, including the very
// ~/.claude.json mounted into this container, which matters since the input
// is untrusted document text).

export interface ClaudeCliResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export type ClaudeCliRunner = (args: string[], stdin: string) => Promise<ClaudeCliResult>;

/** `claude --print --output-format json`, spawned with argv (no shell) so nothing in the prompt can be interpreted as shell syntax. */
function spawnClaudeCli(args: string[], stdin: string): Promise<ClaudeCliResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('claude', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolvePromise({ stdout, stderr, code }));
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

interface ClaudeCliEnvelope {
  is_error?: boolean;
  result?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Uses the `claude` CLI (`--print --json-schema`, prompt piped on stdin)
 * instead of the billed Messages API — inference runs against whatever
 * subscription `claude` is already logged into on this machine (or, in
 * Docker, whatever `~/.claude` / `~/.claude.json` was mounted into the
 * container — see docker/docker-compose.claude-cli.yml). Same validation-retry
 * discipline as `AnthropicProvider`; the difference is entirely in how the
 * model is invoked, not in what's asked of it.
 */
export class ClaudeCliProvider implements AiProvider {
  readonly name = 'claude-cli';
  private readonly run: ClaudeCliRunner;

  constructor(options: { run?: ClaudeCliRunner } = {}) {
    this.run = options.run ?? spawnClaudeCli;
  }

  async generateFlashcards(
    input: FlashcardsPromptInput,
    model: string,
  ): Promise<GeneratedWithMeta<FlashcardsOutput>> {
    const { text: system, promptVersion } = loadPrompt('flashcards', 1);
    const { data, usage } = await this.callWithSchema(
      system,
      renderFlashcardsUserPrompt(input),
      FlashcardsOutputSchema,
      model,
    );
    return { data, usage, model, promptVersion };
  }

  async generateSummary(
    input: SummaryPromptInput,
    model: string,
  ): Promise<GeneratedWithMeta<SummaryOutput>> {
    const { text: system, promptVersion } = loadPrompt('summary', 1);
    const { data, usage } = await this.callWithSchema(
      system,
      renderSummaryUserPrompt(input),
      SummaryOutputSchema,
      model,
    );
    return { data, usage, model, promptVersion };
  }

  async generateSchema(
    input: SchemaPromptInput,
    model: string,
  ): Promise<GeneratedWithMeta<SchemaOutput>> {
    const { text: system, promptVersion } = loadPrompt('schema', 1);
    const { data, usage } = await this.callWithSchema(
      system,
      renderSchemaUserPrompt(input),
      SchemaOutputSchema,
      model,
    );
    return { data, usage, model, promptVersion };
  }

  /**
   * The only vision call this provider makes: unlike the other methods
   * (`--tools ''`, pure text completion), this one grants the `Read` tool —
   * scoped via `--add-dir` to just the image's own directory, never the
   * whole data root — so the `claude` CLI can actually look at the photo
   * (Read supports images natively) before answering. Still no network
   * access beyond what `claude` itself needs, no other tool, same
   * `--json-schema` structured output as every other call here.
   */
  async transcribeSchema(
    input: SchemaTranscriptionPromptInput,
    model: string,
  ): Promise<GeneratedWithMeta<SchemaGraphOutput>> {
    const { text: system, promptVersion } = loadPrompt('schema_transcription', 2);
    const userPrompt = [
      `Leggi l'immagine al percorso esatto: ${input.imagePath}`,
      'Poi trascrivi il suo grafo di nodi e archi secondo le istruzioni.',
      '',
      renderSchemaTranscriptionUserPrompt(input),
    ].join('\n');
    const { data, usage } = await this.callWithSchema(
      system,
      userPrompt,
      SchemaGraphOutputSchema,
      model,
      { allowedTools: 'Read', addDir: dirname(input.imagePath) },
    );
    return { data, usage, model, promptVersion };
  }

  /** Same `Read`-tool grant as `transcribeSchema`, scoped to the image's directory — a printed page, not a hand-drawn schema. */
  async ocrText(
    input: OcrTextPromptInput,
    model: string,
  ): Promise<GeneratedWithMeta<OcrTextOutput>> {
    const { text: system, promptVersion } = loadPrompt('ocr_text', 1);
    const userPrompt = [
      `Leggi l'immagine al percorso esatto: ${input.imagePath}`,
      'Poi trascrivi il testo secondo le istruzioni.',
    ].join('\n');
    const { data, usage } = await this.callWithSchema(
      system,
      userPrompt,
      OcrTextOutputSchema,
      model,
      {
        allowedTools: 'Read',
        addDir: dirname(input.imagePath),
      },
    );
    return { data, usage, model, promptVersion };
  }

  async classifyDocumentType(
    input: ClassifyDocumentTypePromptInput,
    model: string,
  ): Promise<GeneratedWithMeta<ClassifyDocumentTypeOutput>> {
    const { text: system, promptVersion } = loadPrompt('classify_document_type', 1);
    const userPrompt = input.imagePath
      ? [
          `Leggi l'immagine al percorso esatto: ${input.imagePath}`,
          'Poi suggerisci il tipo di documento secondo le istruzioni.',
        ].join('\n')
      : `Campione del documento:\n\n${input.textSample ?? ''}`;
    const { data, usage } = await this.callWithSchema(
      system,
      userPrompt,
      ClassifyDocumentTypeOutputSchema,
      model,
      input.imagePath ? { allowedTools: 'Read', addDir: dirname(input.imagePath) } : undefined,
    );
    return { data, usage, model, promptVersion };
  }

  async distillHandwritingProfile(
    input: DistillHandwritingProfilePromptInput,
    model: string,
  ): Promise<GeneratedWithMeta<DistillHandwritingProfileOutput>> {
    const { text: system, promptVersion } = loadPrompt('distill_handwriting_profile', 1);
    const userPrompt = `Correzioni recenti (prima -> dopo):\n\n${input.corrections
      .map((c) => `- "${c.before ?? ''}" -> "${c.after ?? ''}" (${c.kind ?? 'n/d'})`)
      .join('\n')}`;
    const { data, usage } = await this.callWithSchema(
      system,
      userPrompt,
      DistillHandwritingProfileOutputSchema,
      model,
    );
    return { data, usage, model, promptVersion };
  }

  async extractExamProfile(
    input: ExamProfilePromptInput,
    model: string,
  ): Promise<GeneratedWithMeta<ExamProfile>> {
    const { text: system, promptVersion } = loadPrompt('exam_profile', 1);
    const { data, usage } = await this.callWithSchema(
      system,
      renderExamProfileUserPrompt(input),
      ExamProfileSchema,
      model,
    );
    return { data, usage, model, promptVersion };
  }

  async generateSimulation(
    input: SimulationPromptInput,
    model: string,
  ): Promise<GeneratedWithMeta<SimulationOutput>> {
    const { text: system, promptVersion } = loadPrompt('simulation', 2);
    const { data, usage } = await this.callWithSchema(
      system,
      renderSimulationUserPrompt(input),
      SimulationOutputSchema,
      model,
    );
    return { data, usage, model, promptVersion };
  }

  async gradeAnswer(
    input: GradePromptInput,
    model: string,
  ): Promise<GeneratedWithMeta<GradeOutput>> {
    const { text: system, promptVersion } = loadPrompt('grading', 1);
    const { data, usage } = await this.callWithSchema(
      system,
      renderGradeUserPrompt(input),
      GradeOutputSchema,
      model,
    );
    return { data, usage, model, promptVersion };
  }

  async estimateTopics(
    input: EstimateTopicsPromptInput,
    model: string,
  ): Promise<GeneratedWithMeta<EstimateTopicsOutput>> {
    const { text: system, promptVersion } = loadPrompt('estimate_topics', 1);
    const { data, usage } = await this.callWithSchema(
      system,
      renderEstimateTopicsUserPrompt(input),
      EstimateTopicsOutputSchema,
      model,
    );
    return { data, usage, model, promptVersion };
  }

  async extractTopics(
    input: ExtractTopicsPromptInput,
    model: string,
  ): Promise<GeneratedWithMeta<ExtractTopicsOutput>> {
    const { text: system, promptVersion } = loadPrompt('extract_topics', 2);
    const { data, usage } = await this.callWithSchema(
      system,
      renderExtractTopicsUserPrompt(input),
      ExtractTopicsOutputSchema,
      model,
    );
    return { data, usage, model, promptVersion };
  }

  private async callWithSchema<T>(
    system: string,
    userPrompt: string,
    schema: z.ZodType<T>,
    model: string,
    /** Widens the default no-tools sandbox — only `transcribeSchema` needs this, to read the image. */
    toolAccess?: { allowedTools: string; addDir: string },
  ): Promise<{ data: T; usage: AiUsage }> {
    const jsonSchema = zodToJsonSchema(schema);
    delete (jsonSchema as Record<string, unknown>).$schema;

    let feedback: string | null = null;
    const usage: AiUsage = { inputTokens: 0, outputTokens: 0 };

    for (let attempt = 0; attempt <= MAX_VALIDATION_RETRIES; attempt += 1) {
      const prompt = feedback
        ? `${userPrompt}\n\nIl tuo output precedente non era valido:\n${feedback}\nCorreggi e restituisci un output valido.`
        : userPrompt;

      const args = [
        '--print',
        '--output-format',
        'json',
        '--model',
        model,
        '--system-prompt',
        system,
        '--json-schema',
        JSON.stringify(jsonSchema),
        '--strict-mcp-config',
        '--tools',
        toolAccess?.allowedTools ?? '',
        ...(toolAccess ? ['--add-dir', toolAccess.addDir] : []),
      ];
      const { stdout, stderr, code } = await this.run(args, prompt);

      let envelope: ClaudeCliEnvelope;
      try {
        envelope = JSON.parse(stdout) as ClaudeCliEnvelope;
      } catch {
        feedback = `chiamata a \`claude\` fallita (exit ${code}): ${stderr || stdout || 'nessun output'}`;
        continue;
      }

      if (envelope.is_error || typeof envelope.result !== 'string') {
        feedback = envelope.result ?? `chiamata a \`claude\` fallita (exit ${code})`;
        continue;
      }

      usage.inputTokens += envelope.usage?.input_tokens ?? 0;
      usage.outputTokens += envelope.usage?.output_tokens ?? 0;

      let candidate: unknown;
      try {
        candidate = JSON.parse(envelope.result);
      } catch {
        feedback = "l'output non è JSON valido";
        continue;
      }

      const parsed = schema.safeParse(candidate);
      if (parsed.success) {
        return { data: parsed.data, usage };
      }
      feedback = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    }

    throw new Error(
      `generazione fallita dopo ${MAX_VALIDATION_RETRIES + 1} tentativi: ${feedback ?? 'motivo sconosciuto'}`,
    );
  }
}
