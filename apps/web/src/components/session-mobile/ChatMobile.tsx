'use client';

import { useEffect, useRef } from 'react';
import { ArrowRight, X } from 'lucide-react';
import type { SessionCitationDto, SessionFocus, StudySessionDto } from '@studyhub/contracts';
import { AnswerMarkdown, formatEur, useSessionChat } from '@/components/SessionChat';
import { MODEL_OPTIONS, modelLabel } from '../ModelPicker';
import { fieldClass } from '../simulation-mobile/styles';
import { SectionError, SkeletonRows } from '../subject-mobile/SectionState';
import type { SourceRef } from './SourceSheet';

/** Tutor chat (tab "Chiedi all'AI"). Enter adds a new line: sending is the button's job on a phone keyboard. */
export function ChatMobile({
  slug,
  sessionId,
  session,
  focus,
  onClearFocus,
  onSource,
  visible,
}: {
  slug: string;
  sessionId: string;
  session: StudySessionDto;
  focus: SessionFocus | null;
  onClearFocus: () => void;
  onSource: (source: SourceRef, trigger: HTMLElement) => void;
  /** The panel stays mounted while hidden, so a streaming answer and the typed text survive a tab switch. */
  visible: boolean;
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
  } = useSessionChat(slug, sessionId, { focus, onClearFocus });
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const documentNames = new Map(session.documents.map((d) => [d.id, d.name]));

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, streamed, pendingUser, visible]);
  useEffect(() => {
    if (input === '' && inputRef.current) inputRef.current.style.height = 'auto';
  }, [input]);
  useEffect(() => {
    if (focus && visible) inputRef.current?.focus();
  }, [focus, visible]);

  const openCitation = (c: SessionCitationDto, trigger: HTMLElement) =>
    onSource({ docId: c.docId, documentName: c.documentName, page: c.page }, trigger);
  const onInlineCitation = openCitation;

  const bubble = (m: (typeof messages)[number]) =>
    m.role === 'user' ? (
      <div
        key={m.id}
        className="max-w-[86%] self-end whitespace-pre-wrap break-words rounded-[12px] bg-accent px-3 py-2.5 text-[15px] leading-normal text-bg-base"
      >
        {m.focus && (
          <blockquote className="mb-1 border-l-2 border-bg-base/50 pl-2 text-xs">
            <span className="line-clamp-3">{m.focus.text}</span>
            <span className="block">
              {documentNames.get(m.focus.docId) ?? 'documento'}
              {m.focus.page ? ` · p. ${m.focus.page}` : ''}
            </span>
          </blockquote>
        )}
        {m.content}
      </div>
    ) : (
      <div
        key={m.id}
        className="flex max-w-[86%] flex-col gap-2 self-start rounded-[12px] border border-border bg-bg-surface px-3 py-2.5"
      >
        <div className="break-words [&_.katex-display]:overflow-x-auto">
          <AnswerMarkdown
            content={m.content}
            citations={m.citations}
            onOpenCitation={onInlineCitation}
          />
        </div>
        {m.citations.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {m.citations.map((c) => (
              <li key={c.ref}>
                <button
                  type="button"
                  onClick={(e) => openCitation(c, e.currentTarget)}
                  className="min-h-11 rounded-full border border-border px-3 text-left text-[13px] text-fg-secondary"
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        role="log"
        aria-label="Conversazione con il tutor"
        aria-live="polite"
        className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-y-contain p-4"
      >
        {chat.isLoading && (
          <div aria-busy="true">
            <SkeletonRows count={2} />
          </div>
        )}
        {chat.isError && (
          <SectionError
            message="Impossibile caricare la chat"
            onRetry={() => void chat.refetch()}
          />
        )}
        {chat.isSuccess && messages.length === 0 && !pendingUser && (
          <p className="text-sm text-fg-secondary">
            Fai una domanda sul materiale di questa sessione. Risponde solo da lì e cita le pagine.
          </p>
        )}
        {messages.map(bubble)}
        {pendingUser && (
          <div className="max-w-[86%] self-end whitespace-pre-wrap break-words rounded-[12px] bg-accent px-3 py-2.5 text-[15px] leading-normal text-bg-base">
            {pendingUser.content}
          </div>
        )}
        {sending && (
          <div className="max-w-[86%] self-start rounded-[12px] border border-border bg-bg-surface px-3 py-2.5">
            {streamed ? (
              <AnswerMarkdown content={streamed} citations={[]} onOpenCitation={onInlineCitation} />
            ) : (
              <p className="text-sm text-fg-secondary">Sto cercando nel materiale…</p>
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

      {chat.data && chat.data.costEur > 0 && (
        <p className="px-4 pb-1 text-xs text-fg-secondary">
          Costo chat: {formatEur(chat.data.costEur)}
        </p>
      )}

      <form
        className="flex shrink-0 flex-col gap-2 border-t border-border bg-bg-surface px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {focus && (
          <div className="flex items-start gap-2 rounded-[var(--radius-control)] border border-accent/40 bg-bg-raised p-2 text-xs">
            <div className="min-w-0 flex-1">
              <p className="break-words text-fg-secondary">
                Passaggio selezionato · {documentNames.get(focus.docId) ?? 'documento'}
                {focus.page ? ` · p. ${focus.page}` : ''}
              </p>
              <p className="line-clamp-2 break-words text-fg-secondary">{focus.text}</p>
            </div>
            <button
              type="button"
              onClick={onClearFocus}
              aria-label="Togli il passaggio selezionato"
              className="-my-1 -mr-1 flex h-11 w-11 shrink-0 items-center justify-center text-fg-secondary"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <label htmlFor="chat-q" className="sr-only">
            Domanda al tutor
          </label>
          <textarea
            id="chat-q"
            ref={inputRef}
            value={input}
            rows={1}
            maxLength={4000}
            disabled={sending}
            onChange={(e) => setInput(e.target.value)}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
            }}
            placeholder={
              focus ? 'Cosa non ti è chiaro di questo passaggio?' : 'Fai una domanda sul materiale…'
            }
            className={`${fieldClass} max-h-32 min-w-0 flex-1 resize-none py-2.5 leading-normal disabled:opacity-60`}
          />
          <button
            type="submit"
            aria-label="Invia"
            disabled={sending || !input.trim()}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-accent text-bg-base disabled:opacity-50"
          >
            <ArrowRight className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="chat-model" className="shrink-0 text-xs text-fg-secondary">
            Modello
          </label>
          <select
            id="chat-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={sending}
            className={`${fieldClass} min-w-0 flex-1 py-0 disabled:opacity-60`}
          >
            {MODEL_OPTIONS.map((m) => (
              <option key={m.id} value={m.id}>
                {modelLabel(m, MODEL_OPTIONS[0].id)}
              </option>
            ))}
          </select>
        </div>
      </form>
    </div>
  );
}
