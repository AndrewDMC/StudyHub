import { describe, expect, it } from 'vitest';
import { resolveSessionScope } from '../src/session.js';

const known = new Set(['d1', 'd2', 'd3', 'd4']);
const links = [
  { documentId: 'd1', topicId: 't1' },
  { documentId: 'd2', topicId: 't1' },
  { documentId: 'd3', topicId: 't2' },
  { documentId: 'd4', topicId: 't3' },
];

describe('resolveSessionScope', () => {
  it('derives topics from the task topic and its material documents', () => {
    const scope = resolveSessionScope({
      task: { topicId: 't1', material: [{ docId: 'd3', pageFrom: 1, pageTo: 4 }] },
      links,
      knownDocumentIds: known,
    });
    expect(scope.topicIds).toEqual(['t1', 't2']);
    // material first, then the other documents of t1/t2
    expect(scope.documentIds).toEqual(['d3', 'd1', 'd2']);
  });

  it('drops material of documents that no longer exist', () => {
    const scope = resolveSessionScope({
      task: { topicId: null, material: [{ docId: 'gone', pageFrom: 1, pageTo: 1 }] },
      links,
      knownDocumentIds: known,
    });
    expect(scope).toEqual({ topicIds: [], documentIds: [] });
  });

  it('lets an explicit topic choice replace the derived topics but keeps the task material', () => {
    const scope = resolveSessionScope({
      task: { topicId: 't1', material: [{ docId: 'd1', pageFrom: 1, pageTo: 2 }] },
      explicitTopicIds: ['t3'],
      links,
      knownDocumentIds: known,
    });
    expect(scope.topicIds).toEqual(['t3']);
    expect(scope.documentIds).toEqual(['d1', 'd4']);
  });

  it('supports a free session without a task', () => {
    const scope = resolveSessionScope({
      task: null,
      explicitTopicIds: ['t2', 't2'],
      links,
      knownDocumentIds: known,
    });
    expect(scope).toEqual({ topicIds: ['t2'], documentIds: ['d3'] });
  });
});
