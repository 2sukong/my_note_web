import type { TextHighlight } from './indentation/types';

/**
 * 줄에 종속된 "구간 데이터"(하이라이트, 주석)에 공통으로 적용되는 편집 로직.
 * Phase 4 1차에서는 하이라이트 전용이었지만, Phase 4 2차에서 Annotation도
 * 같은 원리(줄 텍스트 기준 start/end 오프셋)로 관리하게 되면서 제네릭으로 넓혔다.
 * TextHighlight({..., color})와 TextAnnotation({..., text}) 둘 다
 * `{id, start, end}`를 만족하므로 그대로 재사용할 수 있다.
 */
type Range = { id: string; start: number; end: number };

export function createRangeId(): string {
  return crypto.randomUUID();
}

export function createHighlight(start: number, end: number, color: TextHighlight['color']): TextHighlight {
  return { id: createRangeId(), start, end, color };
}

/**
 * [start, end) 구간과 겹치는 부분을 existing에서 들어낸다(트리밍/분할) — 겹치지
 * 않는 하이라이트는 그대로, 부분적으로 겹치면 겹치지 않는 조각만 남기고, 완전히
 * 덮이면 사라진다. paintOverHighlights(겹친 자리에 새 하이라이트를 얹음)와
 * eraseHighlightsInRange(겹친 자리를 비움) 둘 다가 공유하는 핵심 로직이라 하나로
 * 뽑아둔다.
 */
function trimHighlightsOutOfRange(existing: TextHighlight[] | undefined, start: number, end: number): TextHighlight[] {
  const result: TextHighlight[] = [];
  for (const h of existing ?? []) {
    if (h.end <= start || h.start >= end) {
      result.push(h); // 구간과 안 겹침 — 그대로 둔다.
      continue;
    }
    const hasLeftRemainder = h.start < start;
    const hasRightRemainder = h.end > end;
    if (hasLeftRemainder) result.push({ ...h, end: start });
    // 왼쪽 조각을 이미 만들어 원래 id를 썼다면, 오른쪽 조각은 새 id가 필요하다
    // (하나의 하이라이트가 두 조각으로 쪼개지는 경우 — splitHighlightsAtOffset과 동일한 관례).
    if (hasRightRemainder) result.push({ ...h, id: hasLeftRemainder ? createRangeId() : h.id, start: end });
  }
  return result;
}

/**
 * 버그 수정(새로고침 후 형광펜이 중복돼 보임): 같은/겹치는 구간을 실수로 두 번
 * 드래그하면(예: 칠했는지 확신이 안 서서 다시 드래그) addHighlightSegments가 기존엔
 * 그냥 새 TextHighlight를 추가만 해서, 겹치는 두 개의 하이라이트가 그대로 쌓였다
 * (둘 다 완전히 같은 구간이면 평소엔 완벽히 겹쳐 안 보이다가, zoom/재측정 시점의
 * 아주 작은 서브픽셀 차이로 갑자기 "번져 보이는" 형태로 드러난다). 실제 형광펜을
 * 다시 칠하듯 "새로 칠한 색이 기존 색 위를 덮는다" 동작으로 만들어 애초에 겹치는
 * 데이터 자체가 남지 않게 한다 — 기존 하이라이트 중 새 구간과 겹치는 부분은
 * 트리밍/분할해서 들어내고, 새 구간 하나만 추가한다.
 */
export function paintOverHighlights(
  existing: TextHighlight[] | undefined,
  start: number,
  end: number,
  color: string,
): TextHighlight[] {
  if (end <= start) return existing ?? [];
  return [...trimHighlightsOutOfRange(existing, start, end), createHighlight(start, end, color)];
}

/**
 * 요구사항(형광펜 지우개): [start, end) 구간과 겹치는 하이라이트만 트리밍/삭제한다 —
 * paintOverHighlights와 겹치는 부분을 들어내는 로직은 같지만, 그 자리에 새
 * 하이라이트를 추가하지 않는다는 점만 다르다(지우개는 형광펜만 지울 뿐, 텍스트나
 * 다른 데이터는 전혀 건드리지 않는다).
 */
export function eraseHighlightsInRange(existing: TextHighlight[] | undefined, start: number, end: number): TextHighlight[] {
  if (end <= start) return existing ?? [];
  return trimHighlightsOutOfRange(existing, start, end);
}

/**
 * 버그 수정(새로고침 시 형광펜이 더 커 보임): paintOverHighlights를 도입하기 전에는
 * 겹치는 구간을 다시 드래그하면 그냥 쌓였다 — 완전히 같은 구간이면 평소엔 겹쳐
 * 안 보이다가, 서로 조금씩만 겹치는 경우 두 개의 반투명 알약이 겹친 자리가 색이
 * 진해지고 합쳐진 바깥쪽 전체가 "하나의 더 큰 하이라이트"처럼 보인다 — 새로
 * 저장되는 데이터는 paintOverHighlights/eraseHighlightsInRange가 겹침 자체를 막지만,
 * 그 수정 전에 이미 만들어져 저장된 파일에는 겹치는 하이라이트가 남아있을 수 있다.
 * 파일을 열 때마다(loadObjects) 이 함수로 한 번 정리해서, 오래된 파일도 다시 열면
 * 저절로 깨끗해지게 한다.
 *
 * existing을 배열 순서대로 "다시 칠하듯" 재생한다 — 나중 항목이 겹치는 자리를
 * 덮어써서(paintOverHighlights와 동일한 우선순위) 결정적으로 하나의 겹치지 않는
 * 집합이 된다. 단, id/color는 원본을 그대로 보존한다(paintOverHighlights처럼 매번
 * 새 id를 만들지 않는다 — 정리일 뿐 "새로 칠하는" 게 아니므로). 겹침이 전혀 없으면
 * 원본 배열 참조를 그대로 반환해서(불필요한 재생성 방지) 이미 깨끗한 파일을 열 때
 * 매번 쓸모없는 재렌더링/patch가 생기지 않는다.
 */
