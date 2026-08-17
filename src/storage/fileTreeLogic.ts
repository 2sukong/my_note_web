import type { CanvasObject } from '../types/object';
import type { FileRecord } from './db';

/**
 * fileTreeStore.ts에서 쓰는 순수 로직만 모아둔 모듈 — DOM/IndexedDB/zustand에 전혀
 * 의존하지 않아 Vitest로 단위 테스트하기 좋다(anchorEngine.ts와 같은 관례).
 */

/** targetId가 rootId 자신이거나 rootId의 (임의 깊이) 하위 File인지 검사한다.
 * moveFile(id, newParentId)에서 newParentId가 id 자신의 하위 트리에 있으면
 * 순환 참조가 생기므로 막아야 한다 — isDescendantOrSelf(files, id, newParentId)로 검사. */
export function isDescendantOrSelf(
  files: Record<string, FileRecord>,
  rootId: string,
  targetId: string,
): boolean {
  if (rootId === targetId) return true;
  const root = files[rootId];
  if (!root) return false;
  return root.childFileIds.some((childId) => isDescendantOrSelf(files, childId, targetId));
}

/** File 하위 트리(자기 자신 포함)에 속한 모든 File id를 모은다(삭제 cascade에 사용). */
export function collectFileSubtreeIds(files: Record<string, FileRecord>, rootId: string): string[] {
  const result: string[] = [];
  function walk(id: string) {
    const file = files[id];
    if (!file) return;
    result.push(id);
    for (const childId of file.childFileIds) walk(childId);
  }
  walk(rootId);
  return result;
}

/** rootFileIds에서 시작해 File 트리를 깊이 우선으로 순회하며 처음 만나는 Page id를 찾는다.
 * 각 File은 자기 pageIds를 먼저 보고, 그다음 하위 File들을 재귀적으로 본다. */
export function findFirstPageId(
  rootFileIds: string[],
  files: Record<string, FileRecord>,
): string | null {
  for (const fileId of rootFileIds) {
    const found = findFirstPageInFile(fileId, files);
    if (found) return found;
  }
  return null;
}

function findFirstPageInFile(fileId: string, files: Record<string, FileRecord>): string | null {
  const file = files[fileId];
  if (!file) return null;
  if (file.pageIds.length > 0) return file.pageIds[0];
  for (const childId of file.childFileIds) {
    const found = findFirstPageInFile(childId, files);
    if (found) return found;
  }
  return null;
}

/** frameId를 가질 수 있는 객체 타입인지 — objectsStore.ts의 동일 이름 헬퍼와 같은 목록. */
function hasFrameId(obj: CanvasObject): obj is CanvasObject & { frameId?: string | null } {
  return obj.type === 'text' || obj.type === 'image' || obj.type === 'arrow' || obj.type === 'rectangle';
}

/**
 * Page/File 복제 시 한 Page의 objects 배열을 새 id로 통째로 복제한다. 각 객체의
 * 최상위 id를 새로 발급하고, frameId처럼 "같은 Page 안의 다른 객체 id"를 참조하는
 * 필드도 같은 매핑으로 함께 바꿔준다 — 그렇지 않으면 복제된 Frame은 새 id를 받는데
 * 그 안의 Text/Image/Arrow/Rectangle은 여전히 원본 Frame의 (이제는 존재하지 않는)
 * id를 참조하게 되어 소속 관계가 끊어진다.
 *
 * 이미지: ImageObject.imageId는 절대 바꾸지 않는다 — Blob을 복제하지 않고 그대로
 * 공유하는 설계(imageStore.ts 상단 주석 참고)라서, 원본과 사본이 같은 imageId를
 * 계속 가리키는 게 의도된 동작이다.
 *
 * TextLine/TextAnnotation/Highlight 등 객체 내부의 중첩 id는 그대로 둔다 — 이 값들은
 * 항상 (objectId, lineId, ...) 튜플로만 조회되고 전역적으로 조회되지 않으므로, 서로
 * 다른 두 최상위 객체가 같은 내부 id를 갖고 있어도 충돌하지 않는다.
 */
export function cloneObjectsWithNewIds(objects: CanvasObject[]): CanvasObject[] {
  const idMap = new Map<string, string>();
  for (const obj of objects) idMap.set(obj.id, crypto.randomUUID());

  return objects.map((obj) => {
    const clone = structuredClone(obj) as CanvasObject;
    clone.id = idMap.get(obj.id)!;
    if (hasFrameId(clone) && clone.frameId) {
      clone.frameId = idMap.get(clone.frameId) ?? null;
    }
    return clone;
  });
}
