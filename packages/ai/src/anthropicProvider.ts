import { readFile } from 'node:fs/promises';
import Anthropic from '@anthropic-ai/sdk';
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

const MAX_VALIDATION_RETRIES = 2; // docs/03-ai-e-worker.md §3: "retry con feedback di validazione (max 2)"

/**
 * The real thing: Anthropic's Messages API, forced tool-use for structured
 * output, retried with the Zod validation error fed back to the model when
 * the shape doesn't match. Untested against the live API in this session —
 * no key was available — but its control flow (tool_use parsing, the retry
 * loop, usage accounting) is unit-tested against a mocked client; see
 * test/anthropicProvider.test.ts.
 */
export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  private readonly client: Pick<Anthropic, 'messages'>;

  constructor(options: { apiKey?: string; client?: Pick<Anthropic, 'messages'> } = {}) {
    this.client =
      options.client ?? new Anthropic({ apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY });
  }

  async generateFlashcards(
    input: FlashcardsPromptInput,
    model: string,
  ): Promise<GeneratedWithMeta<FlashcardsOutput>> {
    const { text: system, promptVersion } = loadPrompt('flashcards', 1);
    const { data, usage } = await this.callWithTool(
      'emit_flashcards',
      system,
      renderFlashcardsUserPrompt(input),
      FlashcardsOutputSchema,
      model,
      4096,
    );
    return { data, usage, model, promptVersion };
  }

  async generateSummary(
    input: SummaryPromptInput,
    model: string,
  ): Promise<GeneratedWithMeta<SummaryOutput>> {
    const { text: system, promptVersion } = loadPrompt('summary', 1);
    const { data, usage } = await this.callWithTool(
      'emit_summary',
      system,
      renderSummaryUserPrompt(input),
      SummaryOutputSchema,
      model,
      4096,
    );
    return { data, usage, model, promptVersion };
  }

  async generateSchema(
    input: SchemaPromptInput,
    model: string,
  ): Promise<GeneratedWithMeta<SchemaOutput>> {
    const { text: system, promptVersion } = loadPrompt('schema', 1);
    const { data, usage } = await this.callWithTool(
      'emit_schema',
      system,
      renderSchemaUserPrompt(input),
      SchemaOutputSchema,
      model,
      4096,
    );
    return { data, usage, model, promptVersion };
  }

  /** Same vision call as `ClaudeCliProvider.transcribeSchema`, here as a Messages API image content block instead of the CLI's Read tool. */
  async transcribeSchema(
    input: SchemaTranscriptionPromptInput,
    model: string,
  ): Promise<GeneratedWithMeta<SchemaGraphOutput>> {
    const { text: system, promptVersion } = loadPrompt('schema_transcription', 2);
    const imageBase64 = (await readFile(input.imagePath)).toString('base64');
    const { data, usage } = await this.callWithTool(
      'emit_schema_transcription',
      system,
      renderSchemaTranscriptionUserPrompt(input),
      SchemaGraphOutputSchema,
      model,
      4096,
      {
        mediaType: input.mime as Anthropic.ImageBlockParam.Source['media_type'],
        data: imageBase64,
      },
    );
    return { data, usage, model, promptVersion };
  }

  /** Same OCR call as `ClaudeCliProvider.ocrText` — a printed page, not a hand-drawn schema. */
  async ocrText(
    input: OcrTextPromptInput,
    model: string,
  ): Promise<GeneratedWithMeta<OcrTextOutput>> {
    const { text: system, promptVersion } = loadPrompt('ocr_text', 1);
    const imageBase64 = (await readFile(input.imagePath)).toString('base64');
    const { data, usage } = await this.callWithTool(
      'emit_ocr_text',
      system,
      "Trascrivi il testo dell'immagine allegata.",
      OcrTextOutputSchema,
      model,
      4096,
      {
        mediaType: input.mime as Anthropic.ImageBlockParam.Source['media_type'],
        data: imageBase64,
      },
    );
    return { data, usage, model, promptVersion };
  }

  async classifyDocumentType(
    input: ClassifyDocumentTypePromptInput,
    model: string,
  ): Promise<GeneratedWithMeta<ClassifyDocumentTypeOutput>> {
    const { text: system, promptVersion } = loadPrompt('classify_document_type', 1);
    const image =
      input.imagePath && input.mime
        ? {
            mediaType: input.mime as Anthropic.ImageBlockParam.Source['media_type'],
            data: (await readFile(input.imagePath)).toString('base64'),
          }
        : undefined;
    const { data, usage } = await this.callWithTool(
      'emit_document_type',
      system,
      input.textSample
        ? `Campione del documento:\n\n${input.textSample}`
        : "Suggerisci il tipo di documento dall'immagine allegata.",
      ClassifyDocumentTypeOutputSchema,
      model,
      256,
      image,
    );
    return { data, usage, model, promptVersion };
  }

  async distillHandwritingProfile(
    input: DistillHandwritingProfilePromptInput,
    model: string,
  ): Promise<GeneratedWithMeta<DistillHandwritingProfileOutput>> {
    const { text: system, promptVersion } = loadPrompt('distill_handwriting_profile', 1);
    const { data, usage } = await this.callWithTool(
      'emit_handwriting_profile',
      system,
      `Correzioni recenti (prima -> dopo):\n\n${input.corrections
        .map((c) => `- "${c.before ?? ''}" -> "${c.after ?? ''}" (${c.kind ?? 'n/d'})`)
        .join('\n')}`,
      DistillHandwritingProfileOutputSchema,
      model,
      512,
    );
    return { data, usage, model, promptVersion };
  }

  async extractExamProfile(
    input: ExamProfilePromptInput,
    model: string,
  ): Promise<GeneratedWithMeta<ExamProfile>> {
    const { text: system, promptVersion } = loadPrompt('exam_profile', 1);
    const images = await Promise.all(
      (input.pageImages ?? []).map(async (img) => ({
        mediaType: img.mime as Anthropic.ImageBlockParam.Source['media_type'],
        data: (await readFile(img.path)).toString('base64'),
      })),
    );
    const { data, usage } = await this.callWithTool(
      'emit_exam_profile',
      system,
      renderExamProfileUserPrompt(input),
      ExamProfileSchema,
      model,
      2048,
      images,
    );
    return { data, usage, model, promptVersion };
  }

  async generateSimulation(
    input: SimulationPromptInput,
    model: string,
  ): Promise<GeneratedWithMeta<SimulationOutput>> {
    const { text: system, promptVersion } = loadPrompt('simulation', 2);
    const { data, usage } = await this.callWithTool(
      'emit_simulation',
      system,
      renderSimulationUserPrompt(input),
      SimulationOutputSchema,
      model,
      8192,
    );
    return { data, usage, model, promptVersion };
  }

  async gradeAnswer(
    input: GradePromptInput,
    model: string,
  ): Promise<GeneratedWithMeta<GradeOutput>> {
    const { text: system, promptVersion } = loadPrompt('grading', 1);
    const { data, usage } = await this.callWithTool(
      'emit_grade',
      system,
      renderGradeUserPrompt(input),
      GradeOutputSchema,
      model,
      2048,
    );
    return { data, usage, model, promptVersion };
  }

  async estimateTopics(
    input: EstimateTopicsPromptInput,
    model: string,
  ): Promise<GeneratedWithMeta<EstimateTopicsOutput>> {
    const { text: system, promptVersion } = loadPrompt('estimate_topics', 1);
    const { data, usage } = await this.callWithTool(
      'emit_topic_estimates',
      system,
      renderEstimateTopicsUserPrompt(input),
      EstimateTopicsOutputSchema,
      model,
      4096,
    );
    return { data, usage, model, promptVersion };
  }

  async extractTopics(
    input: ExtractTopicsPromptInput,
    model: string,
  ): Promise<GeneratedWithMeta<ExtractTopicsOutput>> {
    const { text: system, promptVersion } = loadPrompt('extract_topics', 2);
    const { data, usage } = await this.callWithTool(
      'emit_topics',
      system,
      renderExtractTopicsUserPrompt(input),
      ExtractTopicsOutputSchema,
      model,
      4096,
    );
    return { data, usage, model, promptVersion };
  }

  private async callWithTool<T>(
    toolName: string,
    system: string,
    userPrompt: string,
    schema: z.ZodType<T>,
    model: string,
    maxTokens: number,
    image?:
      | { mediaType: Anthropic.ImageBlockParam.Source['media_type']; data: string }
      | { mediaType: Anthropic.ImageBlockParam.Source['media_type']; data: string }[],
  ): Promise<{ data: T; usage: AiUsage }> {
    const inputSchema =
      zodToJsonSchema(schema, toolName).definitions?.[toolName] ?? zodToJsonSchema(schema);

    const images = image === undefined ? [] : Array.isArray(image) ? image : [image];
    let feedback: string | null = null;
    const usage: AiUsage = { inputTokens: 0, outputTokens: 0 };

    for (let attempt = 0; attempt <= MAX_VALIDATION_RETRIES; attempt += 1) {
      const prompt = feedback
        ? `${userPrompt}\n\nIl tuo output precedente non era valido:\n${feedback}\nCorreggi e richiama lo strumento con un output valido.`
        : userPrompt;

      const response = await this.client.messages.create({
        model,
        max_tokens: maxTokens,
        system,
        tools: [
          {
            name: toolName,
            description: `Restituisce l'output strutturato richiesto tramite lo strumento ${toolName}.`,
            input_schema: inputSchema as Anthropic.Tool['input_schema'],
          },
        ],
        tool_choice: { type: 'tool', name: toolName },
        messages: [
          {
            role: 'user',
            content:
              images.length > 0
                ? [
                    ...images.map((img) => ({
                      type: 'image',
                      source: { type: 'base64', media_type: img.mediaType, data: img.data },
                    })),
                    { type: 'text', text: prompt },
                  ]
                : prompt,
          },
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      usage.inputTokens += response.usage?.input_tokens ?? 0;
      usage.outputTokens += response.usage?.output_tokens ?? 0;

      const toolUse = response.content.find(
        (block: { type: string }): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
      );
      if (!toolUse) {
        feedback = 'nessun blocco tool_use nella risposta del modello';
        continue;
      }

      const parsed = schema.safeParse(toolUse.input);
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