export function normalizeOverlappingHighlights(existing: TextHighlight[] | undefined): TextHighlight[] | undefined {
  if (!existing || existing.length <= 1) return existing;
  const sorted = [...existing].sort((a, b) => a.start - b.start || a.end - b.end);
  let hasOverlap = false;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) {
      hasOverlap = true;
      break;
    }
  }
  if (!hasOverlap) return existing;

  let result: TextHighlight[] = [];
  for (const h of existing) {
    result = [...trimHighlightsOutOfRange(result, h.start, h.end), h];
  }
  return result;
}

/**
 * 한 줄의 텍스트가 oldText → newText로 바뀔 때, 그 줄에 붙어있던 구간(하이라이트/주석)의
 * start/end 오프셋을 보정한다. 일반 타이핑, IME 조합 확정, 화살표 토큰 변환
 * (-> → →) 등 "텍스트 내용이 바뀌는 모든 경우"에 공통으로 적용된다.
 *
 * 알고리즘: 공통 prefix/suffix 길이를 구해 "실제로 바뀐 구간"만 특정하고,
 * - 바뀐 구간보다 앞에 있는 오프셋은 그대로 둔다.
 * - 바뀐 구간보다 뒤에 있는 오프셋은 길이 변화량(delta)만큼 이동시킨다.
 * - 바뀐 구간 내부에 걸쳐 있던 오프셋은 그 구간의 경계로 스냅한다
 *   (하이라이트/주석이 사라지지 않고 편집된 부분을 계속 덮도록 "확장"에 가깝게 동작).
 * - 결과적으로 start >= end가 되면(편집이 구간을 완전히 삼킨 경우) 그 항목은 버린다.
 *
 * 완벽한 형태소/의미 단위 추적은 아니지만, 별도 실행취소 시스템 없이도
 * "텍스트가 바뀌어도 어색하게 어긋나거나 크래시 나지 않는다"는 최소 요구사항을 충족한다.
 */
export function remapHighlightsForEdit<T extends Range>(
  ranges: T[] | undefined,
  oldText: string,
  newText: string,
): T[] | undefined {
  if (!ranges || ranges.length === 0) return ranges;
  if (oldText === newText) return ranges;

  const oldLen = oldText.length;
  const newLen = newText.length;

  let prefix = 0;
  const maxPrefix = Math.min(oldLen, newLen);
  while (prefix < maxPrefix && oldText[prefix] === newText[prefix]) prefix++;

  let suffix = 0;
  const maxSuffix = Math.min(oldLen, newLen) - prefix;
  while (suffix < maxSuffix && oldText[oldLen - 1 - suffix] === newText[newLen - 1 - suffix]) suffix++;

  const oldChangeEnd = oldLen - suffix; // 바뀐 구간의 old 기준 배타적 끝
  const newChangeEnd = newLen - suffix; // 바뀐 구간의 new 기준 배타적 끝
  const delta = newLen - oldLen;

  const remapOffset = (offset: number, isEnd: boolean): number => {
    if (offset <= prefix) return offset;
    if (offset >= oldChangeEnd) return offset + delta;
    // 바뀐 구간 내부: 시작쪽 오프셋은 prefix로, 끝쪽 오프셋은 newChangeEnd로 스냅
    return isEnd ? newChangeEnd : prefix;
  };

  const result: T[] = [];
  for (const r of ranges) {
    let newStart = remapOffset(r.start, false);
    let newEnd = remapOffset(r.end, true);
    newStart = Math.max(0, Math.min(newStart, newLen));
    newEnd = Math.max(0, Math.min(newEnd, newLen));
    if (newEnd - newStart >= 1) {
      result.push({ ...r, start: newStart, end: newEnd });
    }
  }
  return result;
}

/**
 * Enter로 줄이 split(offset k 기준)될 때, 원래 줄의 구간들을
 * "split 이전 줄에 남는 것"과 "새로 생기는 다음 줄로 옮겨갈 것"으로 나눈다.
 * split 지점을 가로지르는 항목은 두 조각으로 쪼갠다.
 */
export function splitHighlightsAtOffset<T extends Range>(
  ranges: T[] | undefined,
  k: number,
): { before: T[]; after: T[] } {
  const before: T[] = [];
  const after: T[] = [];
  for (const r of ranges ?? []) {
    if (r.end <= k) {
      before.push(r);
    } else if (r.start >= k) {
      after.push({ ...r, start: r.start - k, end: r.end - k });
    } else {
      before.push({ ...r, end: k });
      after.push({ ...r, id: createRangeId(), start: 0, end: r.end - k });
    }
  }
  return { before, after };
}

/**
 * Backspace로 두 줄이 병합될 때(prevText + currentText), current 줄에 있던
 * 구간들을 prevText.length만큼 오프셋을 밀어서 prev 줄의 목록에 합친다.
 */
export function mergeHighlightsForLineJoin<T extends Range>(
  prevRanges: T[] | undefined,
  currentRanges: T[] | undefined,
  prevTextLength: number,
): T[] {
  const shiftedCurrent = (currentRanges ?? []).map((r) => ({
    ...r,
    start: r.start + prevTextLength,
    end: r.end + prevTextLength,
  }));
  return [...(prevRanges ?? []), ...shiftedCurrent];
}
