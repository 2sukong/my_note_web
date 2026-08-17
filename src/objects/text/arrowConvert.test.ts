import { describe, expect, it } from 'vitest';
import { convertArrowTokenAtCursor } from './arrowConvert';

describe('convertArrowTokenAtCursor', () => {
  it('converts -> to →', () => {
    const result = convertArrowTokenAtCursor('A->B', 3); // "A->" 까지 커서
    expect(result.converted).toBe(true);
    expect(result.text).toBe('A→B');
    expect(result.cursorIndex).toBe(2);
  });

  it('converts <- to ←', () => {
    const result = convertArrowTokenAtCursor('A<-B', 3);
    expect(result.text).toBe('A←B');
  });

  it('converts => to ⇒', () => {
    const result = convertArrowTokenAtCursor('A=>B', 3);
    expect(result.text).toBe('A⇒B');
  });

  it('converts <= to ⇐', () => {
    const result = convertArrowTokenAtCursor('A<=B', 3);
    expect(result.text).toBe('A⇐B');
  });

  it('does nothing when the two preceding characters are not a token', () => {
    const result = convertArrowTokenAtCursor('AB', 2);
    expect(result.converted).toBe(false);
    expect(result.text).toBe('AB');
    expect(result.cursorIndex).toBe(2);
  });

  it('does nothing when cursor is at the very start', () => {
    const result = convertArrowTokenAtCursor('->', 0);
    expect(result.converted).toBe(false);
  });

  it('does not chain-convert an already-converted arrow character', () => {
    const first = convertArrowTokenAtCursor('A->B', 3);
    // 변환된 결과에 이어서 '>'를 추가로 입력해도 (예: "⇐>") 재변환되지 않아야 한다
    const withExtra = first.text.slice(0, first.cursorIndex) + '>' + first.text.slice(first.cursorIndex);
    const second = convertArrowTokenAtCursor(withExtra, first.cursorIndex + 1);
    expect(second.converted).toBe(false);
  });

  it('preserves text before and after the token', () => {
    const result = convertArrowTokenAtCursor('시작 -> 끝', 5);
    expect(result.text).toBe('시작 → 끝');
  });
});
