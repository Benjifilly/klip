/**
 * History model — pure functions, no React Native imports (unit-tested under
 * Node). Two budgets keep a phone happy:
 *   - MAX_ITEMS total rows
 *   - MAX_IMAGE_BLOBS encrypted image blobs on disk
 * Pinned items are never evicted; eviction reports which blobs to delete so
 * the storage layer can reclaim the bytes.
 */

export const MAX_ITEMS = 200;
export const MAX_IMAGE_BLOBS = 20;

export interface HistoryItem {
  id: string;
  kind: 'text' | 'image' | 'file-placeholder';
  text?: string;
  /** Image bytes live in encrypted blob storage, never in the history JSON. */
  blobId?: string;
  fileName?: string;
  deviceName: string;
  direction: 'sent' | 'received';
  ts: number;
  pinned: boolean;
}

export interface EvictResult {
  kept: HistoryItem[];
  deletedBlobIds: string[];
}

/** Items are ordered newest → oldest; evict from the back, skipping pinned. */
export function evict(items: HistoryItem[]): EvictResult {
  const deletedBlobIds: string[] = [];
  const kept = [...items];

  const dropOldestUnpinned = (predicate: (item: HistoryItem) => boolean): boolean => {
    for (let i = kept.length - 1; i >= 0; i--) {
      const item = kept[i];
      if (item.pinned || !predicate(item)) continue;
      kept.splice(i, 1);
      if (item.blobId) deletedBlobIds.push(item.blobId);
      return true;
    }
    return false;
  };

  while (kept.length > MAX_ITEMS) {
    if (!dropOldestUnpinned(() => true)) break; // everything pinned — allow overflow
  }
  while (kept.filter((item) => item.kind === 'image').length > MAX_IMAGE_BLOBS) {
    if (!dropOldestUnpinned((item) => item.kind === 'image')) break;
  }

  return { kept, deletedBlobIds };
}

/** Prepend a new item (newest first) and apply both budgets. */
export function addItem(items: HistoryItem[], item: HistoryItem): EvictResult {
  return evict([item, ...items]);
}
