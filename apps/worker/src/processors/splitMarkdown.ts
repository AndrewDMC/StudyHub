const MAX_SECTION_CHARS = 4000;

/**
 * Splits an already-converted Markdown document into chunk-sized sections:
 * at every H1/H2 heading (ignoring `#` lines inside code fences), then, for
 * sections longer than `MAX_SECTION_CHARS`, on blank lines. Pure — no I/O.
 */
export function splitMarkdownSections(markdown: string): string[] {
  const sections: string[] = [];
  let current: string[] = [];
  let inFence = false;

  const flush = () => {
    const text = current.join('\n').trim();
    if (text) sections.push(text);
    current = [];
  };

  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (!inFence && /^#{1,2}\s+\S/.test(line)) flush();
    current.push(line);
  }
  flush();

  return sections.flatMap(splitLongSection);
}

function splitLongSection(section: string): string[] {
  if (section.length <= MAX_SECTION_CHARS) return [section];

  const parts: string[] = [];
  let buffer = '';
  for (const paragraph of section.split(/\n{2,}/)) {
    if (buffer && buffer.length + paragraph.length + 2 > MAX_SECTION_CHARS) {
      parts.push(buffer);
      buffer = '';
    }
    buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
  }
  if (buffer) parts.push(buffer);
  return parts;
}
