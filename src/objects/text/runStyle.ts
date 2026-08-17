import type { TextRun } from './indentation/types';

/** 스타일 비교/적용 대상 필드만 모은 타입 — text/highlight(레거시 미사용 필드)는 제외. */
export type RunStylePatch = Partial<Pick<TextRun, 'color' | 'fontSize' | 'fontFamily' | 'bold'>>;

/** 두 run이 텍스트를 제외하고 스타일까지 완전히 같은지(인접 run 병합 판단에 쓴다). */
export function sameRunStyle(a: TextRun, b: TextRun): boolean {
  return a.bold === b.bold && a.color === b.color && a.fontSize === b.fontSize && a.fontFamily === b.fontFamily;
}

/**
 * Phase 8(부분 서식): line.runs 중 flat 문자 오프셋 [start, end) 구간에 걸친 부분에만
 * patch를 적용한 새 runs 배열을 만든다. 구간 경계에서 run을 필요한 만큼만 쪼개고,
 * 구간 밖의 run은 손대지 않는다 — highlightModel.ts의 splitHighlightsAtOffset과 같은
 * "구간 겹침 계산" 원리를 텍스트 스타일에 적용한 버전이다.
 */
export function applyRunStyle(runs: TextRun[], start: number, end: number, patch: RunStylePatch): TextRun[] {
  if (end <= start) return runs;
  const result: TextRun[] = [];
  let pos = 0;
  for (const run of runs) {
    const runStart = pos;
    const runEnd = pos + run.text.length;
    pos = runEnd;

    if (runEnd <= start || runStart >= end || run.text.length === 0) {
      result.push(run);
      continue;
    }

    const overlapStart = Math.max(start, runStart);
    const overlapEnd = Math.min(end, runEnd);

    if (runStart < overlapStart) {
      result.push({ ...run, text: run.text.slice(0, overlapStart - runStart) });
    }
    result.push({ ...run, ...patch, text: run.text.slice(overlapStart - runStart, overlapEnd - runStart) });
    if (overlapEnd < runEnd) {
      result.push({ ...run, text: run.text.slice(overlapEnd - runStart) });
    }
  }
  return mergeAdjacentSameStyle(result);
}

/**
 * flat 오프셋 k에서 runs를 두 조각으로 나눈다(Enter로 줄이 갈라질 때). k가 run 중간이면
 * 그 run만 텍스트를 잘라 양쪽에 각각 원래 스타일 그대로 나눠 넣는다 — highlightModel.ts의
 * splitHighlightsAtOffset과 이름은 다르지만 같은 자리에서 쓰이는 짝 함수다.
 */
export function splitRunsAtOffset(runs: TextRun[], k: number): { before: TextRun[]; after: TextRun[] } {
  const before: TextRun[] = [];
  const after: TextRun[] = [];
  let pos = 0;
  for (const run of runs) {
    const runEnd = pos + run.text.length;
    if (runEnd <= k) {
      before.push(run);
    } else if (pos >= k) {
      after.push(run);
    } else {
      const cut = k - pos;
      before.push({ ...run, text: run.text.slice(0, cut) });
      after.push({ ...run, text: run.text.slice(cut) });
    }
    pos = runEnd;
  }
  return { before: before.filter((r) => r.text.length > 0), after: after.filter((r) => r.text.length > 0) };
}

/** Backspace로 두 줄이 합쳐질 때(prevText + currentText) runs를 이어붙인다. 경계의
 * 두 run이 스타일까지 같으면 하나로 합쳐 불필요한 span 증식을 막는다. */
export function joinRuns(a: TextRun[], b: TextRun[]): TextRun[] {
  return mergeAdjacentSameStyle([...a, ...b]);
}

function mergeAdjacentSameStyle(runs: TextRun[]): TextRun[] {
  const result: TextRun[] = [];
  for (const run of runs) {
    if (run.text.length === 0) continue;
    const last = result[result.length - 1];
    if (last && sameRunStyle(last, run)) {
      result[result.length - 1] = { ...last, text: last.text + run.text };
    } else {
      result.push(run);
    }
  }
  return result;
}

/**
 * flat 구간 [start, end) 안에서 대표로 삼을 현재 스타일값 — 그 구간과 처음 겹치는
 * run의 값을 그대로 돌려준다. PropertiesPanel이 "현재 값"을 보여줄 때 쓴다(구간이
 * 여러 스타일에 걸쳐 있어도 정확한 혼합 표시 대신 첫 run 값을 대표로 보여주는
 * 단순화 — 대부분의 리치 텍스트 에디터도 같은 방식을 쓴다).
 */
export function representativeRunStyle(runs: TextRun[], start: number, end: number): RunStylePatch {
  if (end <= start) return {};
  let pos = 0;
  for (const run of runs) {
    const runEnd = pos + run.text.length;
    if (runEnd > start && run.text.length > 0) {
      return { color: run.color, fontSize: run.fontSize, fontFamily: run.fontFamily, bold: run.bold };
    }
    pos = runEnd;
  }
  return {};
}
