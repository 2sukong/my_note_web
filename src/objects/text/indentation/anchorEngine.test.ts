import { describe, expect, it } from 'vitest';
import {
  BULLET_INDENT_UNIT,
  computeAnchorForFirstLineBullet,
  computeAnchorForNewBullet,
  computeBackspaceAnchor,
  computeEnterAnchor,
  detectLeadingBullet,
  findColonAlignmentPoint,
} from './anchorEngine';
import { ROOT_ANCHOR } from './types';
import type { IndentAnchor } from './types';

describe('findColonAlignmentPoint', () => {
  it('returns null when there is no colon', () => {
    expect(findColonAlignmentPoint('오늘 배운 내용은 리눅스의 프로세스이다.')).toBeNull();
  });

  it('finds the index right after the colon and following spaces', () => {
    const text = '-필로폰 : 각성제 ex) 히로뽕, 메스암페타민';
    const point = findColonAlignmentPoint(text);
    expect(point).not.toBeNull();
    expect(text[point!.charIndex]).toBe('각');
  });

  it('skips multiple spaces after the colon', () => {
    const text = 'A:   B';
    const point = findColonAlignmentPoint(text);
    expect(text[point!.charIndex]).toBe('B');
  });

  it('handles a colon with nothing after it', () => {
    const text = 'A:';
    const point = findColonAlignmentPoint(text);
    expect(point!.charIndex).toBe(text.length);
  });
});

describe('detectLeadingBullet', () => {
  it('detects a leading dash', () => {
    expect(detectLeadingBullet('- 첫 번째 내용')).toBe('-');
  });

  it('detects a leading middle dot', () => {
    expect(detectLeadingBullet('· 첫 번째 내용')).toBe('·');
  });

  it('returns null for plain text', () => {
    expect(detectLeadingBullet('그냥 문장')).toBeNull();
  });

  it('returns null for empty text', () => {
    expect(detectLeadingBullet('')).toBeNull();
  });
});

describe('computeEnterAnchor — 규칙 A: 콜론도 불릿도 없는 일반 문장', () => {
  it('그대로 현재 anchor를 물려받는다 (Enter 자체는 들여쓰기를 만들지 않음)', () => {
    const current = ROOT_ANCHOR;
    const next = computeEnterAnchor('오늘 배운 내용은 리눅스의 프로세스이다.', current);
    expect(next).toBe(current);
  });
});

describe('computeEnterAnchor — 규칙 F/G: 콜론 기반 정렬 (필로폰 예시)', () => {
  it('콜론 다음 위치를 기준으로 새 anchor를 만든다', () => {
    const current = ROOT_ANCHOR;
    const line = '-필로폰 : 각성제 ex) 히로뽕, 메스암페타민';
    const measuredPx = 132; // DOM 측정값이라 가정
    const next = computeEnterAnchor(line, current, measuredPx);

    expect(next.sourceType).toBe('colon');
    expect(next.offsetPx).toBe(measuredPx);
    expect(next.parent).toBe(current);
    expect(next).not.toBe(current);
  });

  it('현재 줄이 동시에 불릿(-)으로 시작해도 콜론 규칙이 우선한다', () => {
    // "-필로폰 : ..." 처럼 '-'와 ':'가 공존해도 콜론 기반 anchor가 만들어져야 한다.
    const current = ROOT_ANCHOR;
    const next = computeEnterAnchor('-필로폰 : 각성제', current, 100);
    expect(next.sourceType).toBe('colon');
  });

  it('아직 픽셀 측정값이 없으면 안전하게 상속으로 fallback한다', () => {
    const current = ROOT_ANCHOR;
    const next = computeEnterAnchor('필로폰 : 각성제', current, undefined);
    expect(next).toBe(current);
  });
});

