import { describe, it, expect } from 'vitest';
import { addItem, evict, MAX_ITEMS, MAX_IMAGE_BLOBS, type HistoryItem } from '../src/lib/history';

const text = (i: number, pinned = false): HistoryItem => ({
  id: `t${i}`, kind: 'text', text: `clip ${i}`, deviceName: 'PC', direction: 'received', ts: i, pinned,
});
const image = (i: number, pinned = false): HistoryItem => ({
  id: `i${i}`, kind: 'image', blobId: `b${i}`, deviceName: 'PC', direction: 'received', ts: i, pinned,
});

describe('history model', () => {
  it('prepends new items, newest first', () => {
    const items = addItem(addItem([], text(1)).kept, text(2)).kept;
    expect(items.map((it) => it.id)).toEqual(['t2', 't1']);
  });

  it('caps the list and never evicts pinned items', () => {
    let items: HistoryItem[] = [];
    for (let i = 0; i < MAX_ITEMS + 50; i++) {
      items = addItem(items, text(i, i === 0)).kept;
    }
    expect(items.length).toBe(MAX_ITEMS);
    expect(items[0].id).toBe(`t${MAX_ITEMS + 49}`);
    expect(items.some((it) => it.id === 't0')).toBe(true); // pinned survives
    expect(items.some((it) => it.id === 't1')).toBe(false); // oldest unpinned went first
  });

  it('caps image blobs, evicting oldest unpinned, and reports blob ids to delete', () => {
    let items: HistoryItem[] = [];
    const deleted: string[] = [];
    for (let i = 0; i < MAX_IMAGE_BLOBS + 3; i++) {
      const res = addItem(items, image(i));
      items = res.kept;
      deleted.push(...res.deletedBlobIds);
    }
    expect(deleted).toEqual(['b0', 'b1', 'b2']);
    expect(items.filter((it) => it.kind === 'image').length).toBe(MAX_IMAGE_BLOBS);
  });

  it('pinned images are not evicted by the image cap', () => {
    let items: HistoryItem[] = [];
    for (let i = 0; i < MAX_IMAGE_BLOBS + 2; i++) {
      items = addItem(items, image(i, i === 0)).kept;
    }
    expect(items.some((it) => it.id === 'i0')).toBe(true);
    expect(items.some((it) => it.id === 'i1')).toBe(false); // oldest unpinned evicted instead
  });

  it('evict is idempotent on an already-valid list', () => {
    const items = [text(3), text(2), text(1)];
    const res = evict(items);
    expect(res.kept).toEqual(items);
    expect(res.deletedBlobIds).toEqual([]);
  });
});
