'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import type { DocumentDto } from '@studyhub/contracts';
import {
  remarkObsidianCallouts,
  remarkObsidianInline,
  resolveWikilink,
  splitFrontmatter,
} from '@/lib/obsidianMarkdown';

async function fetchDocuments(slug: string): Promise<DocumentDto[]> {
  const res = await fetch(`/api/subjects/${slug}/documents`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile caricare i documenti');
  return body.documents as DocumentDto[];
}

/** Renders a note the way Obsidian's reading view does: properties, callouts, wikilinks, tags, math, task lists, highlighted code. */
export function ObsidianMarkdown({
  source,
  subjectSlug,
}: {
  source: string;
  /** When set, `[[wikilinks]]` resolve to this subject's documents by file name. */
  subjectSlug?: string;
}) {
  const { properties, body } = useMemo(() => splitFrontmatter(source), [source]);
  const documentsQuery = useQuery({
    queryKey: ['documents', subjectSlug],
    queryFn: () => fetchDocuments(subjectSlug!),
    enabled: !!subjectSlug,
  });
  const documents = documentsQuery.data;

  return (
    <article className="md-obsidian">
      {properties.length > 0 && (
        <dl className="md-properties">
          {properties.map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <ReactMarkdown
        remarkPlugins={[
          remarkGfm,
          [remarkMath, { singleDollarTextMath: true }],
          remarkObsidianCallouts,
          remarkObsidianInline,
        ]}
        rehypePlugins={[rehypeKatex, [rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        components={{
          span: ({ node: _node, className, children, ...props }) => {
            const target = (props as Record<string, unknown>)['data-target'];
            if (className !== 'md-wikilink' || typeof target !== 'string') {
              return (
                <span className={className} {...props}>
                  {children}
                </span>
              );
            }
            const doc = subjectSlug && documents ? resolveWikilink(target, documents) : null;
            if (doc) {
              return (
                <Link
                  href={`/materie/${subjectSlug}/documenti/${doc.id}/originale`}
                  className="md-wikilink"
                  title={doc.originalName}
                >
                  {children}
                </Link>
              );
            }
            return (
              <span className="md-wikilink md-unresolved" title={`${target} (non trovato)`}>
                {children}
              </span>
            );
          },
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          // Vault-relative images can't resolve (no vault), so only remote ones are fetched.
          img: ({ src, alt }) =>
            typeof src === 'string' && /^https?:\/\//.test(src) ? (
              <img src={src} alt={alt ?? ''} loading="lazy" />
            ) : (
              <span className="md-embed">{alt}</span>
            ),
        }}
      >
        {body}
      </ReactMarkdown>
    </article>
  );
}