describe('computeAnchorForNewBullet — 규칙 C/E: · → - 전환', () => {
  it('· 다음 최초로 -가 나타나는 순간 한 단계 들여쓴다', () => {
    // · A
    const anchorForA = ROOT_ANCHOR; // 'A' 자신은 root 그대로 사용
    // Enter 후 빈 줄이 현재 anchor(anchorForA)를 상속받은 상태에서 '-'를 첫 글자로 입력
    const next = computeAnchorForNewBullet('-', anchorForA, '· A', anchorForA);

    expect(next.sourceType).toBe('bullet');
    expect(next.bulletChar).toBe('-');
    expect(next.offsetPx).toBe(anchorForA.offsetPx + BULLET_INDENT_UNIT);
    expect(next.parent).toBe(anchorForA);
  });

  it('같은 기호(-)가 반복되면 새 anchor를 만들지 않고 재사용한다', () => {
    const anchorForA = ROOT_ANCHOR;
    const anchorForB = computeAnchorForNewBullet('-', anchorForA, '· A', anchorForA); // · A -> - B

    // - B 다음, 새 줄에서 '-'를 입력해 - C를 만드는 상황
    const anchorForC = computeAnchorForNewBullet('-', anchorForB, '- B', anchorForB);
    expect(anchorForC).toBe(anchorForB); // 새 anchor 생성 안 됨, 동일 참조

    // - C 다음, - D도 동일
    const anchorForD = computeAnchorForNewBullet('-', anchorForC, '- C', anchorForC);
    expect(anchorForD).toBe(anchorForB);
  });

  it('전체 시퀀스 · A / - B / - C / - D 는 B/C/D가 모두 같은 anchor를 공유한다', () => {
    const anchorA = ROOT_ANCHOR;
    const anchorB = computeAnchorForNewBullet('-', anchorA, '· A', anchorA);
    const anchorC = computeAnchorForNewBullet('-', anchorB, '- B', anchorB);
    const anchorD = computeAnchorForNewBullet('-', anchorC, '- C', anchorC);

    expect(anchorB.id).toBe(anchorC.id);
    expect(anchorC.id).toBe(anchorD.id);
    expect(anchorB.parent).toBe(anchorA);
  });
});

describe('computeAnchorForNewBullet — 규칙 D/E: - → · 전환 (반대 방향도 동일)', () => {
  it('- 다음 최초로 ·가 나타나는 순간 한 단계 들여쓴다', () => {
    const anchorForA = ROOT_ANCHOR; // - A
    const anchorForB = computeAnchorForNewBullet('·', anchorForA, '- A', anchorForA);

    expect(anchorForB.sourceType).toBe('bullet');
    expect(anchorForB.bulletChar).toBe('·');
    expect(anchorForB.parent).toBe(anchorForA);
  });

  it('전체 시퀀스 - A / · B / · C / · D 는 B/C/D가 모두 같은 anchor를 공유한다', () => {
    const anchorA = ROOT_ANCHOR;
    const anchorB = computeAnchorForNewBullet('·', anchorA, '- A', anchorA);
    const anchorC = computeAnchorForNewBullet('·', anchorB, '· B', anchorB);
    const anchorD = computeAnchorForNewBullet('·', anchorC, '· C', anchorC);

    expect(anchorB.id).toBe(anchorC.id);
    expect(anchorC.id).toBe(anchorD.id);
  });
});

describe('computeAnchorForNewBullet — 규칙 E: 같은 기호가 계속 반복되면 들여쓰지 않는다', () => {
  it('- A / - B / - C / - D 는 모두 같은 열(anchor)에 위치한다', () => {
    const anchorA = ROOT_ANCHOR;
    const anchorB = computeAnchorForNewBullet('-', anchorA, '- A', anchorA);
    expect(anchorB).toBe(anchorA); // 같은 기호 → 새 anchor 없음

    const anchorC = computeAnchorForNewBullet('-', anchorB, '- B', anchorB);
    expect(anchorC).toBe(anchorA);

    const anchorD = computeAnchorForNewBullet('-', anchorC, '- C', anchorC);
    expect(anchorD).toBe(anchorA);
  });
});

describe('computeAnchorForNewBullet — 규칙 F/G/6: 콜론 정렬이 불릿 전환보다 우선한다', () => {
  it('현재 줄의 anchor가 이미 colon 기반이면 bullet 전환을 적용하지 않는다', () => {
    const parent = ROOT_ANCHOR;
    const colonAnchor: IndentAnchor = {
      id: 'colon-1',
      offsetPx: 200,
      sourceType: 'colon',
      parent,
    };

    const next = computeAnchorForNewBullet('-', colonAnchor, '· 필로폰 : 각성제', parent);
    expect(next).toBe(colonAnchor); // 그대로 유지, bullet anchor로 바뀌지 않음
  });
});

