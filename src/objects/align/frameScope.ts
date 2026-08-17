import type { CanvasObject } from '../../types/object';

/**
 * 요구사항(정렬 가이드는 같은 프레임 안에서만): 이 객체가 속한 "정렬 비교 범위"를
 * 구한다. Frame 자신과 frameId가 없는 자유 객체(캔버스에 그냥 놓인 것)는 모두 같은
 * 최상위 범위(null)에 속한다 — 서로 다른 Frame 안의 객체끼리는 절대 비교하지 않지만,
 * 캔버스에 자유롭게 놓인 객체나 Frame 자신끼리는 얼마든지 서로 정렬될 수 있다.
 */
export function alignmentScopeOf(obj: CanvasObject): string | null {
  if (obj.type === 'frame') return null;
  return obj.frameId ?? null;
}

/**
 * all 중에서 scope와 같은 범위에 속한 것만 남긴다. scope가 특정 Frame의 id라면, 그
 * 프레임 자신(FrameObject)도 함께 포함한다 — 자식이 자기 프레임 가장자리에 맞춰
 * 정렬되는 건 자연스러운 동작이라서다.
 */
export function objectsInAlignmentScope(all: CanvasObject[], scope: string | null): CanvasObject[] {
  return all.filter((o) => {
    if (scope === null) return alignmentScopeOf(o) === null;
    return alignmentScopeOf(o) === scope || (o.type === 'frame' && o.id === scope);
  });
}
