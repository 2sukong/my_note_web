import { getDB } from './db';
import type { LinkRecord } from '../types/link';

/**
 * 링크(Phase 9) 읽고 쓰는 순수 IO 함수들 — storage/pagePersistence.ts와 같은 이유로
 * zustand store(store/linkStore.ts)와 분리해둔다.
 */

export async function loadAllLinks(): Promise<LinkRecord[]> {
  const db = await getDB();
  return db.getAll('links');
}

export async function saveLink(link: LinkRecord): Promise<void> {
  const db = await getDB();
  await db.put('links', link);
}

export async function deleteLink(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('links', id);
}
