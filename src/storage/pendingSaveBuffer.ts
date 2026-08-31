import type { CanvasObject } from '../types/object';

/**
 * 버그 수정(텍스트 상자 리사이즈 직후 F5 하면 크기가 되돌아옴 — 근본 원인은
 * fileTreeStore.ts의 flushActivePage 주석 참고): IndexedDB에 대한 실제 쓰기(db.put)는
 * 트랜잭션이 완전히 commit되어야 resolve되는 비동기 작업이다. "저장을 시작하는
 * 시점"을 아무리 앞당겨도(endTransaction 즉시 flush) 그 시작과 commit 완료 사이에는
 * 실제 디스크 I/O를 기다리는 진짜 비동기 구간이 있고, 그 사이에 F5가 눌리면 페이지가
 * 통째로 사라지면서 그 트랜잭션의 완료 콜백이 아예 발화되지 않을 수 있다 — 즉 "저장을
 * 시작했다"는 것이 "저장이 끝났다"를 보장하지 않는다.
 *
 * localStorage.setItem은 동기 API라 호출이 반환되는 순간 이미 그 값을 가진 것으로
 * 취급할 수 있고(같은 브라우저 프로세스 안에서 일어나는 F5/새로고침은 이 값을
 * 지우지 않는다 — 페이지가 사라지는 게 아니라 같은 오리진의 스토리지 위에서
 * 새 문서가 다시 열리는 것뿐이다), IndexedDB처럼 별도의 커밋 대기 시간이 없다.
 * 그래서 IndexedDB 쓰기를 "시작"하기 직전에 지금 저장하려는 스냅샷을 먼저 동기적으로
 * 여기 남겨두고, IndexedDB 커밋이 실제로 성공을 확인하면 지운다. 다음 로드 시 이
 * 값이 아직 남아 있다면 "마지막 저장 시도의 커밋을 확인받지 못했다"는 뜻이므로
 * IndexedDB에 저장된 값보다 이 값을 신뢰해서 복구한다.
 *
 * pageId별로 독립된 키를 쓴다. 저장 요청끼리 겹칠 때(예: 리사이즈를 빠르게 연속으로
 * 두 번 놓아 flushActivePage가 겹쳐 호출되는 경우) 오래된 저장의 완료 콜백이 그
 * 사이에 더 최신 저장이 덮어써 놓은 버퍼를 실수로 지우지 않도록, 쓸 때마다 seq
 * 번호를 함께 저장해서 "지금 버퍼가 여전히 내가 쓴 그 값인지"를 확인한 뒤에만 지운다
 * (IndexedDB 자체의 쓰기 순서 보장과는 별개로, 이 버퍼만을 위한 낙관적 잠금이다).
 */

const KEY_PREFIX = 'my-note-web:pending-save:';

interface PendingSnapshot {
  seq: number;
  objects: CanvasObject[];
}

function keyFor(pageId: string): string {
  return `${KEY_PREFIX}${pageId}`;
}

function readRaw(pageId: string): PendingSnapshot | null {
  try {
    const raw = localStorage.getItem(keyFor(pageId));
    if (!raw) return null;
    return JSON.parse(raw) as PendingSnapshot;
  } catch (e) {
    console.warn('[my-note-web] pending-save 버퍼 읽기 실패', e);
    return null;
  }
}

/** IndexedDB 쓰기를 시작하기 직전에 호출한다. 반드시 동기적으로 끝나야 하므로
 * 호출부(flushActivePage)에서 await보다 먼저 실행돼야 한다. */
export function writePendingSnapshot(pageId: string, objects: CanvasObject[], seq: number): void {
  try {
    localStorage.setItem(keyFor(pageId), JSON.stringify({ seq, objects } satisfies PendingSnapshot));
  } catch (e) {
    // 이 버퍼는 어디까지나 추가 안전장치다 — 프라이빗 모드/용량 초과 등으로 실패해도
    // 원래 IndexedDB 저장 흐름 자체를 막아서는 안 된다.
    console.warn('[my-note-web] pending-save 버퍼 기록 실패', e);
  }
}

/** IndexedDB 커밋이 성공을 확인한 뒤 호출한다. 그 사이 더 최신 저장이 버퍼를
 * 덮어썼다면(seq가 다르면) 그 최신 버퍼는 건드리지 않고 그대로 둔다 — 그 저장이
 * 끝날 때 스스로 지운다. */
export function clearPendingSnapshotIfMatches(pageId: string, seq: number): void {
  try {
    const current = readRaw(pageId);
    if (current && current.seq === seq) {
      localStorage.removeItem(keyFor(pageId));
    }
  } catch (e) {
    console.warn('[my-note-web] pending-save 버퍼 정리 실패', e);
  }
}

/** 로드 시점에 복구를 마치고 IndexedDB에 다시 반영(자가 복구)한 뒤 무조건 지울 때
 * 쓴다 — 이 시점엔 suppressAutosave가 켜져 있어 동시에 겹칠 다른 저장이 없다. */
export function clearPendingSnapshot(pageId: string): void {
  try {
    localStorage.removeItem(keyFor(pageId));
  } catch (e) {
    console.warn('[my-note-web] pending-save 버퍼 정리 실패', e);
  }
}

/** pageId에 커밋 미확인 상태로 남아있는 스냅샷이 있으면 반환한다(없으면 null). */
export function readPendingSnapshot(pageId: string): CanvasObject[] | null {
  return readRaw(pageId)?.objects ?? null;
}
