import { describe, expect, it } from 'vitest';
import { isDescendantOrSelf, collectFileSubtreeIds, findFirstPageId, cloneObjectsWithNewIds } from './fileTreeLogic';
import type { FileRecord } from './db';
import type { ArrowObject, FrameObject, TextObject } from '../types/object';
import { createPlainLine } from '../objects/text/indentation/types';

function makeFile(overrides: Partial<FileRecord> & { id: string }): FileRecord {
  return {
    name: overrides.id,
    parentId: null,
    childFileIds: [],
    pageIds: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('isDescendantOrSelf', () => {
  // A -> B -> C (트리 형태), D는 별개 루트
  const files: Record<string, FileRecord> = {
    A: makeFile({ id: 'A', childFileIds: ['B'] }),
    B: makeFile({ id: 'B', parentId: 'A', childFileIds: ['C'] }),
    C: makeFile({ id: 'C', parentId: 'B' }),
    D: makeFile({ id: 'D' }),
  };

  it('자기 자신은 항상 참', () => {
    expect(isDescendantOrSelf(files, 'A', 'A')).toBe(true);
  });

  it('직계 하위 File을 찾는다', () => {
    expect(isDescendantOrSelf(files, 'A', 'B')).toBe(true);
  });

  it('여러 단계 아래의 하위 File도 찾는다', () => {
    expect(isDescendantOrSelf(files, 'A', 'C')).toBe(true);
  });

  it('하위 트리에 없는 File은 false', () => {
    expect(isDescendantOrSelf(files, 'A', 'D')).toBe(false);
  });

  it('반대 방향(자식이 조상인지)은 false — moveFile 순환 참조 방지의 핵심 케이스', () => {
    // B를 A 아래에서 D 아래로 옮기는 건 되지만, A를 C(자신의 손자) 아래로 옮기려는
    // 시도는 순환이 생기므로 막아야 한다: isDescendantOrSelf(files, 'A', 'C')는 true라서
    // moveFile('A', 'C')를 막는 데 쓰인다. 반대로 C를 A 밑으로 옮기는 건 순환이 아니다.
    expect(isDescendantOrSelf(files, 'C', 'A')).toBe(false);
  });
});

describe('collectFileSubtreeIds', () => {
  const files: Record<string, FileRecord> = {
    A: makeFile({ id: 'A', childFileIds: ['B', 'C'] }),
    B: makeFile({ id: 'B', parentId: 'A' }),
    C: makeFile({ id: 'C', parentId: 'A', childFileIds: ['D'] }),
    D: makeFile({ id: 'D', parentId: 'C' }),
  };

  it('자기 자신 + 모든 하위 File id를 모은다', () => {
    const ids = collectFileSubtreeIds(files, 'A');
    expect(new Set(ids)).toEqual(new Set(['A', 'B', 'C', 'D']));
  });

  it('리프 File은 자기 자신만 포함한다', () => {
    expect(collectFileSubtreeIds(files, 'B')).toEqual(['B']);
  });
});

describe('findFirstPageId', () => {
  it('루트 File의 pageIds를 먼저 본다', () => {
    const files: Record<string, FileRecord> = {
      A: makeFile({ id: 'A', pageIds: ['p1', 'p2'] }),
    };
    expect(findFirstPageId(['A'], files)).toBe('p1');
  });

  it('pageIds가 없으면 하위 File로 내려가서 찾는다', () => {
    const files: Record<string, FileRecord> = {
      A: makeFile({ id: 'A', childFileIds: ['B'] }),
      B: makeFile({ id: 'B', parentId: 'A', pageIds: ['p1'] }),
    };
    expect(findFirstPageId(['A'], files)).toBe('p1');
  });

  it('Page가 어디에도 없으면 null', () => {
    const files: Record<string, FileRecord> = {
      A: makeFile({ id: 'A', childFileIds: ['B'] }),
      B: makeFile({ id: 'B', parentId: 'A' }),
    };
    expect(findFirstPageId(['A'], files)).toBeNull();
  });
});

describe('cloneObjectsWithNewIds', () => {
  it('최상위 id를 전부 새로 발급하고 원본과 겹치지 않는다', () => {
    const t: TextObject = {
      id: 'text-1',
      type: 'text',
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      rotation: 0,
      zIndex: 1,
      createdAt: 0,
      updatedAt: 0,
      lines: [createPlainLine('hello')],
      baseFontSize: 16,
      color: '#000',
    };
    const cloned = cloneObjectsWithNewIds([t]);
    expect(cloned).toHaveLength(1);
    expect(cloned[0].id).not.toBe('text-1');
  });

  it('frameId 참조를 새 Frame id로 함께 재매핑한다', () => {
    const frame: FrameObject = {
      id: 'frame-1',
      type: 'frame',
      x: 0,
      y: 0,
      width: 400,
      height: 300,
      rotation: 0,
      zIndex: -1,
      createdAt: 0,
      updatedAt: 0,
    };
    const arrow: ArrowObject = {
      id: 'arrow-1',
      type: 'arrow',
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      rotation: 0,
      zIndex: 2,
      createdAt: 0,
      updatedAt: 0,
      strokeColor: '#000',
      strokeWidth: 2,
      frameId: 'frame-1',
    };

    const [clonedFrame, clonedArrow] = cloneObjectsWithNewIds([frame, arrow]);
    expect(clonedFrame.id).not.toBe('frame-1');
    expect((clonedArrow as ArrowObject).frameId).toBe(clonedFrame.id);
    expect((clonedArrow as ArrowObject).frameId).not.toBe('frame-1');
  });

  it('frameId가 없는 객체는 그대로 null/undefined를 유지한다', () => {
    const arrow: ArrowObject = {
      id: 'arrow-1',
      type: 'arrow',
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      rotation: 0,
      zIndex: 2,
      createdAt: 0,
      updatedAt: 0,
      strokeColor: '#000',
      strokeWidth: 2,
      frameId: null,
    };
    const [cloned] = cloneObjectsWithNewIds([arrow]);
    expect((cloned as ArrowObject).frameId).toBeNull();
  });
});
