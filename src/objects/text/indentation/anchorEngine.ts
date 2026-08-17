import type { BulletChar, IndentAnchor } from './types';

/** '-'/'·' 기호 전환 한 단계당 들여쓰는 픽셀 양 (zoom=1 기준 world 단위). */
export const BULLET_INDENT_UNIT = 24;

function createAnchorId(): string {
  return crypto.randomUUID();
}

/**
 * 줄 텍스트에서 ':' 다음, 공백을 건너뛴 위치의 문자 인덱스를 찾는다.
 * ':'가 없으면 null.
 */
export function findColonAlignmentPoint(text: string): { charIndex: number } | null {
  const colonIndex = text.indexOf(':');
  if (colonIndex === -1) return null;

  let i = colonIndex + 1;
  while (text[i] === ' ') i++;
  return { charIndex: i };
}

/** 줄의 맨 앞 글자가 '-' 또는 '·'인지 확인한다. */
export function detectLeadingBullet(text: string): BulletChar | null {
  const ch = text[0];
  return ch === '-' || ch === '·' ? ch : null;
}

/**
 * Enter를 눌렀을 때 새로 생기는 줄의 anchor를 계산한다.
 *
 * 규칙(요구사항 5번 A, F, G):
 * - 현재 줄에 ':'가 있으면, 그 다음 위치를 기준으로 한 새 anchor를 만든다. 최우선 규칙이며
 *   현재 줄이 동시에 '-'/'·'로 시작해도 이 규칙이 이긴다.
 * - ':'가 없으면 Enter 자체는 아무 것도 만들지 않는다 — 새 줄은 현재 줄의 anchor를 그대로 물려받는다.
 *   ('-'/'·' 들여쓰기는 이 함수가 아니라 실제로 그 글자가 입력되는 시점에 computeAnchorForNewBullet로 처리한다.
 *   Enter를 눌렀다는 사실만으로는 들여쓰기가 생기지 않아야 하기 때문이다.)
 *
 * ':' 뒤 위치의 실제 픽셀 값(colonOffsetPx)은 DOM 측정이 필요하므로 호출부에서 넘겨준다.
 * 아직 측정하지 못한 경우(colonOffsetPx가 undefined) 상속 동작으로 안전하게 fallback한다.
 */
export function computeEnterAnchor(
  currentLineText: string,
  currentAnchor: IndentAnchor,
  colonOffsetPx?: number,
): IndentAnchor {
  const colonPoint = findColonAlignmentPoint(currentLineText);
  if (colonPoint && colonOffsetPx !== undefined) {
    return {
      id: createAnchorId(),
      offsetPx: colonOffsetPx,
      sourceType: 'colon',
      parent: currentAnchor,
    };
  }
  return currentAnchor;
}

/**
 * 새 줄에 "첫 글자"로 '-' 또는 '·'가 입력된 바로 그 순간에 호출한다.
 * (호출부 책임: 그 줄이 비어 있다가 지금 막 이 글자가 입력됐을 때만 호출할 것.
 *  이미 내용이 있는 줄 중간에 '-'를 입력하는 경우는 여기 해당하지 않는다.)
 *
 * 우선순위(요구사항 10번 — 가장 중요한 변경 지점):
 * 1순위. currentLineAnchor 자체 — Enter가 만든 최초 위치가 그 후 Backspace로 몇 번
 *        이동했든, 그 결과 실제로 남은(=이 함수가 호출되는 시점의) 위치다.
 *        computeEnterAnchor(상속)와 computeBackspaceAnchor(상위 이동)가 매 호출마다
 *        해당 줄의 anchor를 직접 갱신해두기 때문에, currentLineAnchor는 "몇 번
 *        Backspace했는지"를 별도로 세지 않아도 이미 그 결과가 반영된 최종 위치다.
 * 2순위. currentLineAnchor가 이미 bullet 계열이고 그 bulletChar가 지금 입력한
 *        기호와 같다면(=이 위치가 바로 그 기호의 column), 새로 anchor를 만들지 않고
 *        그대로 재사용한다 — 같은 기호는 항상 같은 column(요구사항 1번).
 *        다르다면(=Backspace로 다른 기호의 column까지 올라온 상태) 그 위치를 기준으로
 *        한 단계만 더 들여쓴 새 anchor를 만든다 — 직전 줄이 아니라 "지금 이 currentLineAnchor"가
 *        기준이라는 점이 이번 수정의 핵심이다(요구사항 3, 4번).
 * 3순위. currentLineAnchor 자신이 아직 아무 기호도 확립하지 않은 상태(root 등 —
 *        Backspace로 다른 기호 계층까지 올라온 게 아니라, 애초에 이 줄이 그 상태로
 *        시작한 경우)라면, 기존에 구현되어 있던 대로 직전 줄의 기호 계층을 기준 삼는다
 *        (요구사항 2번 — '·'/'-' 전환 시 계층 규칙은 그대로 유지).
 *
 * 이 줄의 anchor가 이미 ':' 기반이면(=Enter 시점에 콜론 정렬이 적용된 줄) bullet 전환
 * 로직을 아예 적용하지 않고 그대로 둔다. ':' 정렬이 '-'/'·'보다 우선하기 때문이며,
 * ':' 자체는 어떤 경우에도 anchor 계산에 관여하지 않는다(요구사항 7~9번).
 *
 * 요구사항(글자 크기별 들여쓰기): 한 단계당 들여쓰는 픽셀 양은 고정값(BULLET_INDENT_UNIT)이
 * 아니라 호출부가 넘기는 indentUnit을 쓴다 — 글자 크기가 크면 그만큼 넓게, 작으면
 * 좁게 들여써야 자연스럽고, 커스텀 폰트는 같은 font-size라도 실제 렌더링 크기(굵기/
 * 자간)가 달라 그 폰트의 실측 배율까지 반영해야 하기 때문이다. anchorEngine.ts는
 * DOM/Canvas 측정 없이 순수 함수로 테스트 가능하게 유지해야 하므로, 그 측정 자체는
 * 호출부(TextObjectView.tsx, fontMetrics.ts의 fontHeightScaleFor)가 맡고 여기서는
 * 계산된 최종 픽셀 값(indentUnit)만 받는다. 넘기지 않으면 BULLET_INDENT_UNIT(24)을
 * 그대로 쓴다(하위 호환 — 이 함수를 쓰는 다른 테스트/호출부에 영향 없음).
 */
