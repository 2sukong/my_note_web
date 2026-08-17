/**
 * 요구사항 7번: ->, <-, =>, <= 를 유니코드 화살표로 자동 변환한다.
 * DOM에 의존하지 않는 순수 함수로 만들어 커서 위치 보정까지 함께 테스트할 수 있게 한다.
 */
const ARROW_TOKEN_MAP: Record<string, string> = {
  '->': '→',
  '<-': '←',
  '=>': '⇒',
  '<=': '⇐',
};

export interface ArrowConversionResult {
  text: string;
  cursorIndex: number;
  converted: boolean;
}

/**
 * cursorIndex 바로 앞의 두 글자가 화살표 토큰이면 유니코드 화살표 한 글자로 치환한다.
 * 매 keystroke 이후(가장 최근에 입력된 글자까지 반영된 상태에서) 호출하는 것을 전제로 한다.
 *
 * 2글자 → 1글자로 줄어들기 때문에 커서 위치도 함께 한 칸 당겨서 반환하며,
 * 호출부는 이 값을 그대로 Selection/Range에 반영하면 된다.
 */
export function convertArrowTokenAtCursor(text: string, cursorIndex: number): ArrowConversionResult {
  if (cursorIndex < 2 || cursorIndex > text.length) {
    return { text, cursorIndex, converted: false };
  }

  const token = text.slice(cursorIndex - 2, cursorIndex);
  const replacement = ARROW_TOKEN_MAP[token];
  if (!replacement) {
    return { text, cursorIndex, converted: false };
  }

  const nextText = text.slice(0, cursorIndex - 2) + replacement + text.slice(cursorIndex);
  return { text: nextText, cursorIndex: cursorIndex - 1, converted: true };
}