describe('computeBackspaceAnchor — 규칙 H: 상위 계층으로 한 번에 이동', () => {
  it('root에서는 null을 반환한다 (일반 backspace로 처리해야 함을 의미)', () => {
    expect(computeBackspaceAnchor(ROOT_ANCHOR)).toBeNull();
  });

  it('부모 anchor로 이동한다', () => {
    const root = ROOT_ANCHOR;
    const child: IndentAnchor = { id: 'c1', offsetPx: 24, sourceType: 'bullet', bulletChar: '-', parent: root };
    expect(computeBackspaceAnchor(child)).toBe(root);
  });

  it('· A / - B / - C / - D 에서 D(=C=B와 동일 anchor)의 Backspace는 반복 횟수와 무관하게 한 번에 A(root)로 이동한다', () => {
    const anchorA = ROOT_ANCHOR;
    const anchorB = computeAnchorForNewBullet('-', anchorA, '· A', anchorA);
    const anchorC = computeAnchorForNewBullet('-', anchorB, '- B', anchorB);
    const anchorD = computeAnchorForNewBullet('-', anchorC, '- C', anchorC);

    expect(computeBackspaceAnchor(anchorD)).toBe(anchorA);
  });
});

describe('통합 시나리오: 필로폰 예시 전체', () => {
  it('콜론 정렬 후 다음 줄에서 다시 Backspace하면 원래 줄(-필로폰) 위치로 돌아간다', () => {
    const root = ROOT_ANCHOR;
    // "-필로폰 : 각성제 ex) 히로뽕, 메스암페타민" 에서 Enter
    const colonAnchor = computeEnterAnchor('-필로폰 : 각성제 ex) 히로뽕, 메스암페타민', root, 132);
    expect(colonAnchor.sourceType).toBe('colon');

    // "물, 알코올에 쉽게 녹음" 줄은 colonAnchor를 사용 (Enter가 만든 anchor를 그대로 사용, 별도 트리거 없음)
    // Backspace를 누르면 root로 돌아간다
    expect(computeBackspaceAnchor(colonAnchor)).toBe(root);
  });
});

