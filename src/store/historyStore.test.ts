import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useObjectsStore } from './objectsStore';
import { useHistoryStore } from './historyStore';
import type { TextObject } from '../types/object';

function makeText(id: string, x: number, y: number): TextObject {
  const t = Date.now();
  return {
    id,
    type: 'text',
    x,
    y,
    width: 100,
    height: 40,
    rotation: 0,
    zIndex: 1,
    createdAt: t,
    updatedAt: t,
    lines: [],
    baseFontSize: 16,
    color: '#000',
  };
}

/** 매 테스트 전에 objectsStore/historyStore를 빈 상태로 리셋한다 —
 * objectsStore는 모듈 로드 시 시드 데이터로 초기화되므로 그대로 두면 테스트가
 * 서로 간섭한다. */
beforeEach(() => {
  useObjectsStore.setState({ objects: {} });
  useHistoryStore.setState({ past: [], future: [], activeTransaction: null });
});

describe('historyStore', () => {
  it('addObject/removeObject는 각각 별도 undo 단계를 만든다', () => {
    useObjectsStore.getState().addObject(makeText('a', 0, 0));
    useObjectsStore.getState().addObject(makeText('b', 10, 10));
    expect(useHistoryStore.getState().past.length).toBe(2);
    expect(Object.keys(useObjectsStore.getState().objects).sort()).toEqual(['a', 'b']);

    useHistoryStore.getState().undo();
    expect(Object.keys(useObjectsStore.getState().objects)).toEqual(['a']);

    useHistoryStore.getState().undo();
    expect(Object.keys(useObjectsStore.getState().objects)).toEqual([]);

    useHistoryStore.getState().redo();
    expect(Object.keys(useObjectsStore.getState().objects)).toEqual(['a']);
    useHistoryStore.getState().redo();
    expect(Object.keys(useObjectsStore.getState().objects).sort()).toEqual(['a', 'b']);
  });

  it('새 변경이 일어나면 redo(future) 스택이 비워진다', () => {
    useObjectsStore.getState().addObject(makeText('a', 0, 0));
    useObjectsStore.getState().addObject(makeText('b', 0, 0));
    useHistoryStore.getState().undo();
    expect(useHistoryStore.getState().future.length).toBe(1);

    useObjectsStore.getState().addObject(makeText('c', 0, 0));
    expect(useHistoryStore.getState().future.length).toBe(0);
  });

  it('같은 coalesceKey로 800ms 안에 연속으로 바뀌면 undo 한 단계로 합쳐진다 (연속 타이핑 시뮬레이션)', () => {
    vi.useFakeTimers();
    try {
      useObjectsStore.getState().addObject(makeText('a', 0, 0));
      expect(useHistoryStore.getState().past.length).toBe(1);

      useObjectsStore.getState().setTextLines('a', [{ id: 'l1' } as never]);
      expect(useHistoryStore.getState().past.length).toBe(2);

      // 짧은 간격(<800ms) 안에 같은 객체를 또 타이핑하면 직전 단계에 합쳐진다.
      vi.advanceTimersByTime(100);
      useObjectsStore.getState().setTextLines('a', [{ id: 'l1' } as never, { id: 'l2' } as never]);
      expect(useHistoryStore.getState().past.length).toBe(2);

      // 충분히 시간이 지난 뒤 또 타이핑하면 새 undo 단계가 돼야 한다(멈췄다가 다시 침).
      vi.advanceTimersByTime(1000);
      useObjectsStore.getState().setTextLines('a', [{ id: 'l1' } as never]);
      expect(useHistoryStore.getState().past.length).toBe(3);

      // 합쳐진 단계를 한 번에 undo하면 첫 setTextLines 이전(빈 lines)으로 바로 돌아간다.
      useHistoryStore.getState().undo();
      useHistoryStore.getState().undo();
      expect((useObjectsStore.getState().objects.a as TextObject).lines).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('beginTransaction/endTransaction으로 감싼 여러 변경은 undo 한 번에 전부 되돌아간다(드래그 시뮬레이션)', () => {
    useObjectsStore.getState().addObject(makeText('a', 0, 0));
    useObjectsStore.getState().addObject(makeText('b', 100, 100));
    const beforeDrag = useHistoryStore.getState().past.length;

    useHistoryStore.getState().beginTransaction('drag');
    useObjectsStore.getState().moveObjectTo('a', 5, 5);
    useObjectsStore.getState().moveObjectTo('a', 12, 12);
    useObjectsStore.getState().moveObjectTo('b', 105, 105);
    useHistoryStore.getState().endTransaction();

    expect(useHistoryStore.getState().past.length).toBe(beforeDrag + 1); // 세 번의 move가 한 단계로

    useHistoryStore.getState().undo();
    expect(useObjectsStore.getState().objects.a.x).toBe(0);
    expect(useObjectsStore.getState().objects.a.y).toBe(0);
    expect(useObjectsStore.getState().objects.b.x).toBe(100);
  });

  it('아무 변화 없이 endTransaction하면(클릭만) undo 단계를 추가하지 않는다', () => {
    useObjectsStore.getState().addObject(makeText('a', 0, 0));
    const before = useHistoryStore.getState().past.length;

    useHistoryStore.getState().beginTransaction('resize');
    useHistoryStore.getState().endTransaction();

    expect(useHistoryStore.getState().past.length).toBe(before);
  });

  it('removeObjects(다중 삭제)는 undo 한 단계로 여러 객체를 한 번에 복원한다', () => {
    useObjectsStore.getState().addObject(makeText('a', 0, 0));
    useObjectsStore.getState().addObject(makeText('b', 0, 0));
    useObjectsStore.getState().addObject(makeText('c', 0, 0));
    const before = useHistoryStore.getState().past.length;

    useObjectsStore.getState().removeObjects(['a', 'b']);
    expect(useHistoryStore.getState().past.length).toBe(before + 1);
    expect(Object.keys(useObjectsStore.getState().objects)).toEqual(['c']);

    useHistoryStore.getState().undo();
    expect(Object.keys(useObjectsStore.getState().objects).sort()).toEqual(['a', 'b', 'c']);
  });
});
