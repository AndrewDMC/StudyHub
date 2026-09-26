import type { SchemaGraphEdge, SchemaGraphGroup, SchemaGraphNode } from '@studyhub/ai';

export { renderJsonCanvas, renderMermaid } from '@studyhub/core';

export interface SchemaGraphDocument {
  originalName: string;
  nodes: SchemaGraphNode[];
  edges: SchemaGraphEdge[];
  groups: SchemaGraphGroup[];
}

function yamlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function cropLiteral(node: SchemaGraphNode): string {
  if (!node.crop) return 'null';
  const { x, y, w, h } = node.crop;
  return yamlString(`p1@[${x.toFixed(3)},${y.toFixed(3)},${w.toFixed(3)},${h.toFixed(3)}]`);
}

/**
 * Renders `content.md` for a `schemi` document from the AI's structured
 * output (docs/07-markdown-layer.md §5.2/§3.1) — deterministically, from
 * data we've already Zod-validated, never trusting raw markdown/YAML text
 * from the model itself. `crop` is a normalized (0..1) fraction of the page,
 * not the pixel box the doc's own worked example uses — this app never
 * needs the source image's raw pixel dimensions to render it.
 */
export function renderSchemaMarkdown(doc: SchemaGraphDocument): string {
  const uncertainCount = doc.nodes.filter((n) => n.confidence === 'uncertain').length;
  const unreadableCount = doc.nodes.filter((n) => n.confidence === 'unreadable').length;
  const overall =
    doc.nodes.length === 0
      ? 1
      : (doc.nodes.length - uncertainCount - unreadableCount) / doc.nodes.length;

  const frontMatter = [
    '---',
    'kind: schema',
    'schema:',
    '  nodes:',
    ...doc.nodes.map(
      (n) =>
        `    ${n.key}: { label: ${yamlString(n.label)}, kind: ${n.kind}, crop: ${cropLiteral(n)}, conf: ${n.confidence} }`,
    ),
    '  edges:',
    ...doc.edges.map(
      (e) =>
        `    - { from: ${e.from}, to: ${e.to}, type: ${e.type}${e.label ? `, label: ${yamlString(e.label)}` : ''} }`,
    ),
    '  groups:',
    ...doc.groups.map(
      (g) => `    ${g.key}: { label: ${yamlString(g.label)}, nodes: [${g.nodeKeys.join(', ')}] }`,
    ),
    `confidence: { overall: ${overall.toFixed(2)}, uncertainBlocks: ${uncertainCount}, unreadableBlocks: ${unreadableCount} }`,
    '---',
    '',
  ].join('\n');

  const groupByNode = new Map<string, string>();
  for (const g of doc.groups) {
    for (const key of g.nodeKeys) groupByNode.set(key, g.key);
  }

  const body = doc.nodes.map((n) => {
    const marker = n.confidence === 'ok' ? '' : `  <!--conf:${n.confidence}-->`;
    const heading = groupByNode.has(n.key) ? '####' : '##';
    return `${heading} ${n.label}  ^${n.key}${marker}`;
  });

  return [`# ${doc.originalName}`, '', frontMatter, ...body, ''].join('\n');
}
