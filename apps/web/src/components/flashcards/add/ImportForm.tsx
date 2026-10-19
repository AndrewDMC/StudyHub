'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import type { DeckSummaryDto } from '@studyhub/contracts';
import { importDeck } from '@/lib/deckEditorClient';
import { invalidateFlashcards } from '../api';
import { useNotify } from '../Notifier';
import { BTN_GHOST, BTN_PRIMARY, INPUT, LABEL } from '../shared/styles';
import { FOOTER } from './ManualForm';

const ACCEPTED = ['.apkg', '.csv', '.tsv', '.txt'];

function size(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** "Importa": an Anki package or a CSV/TSV/text file, into a new deck or an existing one. */
export function ImportForm({
  slug,
  decks,
  onClose,
}: {
  slug: string;
  decks: DeckSummaryDto[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const notify = useNotify();
  const [file, setFile] = useState<File | null>(null);
  const [target, setTarget] = useState('');
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = (f: File | undefined | null) => {
    if (!f) return;
    const ok = ACCEPTED.some((ext) => f.name.toLowerCase().endsWith(ext));
    if (!ok) {
      setFile(null);
      setError('Formato non supportato: usa .apkg, .csv, .tsv o .txt.');
      return;
    }
    setError(null);
    setFile(f);
  };

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const out = await importDeck(slug, file, target || undefined);
      invalidateFlashcards(qc, slug);
      notify.success(`${out.imported} card importate in ${out.deck.title}.`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Importazione fallita.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {file ? (
        <div className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-border-strong p-4 text-sm">
          <span className="min-w-0 flex-1 truncate font-medium">{file.name}</span>
          <span className="text-[13px] text-fg-secondary">{size(file.size)}</span>
          <button type="button" onClick={() => setFile(null)} className={BTN_GHOST}>
            Rimuovi
          </button>
        </div>
      ) : (
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            pick(e.dataTransfer.files[0]);
          }}
          className={`flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border-[1.5px] border-dashed p-6 text-center has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent max-md:min-h-44 ${
            over ? 'border-accent bg-accent-subtle' : 'border-border-strong'
          }`}
        >
          <Upload className="size-6 text-fg-secondary" aria-hidden="true" />
          <span className="text-sm font-medium">Trascina qui il file o scegline uno</span>
          <span className="text-[13px] text-fg-secondary">Anki (.apkg), CSV, TSV o testo</span>
          <input
            data-autofocus
            type="file"
            accept=".apkg,.csv,.tsv,.txt"
            className="sr-only"
            onChange={(e) => pick(e.target.files?.[0])}
          />
        </label>
      )}
      <label className={LABEL}>
        Dove metterle
        <select value={target} onChange={(e) => setTarget(e.target.value)} className={INPUT}>
          <option value="">In un nuovo mazzo</option>
          {decks
            .filter((d) => d.status === 'approved')
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
              </option>
            ))}
        </select>
      </label>
      <p className="text-[13px] text-fg-secondary">
        Da Anki arrivano anche i progressi; dal CSV le card ripartono da nuove. Le immagini dei file
        Anki non vengono importate e i doppioni vengono saltati.
      </p>
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
      <div className={`${FOOTER} justify-end`}>
        <button type="submit" disabled={!file || busy} className={`${BTN_PRIMARY} max-md:h-12`}>
          {busy ? 'Importo…' : 'Importa'}
        </button>
      </div>
    </form>
  );
}
