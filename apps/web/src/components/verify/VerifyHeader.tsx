'use client';

import Link from 'next/link';

/** Subject link, "Verifica · argomento", the +3 / +7 badge and the closed-book reminder. */
export function VerifyHeader({
  subjectName,
  subjectHref,
  topicName,
  daysOffset,
}: {
  subjectName: string;
  subjectHref: string;
  topicName: string | null;
  daysOffset: 3 | 7 | null;
}) {
  return (
    <header className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-border bg-bg-inset px-6 py-3 max-md:px-4 max-md:pt-[calc(0.75rem+env(safe-area-inset-top))]">
      <Link
        href={subjectHref}
        aria-label={`Torna alla materia ${subjectName}`}
        className="inline-flex h-9 items-center gap-1.5 text-[13px] text-fg-secondary outline-none hover:text-fg-primary focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent max-md:min-h-11"
      >
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M10 3 5 8l5 5" />
        </svg>
        <span className="max-md:max-w-[9rem] max-md:truncate">{subjectName}</span>
      </Link>
      <div className="flex min-w-0 items-center gap-2.5">
        <h1 className="min-w-0 break-words text-base font-semibold">
          {topicName ? `Verifica · ${topicName}` : 'Verifica'}
        </h1>
        {daysOffset && (
          <span className="inline-flex h-[22px] shrink-0 items-center rounded-[6px] bg-ok/10 px-2 text-xs font-medium text-ok">
            +{daysOffset} giorni
          </span>
        )}
      </div>
      <span className="ml-auto inline-flex items-center gap-1.5 text-[13px] text-fg-secondary max-md:ml-0 max-md:basis-full">
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="7" width="10" height="7" rx="1.5" />
          <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
        </svg>
        Materiale chiuso
      </span>
    </header>
  );
}
