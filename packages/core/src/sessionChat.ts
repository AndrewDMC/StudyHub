/**
 * Pure helpers for the study-session chat (docs/08-sessione-di-studio.md §5.3 and decision 2):
 * the sliding history window, citation parsing/validation, and the Markdown transcript written on
 * "Termina". No I/O — the caller loads rows and writes the file.
 */

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * The most recent turns that fit both limits, oldest first. Cost control: a long conversation must not
 * resend everything on every question (docs/08 §9.2). The newest turn is always kept, even if it alone is
 * over the character budget.
 */
export function windowMessages<T extends ChatTurn>(
  messages: readonly T[],
  limits: { maxMessages?: number; maxChars?: number } = {},
): T[] {
  const maxMessages = limits.maxMessages ?? 10;
  const maxChars = limits.maxChars ?? 6000;
  const picked: T[] = [];
  let chars = 0;
  for (let i = messages.length - 1; i >= 0 && picked.length < maxMessages; i -= 1) {
    const message = messages[i]!;
    if (picked.length > 0 && chars + message.content.length > maxChars) break;
    chars += message.content.length;
    picked.push(message);
  }
  return picked.reverse();
}

export interface CitableSource {
  ref: number;
}

export interface ParsedAnswer<S extends CitableSource> {
  /** The answer with markers to unknown sources removed and groups like `[1, 2]` normalised to `[1][2]`. */
  text: string;
  /** The sources the answer actually cites, in order of first appearance. */
  cited: S[];
}

/**
 * Validates the `[n]` markers of a model answer against the sources it was given (docs/08 §9.3): a marker
 * to a source that was never provided is dropped from the text instead of becoming a fake citation.
 * `cited.length === 0` means the answer is not grounded in the material.
 */
export function parseAnswerCitations<S extends CitableSource>(
  answer: string,
  sources: readonly S[],
): ParsedAnswer<S> {
  const byRef = new Map(sources.map((s) => [s.ref, s]));
  const cited: S[] = [];
  const text = answer
    .replace(/\[(\d+(?:\s*[,;]\s*\d+)*)\]/g, (_match, group: string) => {
      const refs = group.split(/[,;]/).map((n) => Number.parseInt(n.trim(), 10));
      const valid = refs.filter((ref) => byRef.has(ref));
      for (const ref of valid) {
        const source = byRef.get(ref)!;
        if (!cited.includes(source)) cited.push(source);
      }
      return valid.map((ref) => `[${ref}]`).join('');
    })
    // A marker removed from the end of a sentence leaves " ." behind.
    .replace(/[ \t]+([.,;:!?])/g, '$1');
  return { text, cited };
}

export interface TranscriptCitation {
  ref: number;
  documentName: string;
  page: number;
}

export interface TranscriptMessage {
  role: 'user' | 'assistant';
  content: string;
  focus?: { documentName: string; page: number | null; text: string } | null;
  citations: TranscriptCitation[];
  createdAt: Date;
}

export interface TranscriptInput {
  title: string;
  subjectName: string;
  topicNames: string[];
  startedAt: Date;
  endedAt: Date;
  activeMs: number;
  pomodoros: number;
  messages: readonly TranscriptMessage[];
}

const pad = (n: number) => String(n).padStart(2, '0');

function formatTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Local-date `YYYY-MM-DD`, used in the transcript file name. */
export function transcriptDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * File name of the transcript inside `<materia>/sessions/` (e.g. `2026-09-29-integrali-doppi.md`).
 * The id suffix keeps two sessions of the same day and title from overwriting each other.
 */
export function transcriptFileName(title: string, startedAt: Date, sessionId: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '');
  return `${transcriptDate(startedAt)}-${slug || 'sessione'}-${sessionId.slice(0, 8)}.md`;
}

function wikilink(c: TranscriptCitation): string {
  // `|` and `]` would break the link; document names rarely have them, but a name is user data.
  const name = c.documentName.replace(/[|[\]#^]/g, ' ').trim();
  return `[[${name}#p. ${c.page}|${name} · p. ${c.page}]]`;
}

function quote(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

/**
 * The chat as a readable note: front matter, then the turns. Citations become `[[wikilinks]]` to the
 * source documents, so the viewer resolves them and the file reads like any other note of the subject.
 */
export function renderSessionTranscript(input: TranscriptInput): string {
  const minutes = Math.round(input.activeMs / 60_000);
  const front = [
    '---',
    'tipo: sessione-di-studio',
    `materia: ${JSON.stringify(input.subjectName)}`,
    `data: ${transcriptDate(input.startedAt)}`,
    `inizio: ${formatTime(input.startedAt)}`,
    `fine: ${formatTime(input.endedAt)}`,
    `studio_minuti: ${minutes}`,
    `pomodori: ${input.pomodoros}`,
    ...(input.topicNames.length > 0
      ? ['argomenti:', ...input.topicNames.map((n) => `  - ${JSON.stringify(n)}`)]
      : []),
    '---',
  ];

  const body: string[] = [`# ${input.title}`, ''];
  if (input.messages.length === 0) {
    body.push('_Nessuna domanda fatta all’AI in questa sessione._', '');
  }
  for (const message of input.messages) {
    if (message.role === 'user') {
      body.push(`## Tu · ${formatTime(message.createdAt)}`, '');
      if (message.focus) {
        const where = message.focus.page
          ? `${message.focus.documentName}, p. ${message.focus.page}`
          : message.focus.documentName;
        body.push(quote(`${message.focus.text.trim()}\n— ${where}`), '');
      }
      body.push(message.content.trim(), '');
    } else {
      body.push(`## Tutor · ${formatTime(message.createdAt)}`, '', message.content.trim(), '');
      if (message.citations.length > 0) {
        body.push(
          `Fonti: ${message.citations.map((c) => `[${c.ref}] ${wikilink(c)}`).join(' · ')}`,
          '',
        );
      } else {
        body.push('_Risposta non ancorata al materiale._', '');
      }
    }
  }
  return `${front.join('\n')}\n\n${body.join('\n').trimEnd()}\n`;
}
