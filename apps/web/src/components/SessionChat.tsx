'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import type {
  SendSessionMessageRequest,
  SessionChatDto,
  SessionChatEvent,
  SessionCitationDto,
  SessionFocus,
  SessionMessageDto,
} from '@studyhub/contracts';
import { Button } from '@/components/ui/button';
import { ModelPicker, MODEL_OPTIONS } from '@/components/ModelPicker';
import { ObsidianMarkdown } from '@/components/ObsidianMarkdown';
import { readSse } from '@/lib/sseClient';

async function fetchChat(slug: string, sessionId: string): Promise<SessionChatDto> {
  const res = await fetch(`/api/subjects/${slug}/sessions/${sessionId}/messages`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? 'Impossibile caricare la chat');
  return body as SessionChatDto;
}

export async function fetchTranscript(slug: string, sessionId: string): Promise<string | null> {
  const res = await fetch(`/api/subjects/${slug}/sessions/${sessionId}/transcript`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? 'Impossibile caricare la trascrizione');
  return (body as { markdown: string | null }).markdown;
}

/**
 * POSTs a question and reads the SSE answer (`data: {json}` lines separated by a blank line). Errors
 * before the stream starts (ended session, bad request) come back as a normal JSON error response.
 */
async function streamMessage(
  slug: string,
  sessionId: string,
  request: SendSessionMessageRequest,
  onEvent: (event: SessionChatEvent) => void,
): Promise<void> {
  const res = await fetch(`/api/subjects/${slug}/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? 'Invio della domanda non riuscito');
  }
  await readSse<SessionChatEvent>(res, onEvent);
}

export function formatEur(value: number): string {
  return `€ ${value.toFixed(value < 0.1 ? 4 : 2)}`;
}

/**
 * An answer rendered as Markdown. Valid `[n]` markers become small buttons that open the cited page;
 * while the answer is still streaming (no citations yet) they stay as plain muted text.
 */
export function AnswerMarkdown({
  content,
  citations,
  onOpenCitation,
}: {
  content: string;
  citations: SessionCitationDto[];
  onOpenCitation: (citation: SessionCitationDto, trigger: HTMLElement) => void;
}) {
  const byRef = new Map(citations.map((c) => [c.ref, c]));
  const source = content.replace(/\[(\d+)\]/g, (match, n: string) =>
    byRef.has(Number(n)) ? `[${n}](#cite-${n})` : match,
  );
  return (
    <div className="md-obsidian text-sm">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: true }]]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a: ({ node: _node, href, children, ...props }) => {
            const ref = href?.startsWith('#cite-') ? Number(href.slice(6)) : null;
            const citation = ref !== null ? byRef.get(ref) : undefined;
            if (citation) {
              return (
                <button
                  type="button"
                  onClick={(e) => onOpenCitation(citation, e.currentTarget)}
                  title={`${citation.documentName} · p. ${citation.page}`}
                  className="mx-0.5 rounded bg-accent/15 px-1 align-baseline text-xs font-medium text-accent hover:bg-accent/25"
                >
                  {children}
                </button>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer" {...props}>
                {children}
              </a>
            );
          },
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

function MessageBubble({
  message,
  documentNames,
  onOpenCitation,
  onDeepSearch,
}: {
  message: SessionMessageDto;
  documentNames: Map<string, string>;
  onOpenCitation: (citation: SessionCitationDto) => void;
  /** Offered under the latest answer that stayed within the material. */
  onDeepSearch?: (() => void) | undefined;
}) {
  if (message.role === 'user') {
    return (
      <div className="ml-6 space-y-1 rounded-[var(--radius-control)] bg-bg-raised p-2.5 text-sm text-fg-primary">
        {message.deepSearch && (
          <span className="inline-block rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent">
            Ricerca approfondita
          </span>
        )}
        {message.focus && (
          <blockquote className="border-l-2 border-accent/60 pl-2 text-xs text-fg-muted">
            <span className="line-clamp-3">{message.focus.text}</span>
            <span className="block">
              {documentNames.get(message.focus.docId) ?? 'documento'}
              {message.focus.page ? ` · p. ${message.focus.page}` : ''}
            </span>
          </blockquote>
        )}
        <p className="whitespace-pre-wrap">{message.content}</p>
      </div>
    );
  }
  return (
    <div className="mr-2 space-y-2 text-fg-primary">
      <AnswerMarkdown
        content={message.content}
        citations={message.citations}
        onOpenCitation={onOpenCitation}
      />
      {message.citations.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {message.citations.map((c) => (
            <li key={c.ref}>
              <button
                type="button"
                onClick={() => onOpenCitation(c)}
                className="rounded-full border border-border px-2 py-0.5 text-xs text-fg-secondary hover:border-accent hover:text-fg-primary"
              >
                [{c.ref}] {c.documentName} · p. {c.page}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        !message.deepSearch && (
          <p className="text-xs text-warn">
            Nessuna fonte citata: la risposta non è ancorata al materiale, verificala.
          </p>
        )
      )}
      {message.deepSearch && (
        <p className="text-xs text-fg-muted">
          Ricerca approfondita: le parti fuori dagli appunti vengono dal web o da conoscenze
          generali, verificale. Per l&apos;esame contano gli appunti del corso.
        </p>
      )}
      {onDeepSearch && (
        <button
          type="button"
          onClick={onDeepSearch}
          className="rounded-[var(--radius-control)] border border-border px-2 py-1 text-xs text-fg-secondary hover:border-accent hover:text-fg-primary"
        >
          Cerca anche fuori dagli appunti
        </button>
      )}
    </div>
  );
}

/** Chat query and SSE sending, shared by the desktop panel and the mobile one. */
export function useSessionChat(
  slug: string,
  sessionId: string,
  { focus, onClearFocus }: { focus: SessionFocus | null; onClearFocus: () => void },
) {
  const queryClient = useQueryClient();
  const chatKey = ['sessionChat', slug, sessionId];
  const chat = useQuery({ queryKey: chatKey, queryFn: () => fetchChat(slug, sessionId) });
  const [input, setInput] = useState('');
  const [model, setModel] = useState<string>(MODEL_OPTIONS[0].id);
  const [sending, setSending] = useState(false);
  const [pendingUser, setPendingUser] = useState<SessionMessageDto | null>(null);
  const [streamed, setStreamed] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [deepSearch, setDeepSearch] = useState(false);

  const messages = chat.data?.messages ?? [];

  /**
   * Sends what is in the input box — or, with `retry`, asks an earlier question again with the search
   * beyond the material that the student has just allowed ("Cerca anche fuori dagli appunti").
   */
  async function send(retry?: { content: string; focus: SessionFocus | null }) {
    const content = (retry?.content ?? input).trim();
    if (!content || sending) return;
    const turnFocus = retry ? retry.focus : focus;
    const deep = retry ? true : deepSearch;
    setSending(true);
    setError(null);
    setStreamed('');
    if (!retry) {
      setInput('');
      setDeepSearch(false); // the permission is for one question: the next one starts from the material again
    }
    const request: SendSessionMessageRequest = {
      content,
      model,
      ...(turnFocus ? { focus: turnFocus } : {}),
      ...(deep ? { deepSearch: true } : {}),
    };
    let user: SessionMessageDto | null = null;
    try {
      await streamMessage(slug, sessionId, request, (event) => {
        if (event.type === 'user') {
          user = event.message;
          setPendingUser(event.message);
        } else if (event.type === 'delta') {
          setStreamed((s) => s + event.text);
        } else if (event.type === 'done') {
          const answer = event.message;
          queryClient.setQueryData<SessionChatDto>(chatKey, (old) => ({
            messages: [...(old?.messages ?? []), ...(user ? [user] : []), answer],
            costEur: event.costEur,
          }));
          setPendingUser(null);
          setStreamed('');
          onClearFocus();
        } else {
          setError(event.message);
        }
      });
    } catch (err) {
      setError((err as Error).message);
      if (!retry) setInput(content); // nothing was saved: let the student resend
    } finally {
      setSending(false);
      // Whatever happened, the server is the truth (an errored turn keeps the question, drops the answer).
      await queryClient.invalidateQueries({ queryKey: chatKey });
      setPendingUser(null);
      setStreamed('');
    }
  }

  return {
    chat,
    messages,
    input,
    setInput,
    model,
    setModel,
    sending,
    pendingUser,
    streamed,
    error,
    send,
    deepSearch,
    setDeepSearch,
  };
}

/** The question an answer replied to: what "Cerca anche fuori dagli appunti" asks again. */
export function questionBefore(
  messages: SessionMessageDto[],
  answerIndex: number,
): { content: string; focus: SessionFocus | null } | null {
  const question = messages[answerIndex - 1];
  if (!question || question.role !== 'user') return null;
  return { content: question.content, focus: question.focus };
}

/**
 * The tutor chat of a study session (docs/08-sessione-di-studio.md, phase 2). It answers only from the
 * session's material and cites it. Interactive while the session is active; once it ended it shows the
 * saved Markdown transcript instead, read-only.
 */
export function SessionChat({
  slug,
  sessionId,
  active,
  documentNames,
  focus,
  onClearFocus,
  onOpenCitation,
}: {
  slug: string;
  sessionId: string;
  active: boolean;
  /** Document id → name, to label the selected passage. */
  documentNames: Map<string, string>;
  focus: SessionFocus | null;
  onClearFocus: () => void;
  onOpenCitation: (citation: SessionCitationDto) => void;
}) {
  const {
    chat,
    messages,
    input,
    setInput,
    model,
    setModel,
    sending,
    pendingUser,
    streamed,
    error,
    send,
    deepSearch,
    setDeepSearch,
  } = useSessionChat(slug, sessionId, { focus, onClearFocus });
  const transcript = useQuery({
    queryKey: ['sessionTranscript', slug, sessionId],
    queryFn: () => fetchTranscript(slug, sessionId),
    enabled: !active,
  });

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Follow the answer only while the student is already at the bottom; scrolling up to read stops it.
  const atBottomRef = useRef(true);
  useEffect(() => {
    if (pendingUser) atBottomRef.current = true; // a new question always brings the chat down to it
  }, [pendingUser]);
  useEffect(() => {
    const list = listRef.current;
    // Only the chat's own box scrolls: scrollIntoView would also move the page, and the document with it.
    if (list && atBottomRef.current) list.scrollTop = list.scrollHeight;
  }, [messages.length, streamed, pendingUser]);
  useEffect(() => {
    if (focus) inputRef.current?.focus();
  }, [focus]);

  const header = (
    <header className="flex items-center gap-2 border-b border-border px-3 py-2">
      <h2 className="text-sm font-semibold text-fg-primary">Chiedi al tutor</h2>
      {chat.data && chat.data.costEur > 0 && (
        <span
          className="ml-auto text-xs tabular-nums text-fg-muted"
          title="Costo cumulativo della chat in questa sessione"
        >
          {formatEur(chat.data.costEur)}
        </span>
      )}
    </header>
  );

  if (!active) {
    return (
      <section
        aria-label="Chat della sessione"
        className="flex min-h-0 flex-col rounded-[var(--radius-card)] border border-border bg-bg-surface"
      >
        {header}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {transcript.isLoading && <p className="text-sm text-fg-muted">Caricamento…</p>}
          {transcript.isError && (
            <p role="alert" className="text-sm text-danger">
              {(transcript.error as Error).message}
            </p>
          )}
          {transcript.data ? (
            <>
              <p className="mb-2 text-xs text-fg-muted">
                Sessione terminata: questa è la trascrizione salvata, non più interattiva.
              </p>
              <ObsidianMarkdown source={transcript.data} subjectSlug={slug} />
            </>
          ) : (
            transcript.isSuccess && (
              <p className="text-sm text-fg-muted">Nessuna domanda fatta in questa sessione.</p>
            )
          )}
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Chat della sessione"
      className="flex min-h-0 flex-col rounded-[var(--radius-card)] border border-border bg-bg-surface"
    >
      {header}

      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3"
        aria-live="polite"
      >
        {chat.isLoading && <p className="text-sm text-fg-muted">Caricamento…</p>}
        {chat.isError && (
          <p role="alert" className="text-sm text-danger">
            {(chat.error as Error).message}
          </p>
        )}
        {chat.isSuccess && messages.length === 0 && !pendingUser && (
          <p className="text-sm text-fg-muted">
            Fai una domanda sul materiale di questa sessione. Risponde solo da lì e cita le pagine.
            Per partire da un passaggio, selezionalo nel documento e scegli «Chiedi all&apos;AI».
          </p>
        )}
        {messages.map((m, i) => {
          const retry =
            m.role === 'assistant' && !m.deepSearch && i === messages.length - 1 && !sending
              ? questionBefore(messages, i)
              : null;
          return (
            <MessageBubble
              key={m.id}
              message={m}
              documentNames={documentNames}
              onOpenCitation={onOpenCitation}
              onDeepSearch={retry ? () => void send(retry) : undefined}
            />
          );
        })}
        {pendingUser && (
          <MessageBubble
            message={pendingUser}
            documentNames={documentNames}
            onOpenCitation={onOpenCitation}
          />
        )}
        {sending && (
          <div className="mr-2 text-fg-primary">
            {streamed ? (
              <AnswerMarkdown content={streamed} citations={[]} onOpenCitation={onOpenCitation} />
            ) : (
              <p className="text-sm text-fg-muted">
                {pendingUser?.deepSearch
                  ? 'Sto cercando nel materiale e fuori dagli appunti…'
                  : 'Sto cercando nel materiale…'}
              </p>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>

      <form
        className="space-y-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {focus && (
          <div className="flex items-start gap-2 rounded-[var(--radius-control)] border border-accent/40 bg-bg-raised p-2 text-xs">
            <div className="min-w-0 flex-1">
              <p className="text-fg-muted">
                Passaggio selezionato · {documentNames.get(focus.docId) ?? 'documento'}
                {focus.page ? ` · p. ${focus.page}` : ''}
              </p>
              <p className="line-clamp-2 text-fg-secondary">{focus.text}</p>
            </div>
            <button
              type="button"
              onClick={onClearFocus}
              aria-label="Togli il passaggio selezionato"
              className="text-fg-muted hover:text-fg-primary"
            >
              ✕
            </button>
          </div>
        )}
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={2}
          maxLength={4000}
          disabled={sending}
          placeholder={focus ? 'Cosa non ti è chiaro di questo passaggio?' : 'Scrivi una domanda…'}
          aria-label="Domanda al tutor"
          className="w-full resize-none rounded-[var(--radius-control)] border border-border bg-bg-inset px-2 py-1.5 text-sm text-fg-primary outline-none focus:border-accent disabled:opacity-60"
        />
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <ModelPicker
              value={model}
              onChange={setModel}
              disabled={sending}
              defaultId={MODEL_OPTIONS[0].id}
            />
          </div>
          <button
            type="button"
            aria-pressed={deepSearch}
            onClick={() => setDeepSearch((v) => !v)}
            disabled={sending}
            title="Permetti al tutor di cercare anche fuori dagli appunti (web) per la prossima domanda"
            className={`shrink-0 rounded-[var(--radius-control)] border px-2 py-1 text-xs disabled:opacity-60 ${
              deepSearch
                ? 'border-accent bg-accent/15 text-fg-primary'
                : 'border-border text-fg-secondary hover:text-fg-primary'
            }`}
          >
            Ricerca approfondita
          </button>
          <Button type="submit" size="sm" disabled={sending || !input.trim()}>
            {sending ? 'Risponde…' : 'Invia'}
          </Button>
        </div>
      </form>
    </section>
  );
}
