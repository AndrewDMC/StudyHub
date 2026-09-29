import type { Blockquote, Paragraph, PhrasingContent, Root, Text } from 'mdast';
import { visit, SKIP } from 'unist-util-visit';

/**
 * Remark plugins for the Obsidian-flavoured bits CommonMark/GFM don't cover: `[[wikilinks]]`,
 * `![[embeds]]`, `==highlights==`, `#tags` and `> [!callout]` blockquotes. Rendered as plain
 * styled elements (no link resolution — a document viewer has no vault to resolve against).
 */

const INLINE = /(!?\[\[([^\]\n]+)\]\])|(==([^=\n]+)==)|(?<=^|\s)(#[\p{L}_][\p{L}\p{N}_/-]*)/gu;

function splitText(value: string): PhrasingContent[] | null {
  INLINE.lastIndex = 0;
  const out: PhrasingContent[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE.exec(value)) !== null) {
    if (match.index > last) out.push({ type: 'text', value: value.slice(last, match.index) });
    if (match[1]) {
      const embed = match[1].startsWith('!');
      const [target = '', alias] = match[2]!.split('|');
      const label = alias ?? target.split('#')[0]!.split('/').pop() ?? target;
      out.push({
        type: 'text',
        value: embed ? `${label}` : label,
        data: {
          hName: 'span',
          hProperties: {
            className: [embed ? 'md-embed' : 'md-wikilink'],
            title: target,
            'data-target': target,
          },
        },
      } as Text);
    } else if (match[3]) {
      out.push({
        type: 'text',
        value: match[4]!,
        data: { hName: 'mark' },
      } as Text);
    } else {
      out.push({
        type: 'text',
        value: match[5]!,
        data: { hName: 'span', hProperties: { className: ['md-tag'] } },
      } as Text);
    }
    last = match.index + match[0].length;
  }
  if (out.length === 0) return null;
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) });
  return out;
}

export function remarkObsidianInline() {
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || index === undefined || node.data) return;
      const replacement = splitText(node.value);
      if (!replacement) return;
      parent.children.splice(index, 1, ...(replacement as never[]));
      return [SKIP, index + replacement.length];
    });
  };
}

const CALLOUT = /^\[!([A-Za-z-]+)\]([+-]?)[ \t]*/;

export function remarkObsidianCallouts() {
  return (tree: Root) => {
    visit(tree, 'blockquote', (node: Blockquote) => {
      const first = node.children[0] as Paragraph | undefined;
      const text = first?.type === 'paragraph' ? first.children[0] : undefined;
      if (!first || text?.type !== 'text') return;
      const match = CALLOUT.exec(text.value);
      if (!match) return;

      const kind = match[1]!.toLowerCase();
      const rest = text.value.slice(match[0].length);
      const newline = rest.indexOf('\n');
      const title = (newline === -1 ? rest : rest.slice(0, newline)).trim();
      const body = newline === -1 ? '' : rest.slice(newline + 1);

      if (body) text.value = body;
      else first.children.shift();
      if (first.children.length === 0) node.children.shift();

      node.data = {
        hName: 'div',
        hProperties: { className: ['md-callout'], 'data-callout': kind },
      };
      node.children.unshift({
        type: 'paragraph',
        data: { hName: 'div', hProperties: { className: ['md-callout-title'] } },
        children: [{ type: 'text', value: title || kind[0]!.toUpperCase() + kind.slice(1) }],
      } as Paragraph);
    });
  };
}

/** Splits a leading `---` YAML block off the note. `properties` are shallow `key: value` pairs. */
export function splitFrontmatter(source: string): {
  properties: [string, string][];
  body: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
  if (!match) return { properties: [], body: source };
  const properties: [string, string][] = [];
  for (const line of match[1]!.split(/\r?\n/)) {
    const kv = /^([^\s:#][^:]*):\s*(.*)$/.exec(line);
    if (kv) properties.push([kv[1]!.trim(), kv[2]!.replace(/^\[|\]$/g, '').trim()]);
  }
  return { properties, body: source.slice(match[0].length) };
}

const stem = (name: string) =>
  name
    .replace(/\.[A-Za-z0-9]{1,8}$/, '')
    .normalize('NFC')
    .trim()
    .toLowerCase();

/**
 * Resolves a `[[wikilink]]` target (`Folder/Note#Heading|alias` minus the alias) to a document of
 * the same subject by file name, ignoring case, folders, extension and heading/block anchors —
 * Obsidian's own "shortest path" matching, with the subject's documents as the vault.
 */
export function resolveWikilink<T extends { originalName: string }>(
  target: string,
  documents: readonly T[],
): T | null {
  const name = target.split(/[#^]/)[0]!.split('/').pop() ?? '';
  const wanted = stem(name);
  if (!wanted) return null;
  return (
    documents.find((d) => d.originalName.normalize('NFC').toLowerCase() === name.toLowerCase()) ??
    documents.find((d) => stem(d.originalName) === wanted) ??
    null
  );
}
