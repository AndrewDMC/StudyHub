'use client';

import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import {
  remarkObsidianCallouts,
  remarkObsidianInline,
  splitFrontmatter,
} from '@/lib/obsidianMarkdown';

/** Renders a note the way Obsidian's reading view does: properties, callouts, wikilinks, tags, math, task lists, highlighted code. */
export function ObsidianMarkdown({ source }: { source: string }) {
  const { properties, body } = useMemo(() => splitFrontmatter(source), [source]);

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