export function computeAnchorForNewBullet(
  typedChar: BulletChar,
  currentLineAnchor: IndentAnchor,
  previousLineText: string,
  previousLineAnchor: IndentAnchor,
  indentUnit: number = BULLET_INDENT_UNIT,
): IndentAnchor {
  if (currentLineAnchor.sourceType === 'colon') {
    return currentLineAnchor;
  }

  // 1/2순위: Backspace로 실제 이동한 현재 anchor가 이미 bullet 계열이라면, 직전 줄이
  // 아니라 이 currentLineAnchor 자체를 기준으로 판단한다.
  if (currentLineAnchor.sourceType === 'bullet') {
    if (currentLineAnchor.bulletChar === typedChar) {
      return currentLineAnchor;
    }
    return {
      id: createAnchorId(),
      offsetPx: currentLineAnchor.offsetPx + indentUnit,
      sourceType: 'bullet',
      bulletChar: typedChar,
      parent: currentLineAnchor,
    };
  }

  // 3순위: currentLineAnchor가 아직 기호를 확립하지 않은 상태(root 등)일 때만 직전 줄
  // 기준의 기존 계층 규칙으로 fallback한다(Backspace로 이 위치까지 온 게 아니라, 이 줄이
  // 원래부터 이 상태였던 경우 — 예: 문서의 첫 bullet).
  const previousBullet = detectLeadingBullet(previousLineText);

  if (previousBullet === typedChar) {
    return previousLineAnchor;
  }

  return {
    id: createAnchorId(),
    offsetPx: previousLineAnchor.offsetPx + indentUnit,
    sourceType: 'bullet',
    bulletChar: typedChar,
    parent: previousLineAnchor,
  };
}

/**
 * 문서의 첫 번째 줄(비교할 "이전 줄"이 없는 유일한 줄)에서 처음으로 '-' 또는 '·'가
 * 입력된 순간 호출한다.
 *
 * 첫 줄은 root보다 더 위 레벨이 없으므로 offsetPx는 그대로 두되(들여쓰지 않음), anchor
 * 자체는 root(sourceType 'root')로 남겨두지 않고 이 기호로 확립한 'bullet' anchor로
 * 바꿔야 한다. 그렇지 않으면 이 줄 아래에서 만들어진 하위 anchor들이 Backspace로
 * 이 위치(root)까지 되돌아왔을 때, computeAnchorForNewBullet의 1순위(같은 기호면
 * 재사용) 검사가 sourceType 'root'라서 매치되지 못하고, 3순위(직전 물리적 줄 기준)
 * fallback으로 빠져 엉뚱하게 더 들여써지는 버그가 생긴다.
 *
 * 이미 'bullet'로 확립돼 있다면(예: 기호를 지웠다가 같은 자리에 다시 쳤을 때) 그대로 둔다.
 */
export function computeAnchorForFirstLineBullet(
  typedChar: BulletChar,
  currentLineAnchor: IndentAnchor,
): IndentAnchor {
  if (currentLineAnchor.sourceType === 'bullet') {
    return currentLineAnchor;
  }
  return {
    id: createAnchorId(),
    offsetPx: currentLineAnchor.offsetPx,
    sourceType: 'bullet',
    bulletChar: typedChar,
    parent: currentLineAnchor,
  };
}

/**
 * Backspace가 줄의 맨 앞(anchor 위치, 지울 문자가 없는 지점)에서 눌렸을 때 호출한다.
 * 상위 anchor로 이동시킨다.
 *
 * 이미 root(parent === null)라면 null을 반환하며, 이 경우 호출부는 "일반적인 backspace"
 * (커서를 윗 줄 끝으로 옮기고 두 줄을 병합)로 처리해야 한다.
 *
 * 같은 anchor를 여러 줄이 공유하는 경우에도(예: '-' 반복), 그 anchor 자체가 하나의 단계이므로
 * 반복 횟수와 무관하게 한 번에 상위 anchor로 이동한다(요구사항 5번 H).
 */
export function computeBackspaceAnchor(currentAnchor: IndentAnchor): IndentAnchor | null {
  return currentAnchor.parent;
}
