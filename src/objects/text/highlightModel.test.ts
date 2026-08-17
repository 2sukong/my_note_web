import { describe, expect, it } from 'vitest';
import { mergeHighlightsForLineJoin, remapHighlightsForEdit, splitHighlightsAtOffset } from './highlightModel';
import type { TextHighlight } from './indentation/types';

function h(start: number, end: number, id = 'h1'): TextHighlight {
  return { id, start, end, color: 'yellow' };
}

describe('remapHighlightsForEdit', () => {
  // '히로뽕은 각성제'에서 "각성제"는 인덱스 [5, 8) 구간이다.
  const BASE = '히로뽕은 각성제';

  it('타이핑으로 하이라이트 뒤에 글자가 추가되면 하이라이트는 그대로 유지된다', () => {
    const result = remapHighlightsForEdit([h(5, 8)], BASE, BASE + '다');
    expect(result).toEqual([h(5, 8)]);
  });

  it('하이라이트보다 앞에서 글자가 추가되면 오프셋이 그만큼 밀린다', () => {
    // '히로뽕은' 다음에 '요'를 삽입 → "각성제" 시작 위치가 한 칸 뒤로 밀려야 한다.
    const result = remapHighlightsForEdit([h(5, 8)], BASE, '히로뽕은요 각성제');
    expect(result).toEqual([h(6, 9)]);
  });

  it('하이라이트 영역이 삭제되면 하이라이트가 사라진다', () => {
    const result = remapHighlightsForEdit([h(5, 8)], BASE, '히로뽕은 ');
    expect(result).toEqual([]);
  });

  it('길이가 같은 텍스트로 완전히 바뀌면 리맵하지 않아도 안전하게 처리된다', () => {
    const result = remapHighlightsForEdit([h(0, 3)], 'abc', 'abc');
    expect(result).toEqual([h(0, 3)]);
  });

  it('하이라이트가 없으면 그대로 undefined/빈 배열을 반환한다', () => {
    expect(remapHighlightsForEdit(undefined, 'a', 'ab')).toBeUndefined();
    expect(remapHighlightsForEdit([], 'a', 'ab')).toEqual([]);
  });
});

describe('splitHighlightsAtOffset', () => {
  it('split 지점 이전의 하이라이트는 before에 남는다', () => {
    const { before, after } = splitHighlightsAtOffset([h(0, 3)], 5);
    expect(before).toEqual([h(0, 3)]);
    expect(after).toEqual([]);
  });

  it('split 지점 이후의 하이라이트는 after로 옮겨지고 오프셋이 보정된다', () => {
    const { before, after } = splitHighlightsAtOffset([h(6, 9)], 5);
    expect(before).toEqual([]);
    expect(after).toEqual([h(1, 4)]);
  });

  it('split 지점을 가로지르는 하이라이트는 두 조각으로 나뉜다', () => {
    const { before, after } = splitHighlightsAtOffset([h(3, 8)], 5);
    expect(before).toEqual([h(3, 5)]);
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ start: 0, end: 3 });
  });
});

describe('mergeHighlightsForLineJoin', () => {
  it('current 줄의 하이라이트는 prevText 길이만큼 밀려서 합쳐진다', () => {
    const merged = mergeHighlightsForLineJoin([h(0, 2, 'prev')], [h(0, 3, 'cur')], 5);
    expect(merged).toEqual([h(0, 2, 'prev'), h(5, 8, 'cur')]);
  });

  it('둘 다 없으면 빈 배열', () => {
    expect(mergeHighlightsForLineJoin(undefined, undefined, 3)).toEqual([]);
  });
});
