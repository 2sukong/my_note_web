/**
 * AnnotationBubble.tsx(주석 말풍선 렌더링)와 TextObjectView.tsx(그 줄의 paddingTop/
 * paddingBottom 여백 예약)가 "이 주석이 지금 텍스트 위/아래 어느 쪽에 있는가"를
 * 똑같은 기준으로 판정해야 하므로(하나라도 다른 공식을 쓰면 화살표가 반전되는
 * 시점과 여백이 옮겨가는 시점이 어긋나 보인다) 별도 파일로 뽑아 공유한다 — 컴포넌트
 * 파일(AnnotationBubble.tsx)에서 이 순수 함수를 직접 export하면 Fast Refresh가
 * "컴포넌트만 export하는 파일"이 아니라고 경고하므로(oxlint react-refresh/
 * only-export-components), 컴포넌트가 아닌 로직은 이렇게 따로 둔다.
 */

/** 주석의 "위" 기본 위치가 anchor(원문 텍스트)로부터 얼마나 떨어지는지(기준 크기
 * 기준) — 말풍선 박스 바닥이 anchor.top - totalGap이 되는 최소 여백이다.
 * TextObjectView.tsx의 ANNOTATION_GAP과 반드시 같은 값이어야 한다(그래야 줄
 * 위/아래에 확보하는 여백이 실제로 그려지는 말풍선 위치와 어긋나지 않는다) —
 * isAnnotationBelowAnchor의 위/아래 전환 기준점에도 그대로 쓰인다.
 *
 * 요구사항(텍스트-주석-텍스트 간격 최소화): 이 값은 화살표가 글자에 딱 붙어 보이지
 * 않을 최소한의 여백이지, 시각적 "숨 쉴 공간"을 위한 값이 아니다 — 그 역할은
 * 화살표 자신이 이미 한다. */
export const ANNOTATION_TOTAL_GAP_BASE = 1;

/** 요구사항(2026-09-09, 상하 이동 범위를 "위 기본 위치"와 "아래 기본 위치" 정확히
 * 두 곳으로만 제한 — 사용자 확인: "이진법처럼 텍스트 위, 텍스트 아래로만 이동이
 * 가능하고 텍스트 위/아래 각각에서 더 움직일 수 있는 범위는 없음"): "아래" 기본
 * 위치는 offsetY = totalGap * 이 배수다. 2를 쓰는 이유는 "위" 기본 위치(offsetY=0,
 * 말풍선 바닥이 anchor.top에서 totalGap만큼 위)와 정확히 대칭이 되도록 하기 위함 —
 * "아래" 배치에서는 말풍선 박스 top이 anchor.top에서 totalGap만큼 아래(anchor.top +
 * totalGap)에 오므로, 그 위치를 offsetY 축 하나로 표현하면 totalGap(위 기본 위치가
 * anchor.top으로부터 떨어진 거리) + totalGap(아래 기본 위치가 다시 anchor.top으로부터
 * 떨어진 거리) = totalGap*2가 된다. offsetY는 이 두 값(0 또는 totalGap*2) 둘 중
 * 하나로만 저장된다 — 그 사이 어떤 값도 허용하지 않는다(자유 드래그였던 이전
 * 버전과 다름). */
export const ANNOTATION_OFFSET_Y_BELOW_MULTIPLIER = 2;

/** 드래그 도중 원시(raw) offsetY 후보값이 주어졌을 때, 최종적으로 저장할 두 값(위
 * 기본 위치 0, 아래 기본 위치 totalGap*ANNOTATION_OFFSET_Y_BELOW_MULTIPLIER) 중
 * 어느 쪽으로 스냅해야 하는지 — 정확히 그 중간점(totalGap)을 기준으로 판정한다.
 * AnnotationBubble.tsx의 드래그 핸들러가 이 함수로 스냅 여부를 정하고,
 * isAnnotationBelowAnchor는 "이미 스냅된" offsetY(0 또는 totalGap*배수)를 받아
 * 같은 중간점 비교로 위/아래를 판정한다 — 스냅 판정과 위/아래 판정이 같은 기준선을
 * 공유해야 일관된다. */
export function snapAnnotationOffsetY(rawOffsetY: number, scale: number): number {
  const totalGap = ANNOTATION_TOTAL_GAP_BASE * scale;
  return rawOffsetY > totalGap ? totalGap * ANNOTATION_OFFSET_Y_BELOW_MULTIPLIER : 0;
}

/** 이 offsetY(및 그 offsetY를 낸 scale)를 가진 주석이 지금 "텍스트 아래"에 있는지.
 * AnnotationBubble.tsx의 위치 계산과 TextObjectView.tsx의 줄 여백 예약(paddingTop/
 * paddingBottom, spacer verticalAlign) 양쪽에서 반드시 이 함수 하나만 써야 한다 —
 * 판정 기준이 어긋나면 화살표가 반전된 것처럼 보이는데 여백은 여전히 반대쪽에
 * 잡혀 있는 등 시각적 불일치가 생긴다. offsetY가 정상적으로 snapAnnotationOffsetY를
 * 거쳐 저장된 값(0 또는 totalGap*배수)이라면 이 비교는 항상 명확하게 한쪽으로
 * 떨어진다 — 중간값(totalGap 부근)이 저장돼 있을 일이 구조적으로 없다. */
export function isAnnotationBelowAnchor(offsetY: number, scale: number): boolean {
  const totalGap = ANNOTATION_TOTAL_GAP_BASE * scale;
  return offsetY > totalGap;
}
