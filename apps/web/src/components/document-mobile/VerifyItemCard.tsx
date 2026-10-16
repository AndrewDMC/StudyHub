'use client';

import { useEffect, useId, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { NODE_KINDS } from '../VerifySchemaClient';

export type VerifyState = 'verified' | 'uncertain' | 'illegible' | 'pending';
export type ChosenState = Exclude<VerifyState, 'pending'>;

export interface VerifyItem {
  id: string;
  state: VerifyState;
  text: string;
  note?: string | null;
  /** Nodes only. */
  kind?: string;
  /** Nodes only: where the node sits on the source image, as page fractions. */
  crop?: { x: number; y: number; w: number; h: number } | null;
}

export const STATE_LABEL: Record<VerifyState, string> = {
  verified: 'Verificato',
  uncertain: 'Incerto',
  illegible: 'Illeggibile',
  pending: 'Da confermare',
};

const STATE_TONE: Record<VerifyState, string> = {
  verified: 'var(--ok)',
  uncertain: 'var(--warn)',
  illegible: 'var(--danger)',
  pending: 'var(--fg-muted)',
};

const CHOICES: ChosenState[] = ['verified', 'uncertain', 'illegible'];
const CROP_HEIGHT = 64;
const CROP_MAX_WIDTH = 280;

/** The cropped part of the source image a node was read from (decorative: the text is below). */
function CropPreview({
  src,
  crop,
}: {
  src: string;
  crop: { x: number; y: number; w: number; h: number };
}) {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  if (crop.w <= 0 || crop.h <= 0) return null;

  let box: { w: number; h: number } | null = null;
  if (natural) {
    const aspect = (crop.w * natural.w) / (crop.h * natural.h);
    let w = CROP_HEIGHT * aspect;
    let h = CROP_HEIGHT;
    if (w > CROP_MAX_WIDTH) {
      w = CROP_MAX_WIDTH;
      h = w / aspect;
    }
    box = { w, h };
  }

  return (
    <div aria-hidden="true" className="mb-2">
      {/* Plain <img>: only used to read the natural size of the local document bytes. */}
      <img
        src={src}
        alt=""
        hidden
        onLoad={(e) =>
          setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
        }
      />
      {box ? (
        <div
          className="rounded-[var(--radius-control)] border border-border bg-bg-inset"
          style={{
            width: box.w,
            height: box.h,
            backgroundImage: `url("${src}")`,
            backgroundRepeat: 'no-repeat',
            backgroundSize: `${box.w / crop.w}px ${box.h / crop.h}px`,
            backgroundPosition: `-${(crop.x * box.w) / crop.w}px -${(crop.y * box.h) / crop.h}px`,
          }}
        />
      ) : (
        <div className="h-16 w-40 animate-pulse rounded-[var(--radius-control)] bg-bg-raised" />
      )}
    </div>
  );
}

/** One transcribed block / graph node: editable text, current state and the three state buttons. */
export function VerifyItemCard({
  n,
  item,
  imageUrl,
  onSetState,
  onSetText,
  onSetKind,
}: {
  n: number;
  item: VerifyItem;
  /** Source image, used for the crop preview of nodes. */
  imageUrl: string;
  onSetState: (state: ChosenState, text: string) => Promise<unknown>;
  onSetText: (text: string) => Promise<unknown>;
  onSetKind?: (kind: string) => Promise<unknown>;
}) {
  const [text, setText] = useState(item.text);
  const textId = useId();
  const kindId = useId();
  const run = useMutation({ mutationFn: (job: () => Promise<unknown>) => job() });

  useEffect(() => setText(item.text), [item.text]);

  const tone = STATE_TONE[item.state];
  const flagged = item.state === 'uncertain' || item.state === 'illegible';

  return (
    <article
      id={`verify-item-${item.id}`}
      data-testid="verify-item"
      tabIndex={-1}
      data-state={item.state}
      className="scroll-mt-24 rounded-[var(--radius-card)] border outline-none focus-visible:ring-2 focus-visible:ring-accent bg-bg-surface p-3.5"
      style={{
        borderColor: flagged ? `color-mix(in srgb, ${tone} 40%, var(--border))` : 'var(--border)',
      }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-fg-muted">Blocco {n}</span>
        <span className="text-xs font-semibold" style={{ color: tone }}>
          {STATE_LABEL[item.state]}
        </span>
      </div>

      {item.crop && <CropPreview src={imageUrl} crop={item.crop} />}

      <label htmlFor={textId} className="mb-1 block text-[13px] text-fg-secondary">
        Testo trascritto
      </label>
      <textarea
        id={textId}
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text !== item.text && text.trim() !== '') run.mutate(() => onSetText(text));
        }}
        className="w-full min-w-0 rounded-[var(--radius-control)] border border-border bg-bg-inset p-2.5 text-base text-fg-primary outline-none focus:border-accent"
      />

      {onSetKind && item.kind && (
        <div className="mt-2">
          <label htmlFor={kindId} className="mb-1 block text-[13px] text-fg-secondary">
            Tipo
          </label>
          <select
            id={kindId}
            value={item.kind}
            onChange={(e) => run.mutate(() => onSetKind(e.target.value))}
            className="min-h-11 w-full rounded-[var(--radius-control)] border border-border bg-bg-inset px-3 text-[15px] text-fg-primary"
          >
            {NODE_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
      )}

      {item.note && item.state !== 'verified' && (
        <p className="mt-2 text-[13px] italic text-fg-muted">⟨{item.note}⟩</p>
      )}

      <div
        role="group"
        aria-label={`Stato del blocco ${n}`}
        className="mt-3 grid grid-cols-3 gap-2"
      >
        {CHOICES.map((choice) => {
          const pressed = item.state === choice;
          return (
            <button
              key={choice}
              type="button"
              aria-pressed={pressed}
              disabled={run.isPending}
              onClick={() => run.mutate(() => onSetState(choice, text))}
              className={`min-h-11 rounded-[var(--radius-control)] border px-1 text-[13px] disabled:opacity-60 ${
                pressed
                  ? 'border-accent bg-accent-subtle font-medium text-fg-primary'
                  : 'border-border text-fg-secondary'
              }`}
            >
              {STATE_LABEL[choice]}
            </button>
          );
        })}
      </div>
      {run.isError && (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          {(run.error as Error).message}
        </p>
      )}
    </article>
  );
}
