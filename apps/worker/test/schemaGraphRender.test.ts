import { describe, expect, it } from 'vitest';
import {
  renderJsonCanvas,
  renderMermaid,
  renderSchemaMarkdown,
} from '../src/processors/schemaGraphRender.js';
import type { SchemaGraphEdge, SchemaGraphGroup, SchemaGraphNode } from '@studyhub/ai';

const nodes: SchemaGraphNode[] = [
  {
    key: 'n1',
    label: 'Primo principio',
    kind: 'principio',
    crop: { x: 0.1, y: 0.1, w: 0.3, h: 0.1 },
    confidence: 'ok',
  },
  { key: 'n2', label: 'Trasf. adiabatica', kind: 'caso', crop: null, confidence: 'uncertain' },
];
const edges: SchemaGraphEdge[] = [{ from: 'n1', to: 'n2', type: 'implica', label: 'Q = 0' }];
const groups: SchemaGraphGroup[] = [{ key: 'g1', label: 'Trasformazioni', nodeKeys: ['n2'] }];

describe('renderSchemaMarkdown', () => {
  it('renders a front-matter block with nodes/edges/groups and body anchors', () => {
    const md = renderSchemaMarkdown({ originalName: 'schema.jpg', nodes, edges, groups });
    expect(md).toContain('kind: schema');
    expect(md).toContain('n1: { label: "Primo principio", kind: principio');
    expect(md).toContain('- { from: n1, to: n2, type: implica, label: "Q = 0" }');
    expect(md).toContain('g1: { label: "Trasformazioni", nodes: [n2] }');
    expect(md).toContain('^n1');
    expect(md).toContain('^n2  <!--conf:uncertain-->');
    // n2 is in a group -> deeper heading than n1
    expect(md).toContain('#### Trasf. adiabatica');
    expect(md).toContain('## Primo principio');
  });

  it('computes overall confidence and counts from the node list', () => {
    const md = renderSchemaMarkdown({ originalName: 'x.jpg', nodes, edges: [], groups: [] });
    expect(md).toContain('uncertainBlocks: 1');
    expect(md).toContain('unreadableBlocks: 0');
    expect(md).toContain('overall: 0.50');
  });

  it('handles an empty graph without crashing', () => {
    const md = renderSchemaMarkdown({
      originalName: 'empty.jpg',
      nodes: [],
      edges: [],
      groups: [],
    });
    expect(md).toContain('overall: 1.00');
  });
});

describe('renderJsonCanvas', () => {
  it('produces one canvas node per graph node and one edge per graph edge', () => {
    const canvas = renderJsonCanvas(nodes, edges);
    expect(canvas.nodes).toHaveLength(2);
    expect(canvas.edges).toHaveLength(1);
    expect((canvas.edges[0] as { fromNode: string }).fromNode).toBe('n1');
  });
});

describe('renderMermaid', () => {
  it('produces a graph TD with sanitized labels', () => {
    const withQuote: SchemaGraphNode = { ...nodes[0]!, label: 'Say "hi"' };
    const mermaid = renderMermaid([withQuote], []);
    expect(mermaid).toContain('graph TD');
    expect(mermaid).toContain(`n1["Say 'hi'"]`);
  });

  it('renders an edge line with its type as the label when none is given', () => {
    const mermaid = renderMermaid(nodes, [{ from: 'n1', to: 'n2', type: 'causa', label: null }]);
    expect(mermaid).toContain('n1 -->|causa| n2');
  });
});
