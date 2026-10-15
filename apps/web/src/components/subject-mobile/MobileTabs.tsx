'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { tabLinks, type MobileTab } from '@/lib/subjectTabs';

export function MobileTabs({ slug, activeTab }: { slug: string; activeTab: MobileTab | 'piano' }) {
  const activeRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    activeRef.current?.scrollIntoView({
      inline: 'center',
      block: 'nearest',
      behavior: reduce ? 'auto' : 'smooth',
    });
  }, [activeTab]);

  return (
    <nav aria-label="Sezioni della materia">
      <ul className="flex gap-5 overflow-x-auto border-b border-border px-4 [scrollbar-width:none]">
        {tabLinks(slug).map((tab) => {
          const active = tab.key === activeTab;
          return (
            <li key={tab.key} className="shrink-0">
              <Link
                ref={active ? activeRef : undefined}
                href={tab.href}
                replace={tab.key !== 'piano'}
                scroll={false}
                aria-current={active ? 'page' : undefined}
                className={`-mb-px flex min-h-11 items-center whitespace-nowrap border-b-2 text-sm font-medium ${
                  active
                    ? 'border-accent text-fg-primary'
                    : 'border-transparent text-fg-secondary hover:text-fg-primary'
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
