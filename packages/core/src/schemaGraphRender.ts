/**
 * Deterministic, AI-free renderers for a schema graph (docs/07-markdown-layer.md
 * §5.3: "one source, multiple renders") — shared between the worker (writes
 * `content.md`'s Mermaid preview) and the web app (`.canvas`/Mermaid export
 * API routes), so both read the same node/edge shape without depending on
 * `@studyhub/ai`'s Zod schemas.
 */
export interface RenderableSchemaNode {
  key: string;
  label: string;
}

export interface RenderableSchemaEdge {
  from: string;
  to: string;
  type: string;
  label: string | null;
}

export interface JsonCanvasDocument {
  nodes: object[];
  edges: object[];
}

/** JSON Canvas (https://jsoncanvas.org) — openable in Obsidian, laid out on a simple grid. */
export function renderJsonCanvas(
  nodes: RenderableSchemaNode[],
  edges: RenderableSchemaEdge[],
): JsonCanvasDocument {
  const COLUMN_WIDTH = 260;
  const ROW_HEIGHT = 120;
  const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));

  return {
    nodes: nodes.map((n, i) => ({
      id: n.key,
      type: 'text',
      text: n.label,
      x: (i % columns) * COLUMN_WIDTH,
      y: Math.floor(i / columns) * ROW_HEIGHT,
      width: COLUMN_WIDTH - 20,
      height: ROW_HEIGHT - 20,
    })),
    edges: edges.map((e, i) => ({
      id: `e${i}`,
      fromNode: e.from,
      toNode: e.to,
      label: e.label ?? e.type,
    })),
  };
}

/** `graph TD` Mermaid syntax — sanitizes labels since Mermaid breaks on unescaped quotes/newlines. */
export function renderMermaid(
  nodes: RenderableSchemaNode[],
  edges: RenderableSchemaEdge[],
): string {
  const sanitize = (s: string) => s.replace(/"/g, "'").replace(/\n/g, ' ');
  const lines = [
    'graph TD',
    ...nodes.map((n) => `  ${n.key}["${sanitize(n.label)}"]`),
    ...edges.map((e) => `  ${e.from} -->|${sanitize(e.label ?? e.type)}| ${e.to}`),
  ];
  return lines.join('\n');
}