describe('computeAnchorForNewBullet — Backspace로 이동한 현재 anchor를 우선한다 (요구사항 3/4/10)', () => {
  it('Enter 후 Backspace로 상위 기호(·) column까지 올라온 상태에서 -를 입력하면, 직전 줄(피아워십)의 anchor가 아니라 지금 올라온 위치(·)를 기준으로 삼는다', () => {
    // · 영원히  (anchorDot: bullet '·', root의 자식)
    const anchorDot = computeAnchorForNewBullet('·', ROOT_ANCHOR, '', ROOT_ANCHOR);
    // 뒤이어 반복되는 '·' 줄들은 모두 anchorDot을 재사용(요구사항 1)
    expect(computeAnchorForNewBullet('·', anchorDot, '· 앞줄', anchorDot)).toBe(anchorDot);

    //     - 피아워십  (anchorDash: bullet '-', anchorDot의 자식 — 마커 전환은 기존 계층 규칙 그대로)
    const anchorDash = computeAnchorForNewBullet('-', anchorDot, '· 영원히', anchorDot);
    expect(anchorDash.parent).toBe(anchorDot);
    expect(anchorDash.bulletChar).toBe('-');

    // "피아워십" 줄에서 Enter → 새 줄은 anchorDash를 그대로 상속(콜론 없음, Backspace 0번 상태)
    const afterEnter = computeEnterAnchor('- 피아워십', anchorDash);
    expect(afterEnter).toBe(anchorDash);

    // Backspace 1번 → 상위(·) 레벨인 anchorDot으로 이동. 이 결과가 "현재 커서/anchor 위치"다.
    const afterBackspace = computeBackspaceAnchor(afterEnter);
    expect(afterBackspace).toBe(anchorDot);

    // 이 상태에서 '-'를 입력한다. previousLineText/previousLineAnchor는 여전히 물리적으로
    // 바로 위 줄인 "피아워십"(anchorDash) 이지만, Backspace로 실제 이동한 anchorDot을
    // 우선해야 하므로 anchorDash를 그대로 재사용해서는 안 된다(재사용하면 Backspace가
    // 없었던 것처럼 원래 자리로 돌아가버리는 버그).
    const result = computeAnchorForNewBullet('-', afterBackspace!, '- 피아워십', anchorDash);

    expect(result).not.toBe(anchorDash); // 버그: previousLineAnchor를 그대로 재사용하면 안 됨
    expect(result.parent).toBe(anchorDot); // 반드시 backspace로 이동한 anchorDot의 자식이어야 함
    expect(result.bulletChar).toBe('-');
    // 시각적으로는 원래 "피아워십"과 같은 column(같은 offsetPx 계산식)이어야 한다
    expect(result.offsetPx).toBe(anchorDash.offsetPx);
  });

  it('Backspace로 이동한 위치의 기호와 같은 기호를 입력하면(직전 줄 기호와 달라도) 그 위치를 그대로 재사용한다', () => {
    const anchorDot = computeAnchorForNewBullet('·', ROOT_ANCHOR, '', ROOT_ANCHOR);
    const anchorDash = computeAnchorForNewBullet('-', anchorDot, '· 영원히', anchorDot);

    // Enter 후 Backspace로 anchorDot(·) 위치까지 이동
    const afterEnter = computeEnterAnchor('- 피아워십', anchorDash);
    const afterBackspace = computeBackspaceAnchor(afterEnter);
    expect(afterBackspace).toBe(anchorDot);

    // 물리적으로 직전 줄은 '-'로 시작하는 "피아워십"이지만, 지금 입력하는 것은 '·'다.
    // Backspace로 이동한 currentLineAnchor(anchorDot) 자체가 이미 '·' 기호의 anchor이므로
    // 새 anchor를 만들지 않고 그대로 재사용해야 한다.
    const result = computeAnchorForNewBullet('·', afterBackspace!, '- 피아워십', anchorDash);
    expect(result).toBe(anchorDot);
  });

  it('Backspace 없이(0번) 바로 입력하면 previousLine 기준 기존 동작과 동일하다(회귀 없음)', () => {
    const anchorDot = computeAnchorForNewBullet('·', ROOT_ANCHOR, '', ROOT_ANCHOR);
    // Enter만 하고 Backspace는 하지 않은 상태 — currentLineAnchor는 previousLineAnchor와 동일
    const afterEnter = computeEnterAnchor('· 영원히', anchorDot);
    expect(afterEnter).toBe(anchorDot);

    const result = computeAnchorForNewBullet('-', afterEnter, '· 영원히', anchorDot);
    expect(result.bulletChar).toBe('-');
    expect(result.parent).toBe(anchorDot);
    expect(result.offsetPx).toBe(anchorDot.offsetPx + BULLET_INDENT_UNIT);
  });

  it('요구사항(글자 크기별 들여쓰기): indentUnit을 넘기면 BULLET_INDENT_UNIT 대신 그 값만큼 들여쓴다', () => {
    // 글자 크기가 커서 배율(scale) 2배로 계산된 상황을 가정 — 호출부(TextObjectView.tsx)가
    // fontScale * BULLET_INDENT_UNIT 을 미리 계산해 넘긴다고 가정한 값.
    const bigIndentUnit = BULLET_INDENT_UNIT * 2;
    const result = computeAnchorForNewBullet('-', ROOT_ANCHOR, '· 큰 글씨', ROOT_ANCHOR, bigIndentUnit);
    expect(result.offsetPx).toBe(ROOT_ANCHOR.offsetPx + bigIndentUnit);

    // indentUnit을 생략하면 기존과 동일하게 BULLET_INDENT_UNIT을 쓴다(하위 호환).
    const fallback = computeAnchorForNewBullet('-', ROOT_ANCHOR, '· 큰 글씨', ROOT_ANCHOR);
    expect(fallback.offsetPx).toBe(ROOT_ANCHOR.offsetPx + BULLET_INDENT_UNIT);
  });
});

describe('computeAnchorForFirstLineBullet — 첫 줄은 들여쓰지 않되 기호를 확립한다', () => {
  it('root 상태의 첫 줄에 처음 기호가 입력되면 offsetPx는 그대로, sourceType만 bullet으로 바뀐다', () => {
    const result = computeAnchorForFirstLineBullet('·', ROOT_ANCHOR);
    expect(result.sourceType).toBe('bullet');
    expect(result.bulletChar).toBe('·');
    expect(result.offsetPx).toBe(ROOT_ANCHOR.offsetPx);
    expect(result.parent).toBe(ROOT_ANCHOR);
  });

  it('이미 bullet로 확립돼 있으면 그대로 재사용한다', () => {
    const established = computeAnchorForFirstLineBullet('·', ROOT_ANCHOR);
    expect(computeAnchorForFirstLineBullet('·', established)).toBe(established);
  });
});

