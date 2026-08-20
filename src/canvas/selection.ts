import { useObjectsStore } from '../store/objectsStore';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 마퀴(영역 선택) 사각형 안에 "완전히 포함된" 객체들의 id를 zIndex 순서와 무관하게 반환한다.
 *
 * 살짝만 겹쳐도 선택되는 "교차(intersect)" 방식 대신 "완전 포함(contains)" 방식을 골랐다 —
 * 안 그러면 Frame처럼 다른 객체를 다 감싸는 큰 배경 객체가, 그 안의 작은 메모 몇 개만
 * 마퀴로 선택하려 해도 매번 같이 걸려서(마퀴 사각형이 Frame 내부에 있으면 항상 Frame과
 * 겹치므로) 사용자가 의도하지 않은 Frame까지 함께 선택되는 경우가 매우 흔해진다.
 * 완전 포함 기준이면 Frame처럼 큰 객체는 마퀴가 그 Frame 전체를 감쌀 때만 선택되어
 * PowerPoint/Google Slides류 도구의 기본 동작과 같아진다.
 */
export function objectsFullyInsideRect(rect: Rect): string[] {
  const left = rect.x;
  const top = rect.y;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;

  const ids: string[] = [];
  for (const obj of Object.values(useObjectsStore.getState().objects)) {
    const objRight = obj.x + obj.width;
    const objBottom = obj.y + obj.height;
    if (obj.x >= left && obj.y >= top && objRight <= right && objBottom <= bottom) {
      ids.push(obj.id);
    }
  }
  return ids;
}

/**
 * 마퀴 사각형과 "교차(intersect)"하는 Text 객체들의 id를 반환한다(zIndex 순서 무관).
 *
 * Ctrl+드래그 전용 선택 방식이다 — objectsFullyInsideRect의 "완전 포함" 기준과 달리,
 * 살짝만 겹쳐도 선택되는 교차 기준을 쓴다. Text만 대상으로 하므로 objectsFullyInsideRect의
 * 완전 포함 기준을 채택한 이유였던 "Frame이 항상 함께 걸리는 문제"가 애초에 발생하지 않는다.
 */
export function textObjectsIntersectingRect(rect: Rect): string[] {
  const left = rect.x;
  const top = rect.y;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;

  const ids: string[] = [];
  for (const obj of Object.values(useObjectsStore.getState().objects)) {
    if (obj.type !== 'text') continue;
    const objRight = obj.x + obj.width;
    const objBottom = obj.y + obj.height;
    if (obj.x < right && objRight > left && obj.y < bottom && objBottom > top) {
      ids.push(obj.id);
    }
  }
  return ids;
}

/** world 좌표 두 점(드래그 시작/끝)으로부터 정규화된(x<=x+width, y<=y+height) 사각형을 만든다. */
export function normalizeRect(start: { x: number; y: number }, end: { x: number; y: number }): Rect {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  return { x, y, width, height };
}
