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

async function fetchChat(slug: string, sessionId: string): Promise<SessionChatDto> {
  const res = await fetch(`/api/subjects/${slug}/sessions/${sessionId}/messages`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? 'Impossibile caricare la chat');
  return body as SessionChatDto;
}

async function fetchTranscript(slug: string, sessionId: string): Promise<string | null> {
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
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffered = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    let end = buffered.indexOf('\n\n');
    while (end >= 0) {
      const line = buffered
        .slice(0, end)
        .split('\n')
        .find((l) => l.startsWith('data: '));
      buffered = buffered.slice(end + 2);
      if (line) onEvent(JSON.parse(line.slice(6)) as SessionChatEvent);
      end = buffered.indexOf('\n\n');
    }
  }
}

function formatEur(value: number): string {
  return `€ ${value.toFixed(value < 0.1 ? 4 : 2)}`;
}

/**
 * An answer rendered as Markdown. Valid `[n]` markers become small buttons that open the cited page;
 * while the answer is still streaming (no citations yet) they stay as plain muted text.
 */
function AnswerMarkdown({
  content,
  citations,
  onOpenCitation,
}: {
  content: string;
  citations: SessionCitationDto[];
  onOpenCitation: (citation: SessionCitationDto) => void;
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
                  onClick={() => onOpenCitation(citation)}
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
}: {
  message: SessionMessageDto;
  documentNames: Map<string, string>;
  onOpenCitation: (citation: SessionCitationDto) => void;
}) {
  if (message.role === 'user') {
    return (
      <div className="ml-6 space-y-1 rounded-[var(--radius-control)] bg-bg-raised p-2.5 text-sm text-fg-primary">
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
        <p className="text-xs text-warn">
          Nessuna fonte citata: la risposta non è ancorata al materiale, verificala.
        </p>
      )}
    </div>
  );
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
  const queryClient = useQueryClient();
  const chatKey = ['sessionChat', slug, sessionId];
  const chat = useQuery({ queryKey: chatKey, queryFn: () => fetchChat(slug, sessionId) });
  const transcript = useQuery({
    queryKey: ['sessionTranscript', slug, sessionId],
    queryFn: () => fetchTranscript(slug, sessionId),
    enabled: !active,
  });

  const [input, setInput] = useState('');
  const [model, setModel] = useState<string>(MODEL_OPTIONS[0].id);
  const [sending, setSending] = useState(false);
  const [pendingUser, setPendingUser] = useState<SessionMessageDto | null>(null);
  const [streamed, setStreamed] = useState('');
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const messages = chat.data?.messages ?? [];
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, streamed, pendingUser]);
  useEffect(() => {
    if (focus) inputRef.current?.focus();
  }, [focus]);

  async function send() {
    const content = input.trim();
    if (!content || sending) return;
    setSending(true);
    setError(null);
    setStreamed('');
    setInput('');
    const request: SendSessionMessageRequest = {
      content,
      model,
      ...(focus ? { focus } : {}),
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
      setInput(content); // nothing was saved: let the student resend
    } finally {
      setSending(false);
      // Whatever happened, the server is the truth (an errored turn keeps the question, drops the answer).
      await queryClient.invalidateQueries({ queryKey: chatKey });
      setPendingUser(null);
      setStreamed('');
    }
  }

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

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3" aria-live="polite">
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
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            documentNames={documentNames}
            onOpenCitation={onOpenCitation}
          />
        ))}
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
              <p className="text-sm text-fg-muted">Sto cercando nel materiale…</p>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div ref={bottomRef} />
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
            <ModelPicker value={model} onChange={setModel} disabled={sending} />
          </div>
          <Button type="submit" size="sm" disabled={sending || !input.trim()}>
            {sending ? 'Risponde…' : 'Invia'}
          </Button>
        </div>
      </form>
    </section>
  );
}