describe('통합 시나리오: 버그 리포트 — ·안녕하세요/-이름/-나이/-성별 다음 빈 줄에서 Backspace 후 ·를 입력', () => {
  it('첫 줄(안녕하세요)이 anchor를 확립해두면, 그 아래로 들여쓴 자식이 Backspace로 되돌아왔을 때 같은 기호를 다시 입력하면 정확히 첫 줄과 같은 열이 된다', () => {
    // · 안녕하세요 (첫 줄 — 이전 줄이 없으므로 computeAnchorForFirstLineBullet 사용)
    const anchorDot = computeAnchorForFirstLineBullet('·', ROOT_ANCHOR);
    expect(anchorDot.offsetPx).toBe(0); // 첫 레벨은 들여쓰지 않음

    //   - 이름 (anchorDash: bullet '-', anchorDot의 자식)
    const afterEnter1 = computeEnterAnchor('· 안녕하세요', anchorDot);
    const anchorDash = computeAnchorForNewBullet('-', afterEnter1, '· 안녕하세요', anchorDot);
    expect(anchorDash.parent).toBe(anchorDot);
    expect(anchorDash.offsetPx).toBe(BULLET_INDENT_UNIT);

    // - 나이 / - 성별은 같은 anchorDash를 재사용
    const afterEnter2 = computeEnterAnchor('- 이름', anchorDash);
    const anchorForNai = computeAnchorForNewBullet('-', afterEnter2, '- 이름', anchorDash);
    expect(anchorForNai).toBe(anchorDash);

    const afterEnter3 = computeEnterAnchor('- 나이', anchorForNai);
    const anchorForSeongbyeol = computeAnchorForNewBullet('-', afterEnter3, '- 나이', anchorForNai);
    expect(anchorForSeongbyeol).toBe(anchorDash);

    // "성별" 줄에서 Enter → 새 빈 줄은 anchorDash를 그대로 상속
    const afterEnter4 = computeEnterAnchor('- 성별', anchorForSeongbyeol);
    expect(afterEnter4).toBe(anchorDash);

    // Backspace 1번 → anchorDot(안녕하세요 레벨)로 이동
    const afterBackspace = computeBackspaceAnchor(afterEnter4);
    expect(afterBackspace).toBe(anchorDot);

    // 이 상태에서 '·'를 입력하면 안녕하세요와 정확히 같은 anchor가 되어야 한다
    // (수정 전에는 anchorDot이 root라서 이 매치가 실패하고 성별보다 더 들여써졌다)
    const result = computeAnchorForNewBullet('·', afterBackspace!, '- 성별', anchorDash);
    expect(result).toBe(anchorDot);
    expect(result.offsetPx).toBe(0);
  });
});

describe('통합 시나리오: Enter 이후 여러 번 Backspace한 뒤 다시 Enter하면, 되돌아간 위치가 새 기준이 된다 (요구사항 6)', () => {
  it('D에서 Enter → Backspace 2번(C 위치로 이동) → 다시 Enter → 새 줄은 D가 아니라 C를 기준으로 한다', () => {
    const A = ROOT_ANCHOR;
    const B: IndentAnchor = { id: 'B', offsetPx: 24, sourceType: 'bullet', bulletChar: '-', parent: A };
    const C: IndentAnchor = { id: 'C', offsetPx: 48, sourceType: 'bullet', bulletChar: '-', parent: B };
    const D: IndentAnchor = { id: 'D', offsetPx: 72, sourceType: 'bullet', bulletChar: '-', parent: C };

    // D 줄에서 Enter → 새 줄은 D를 그대로 상속(콜론 없음)
    const line1 = computeEnterAnchor('D 내용', D);
    expect(line1).toBe(D);

    // Backspace 1번 → C
    const afterBs1 = computeBackspaceAnchor(line1);
    expect(afterBs1).toBe(C);
    // Backspace 2번 → B
    const afterBs2 = computeBackspaceAnchor(afterBs1!);
    expect(afterBs2).toBe(B);

    // 여기서 다시 Enter를 누르면(요구사항 6), D가 아니라 지금 위치(B)를 기준으로 삼아야 한다.
    const line2 = computeEnterAnchor('새로운 내용', afterBs2!);
    expect(line2).toBe(B);
    expect(line2).not.toBe(D);
  });
});
