import { getDB } from './db';
import type { CanvasObject } from '../types/object';

/**
 * Page의 objects 스냅샷을 읽고 쓰는 순수 IO 함수들. zustand store를 import하지 않는다 —
 * fileTreeStore.ts(오케스트레이션: 언제 저장/로드할지, refCount/history를 어떻게
 * 다룰지)와 이 파일(어떻게 저장/로드할지)을 분리해 순환 참조를 피한다.
 */

export async function savePageObjects(pageId: string, objects: CanvasObject[]): Promise<void> {
  const db = await getDB();
  await db.put('pageObjects', { pageId, objects });
}

export async function loadPageObjects(pageId: string): Promise<CanvasObject[]> {
  const db = await getDB();
  const record = await db.get('pageObjects', pageId);
  return record?.objects ?? [];
}

export async function deletePageObjects(pageId: string): Promise<void> {
  const db = await getDB();
  await db.delete('pageObjects', pageId);
}
