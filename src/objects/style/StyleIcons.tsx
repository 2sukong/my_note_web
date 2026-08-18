/**
 * Phase 8(스타일 패널) 타일 버튼 안에 들어가는 작은 미리보기 아이콘들.
 * 전부 24x24 뷰박스의 아주 단순한 선 아이콘이다 — 실제 렌더링 결과(ShapeSvgContent)를
 * 흉내만 낼 뿐 그 컴포넌트를 재사용하지는 않는다(아이콘은 항상 정면/고정 크기로만
 * 보이면 되므로 world 좌표계나 zoom을 다룰 필요가 없어 굳이 공유할 이유가 없다).
 */

const STROKE = 'currentColor';

export function ArrowHeadIcon({ style }: { style: 'none' | 'open' | 'triangle' }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18">
      <line x1="3" y1="12" x2="18" y2="12" stroke={STROKE} strokeWidth="2" strokeLinecap="round" />
      {style === 'open' && (
        <polyline
          points="13,7 19,12 13,17"
          fill="none"
          stroke={STROKE}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {style === 'triangle' && <polygon points="20,12 12,8 12,16" fill={STROKE} />}
    </svg>
  );
}

/** 요구사항(모서리 아이콘 개선): 사각형 전체 윤곽 없이, 실제 사각형의 한쪽
 * 모서리(좌상단)만 확대해서 보여준다 — 직각 꺾임 vs 둥근 호 두 상태가 그
 * 자체로 뚜렷이 갈린다. */
export function CornerIcon({ rounded }: { rounded: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18">
      {rounded ? (
        <path
          d="M6.5 18V11a4.5 4.5 0 0 1 4.5-4.5H18"
          fill="none"
          stroke={STROKE}
          strokeWidth="2.3"
          strokeLinecap="round"
        />
      ) : (
        <path
          d="M6.5 18V6.5H18"
          fill="none"
          stroke={STROKE}
          strokeWidth="2.3"
          strokeLinecap="square"
          strokeLinejoin="miter"
        />
      )}
    </svg>
  );
}

export function LineStyleIcon({ style }: { style: 'solid' | 'dotted' | 'dashed' }) {
  const dasharray = style === 'dotted' ? '0.1 4.5' : style === 'dashed' ? '5 3.5' : undefined;
  const cap = style === 'dotted' ? 'round' : 'butt';
  return (
    <svg viewBox="0 0 24 24" width="18" height="18">
      <line
        x1="3"
        y1="12"
        x2="21"
        y2="12"
        stroke={STROKE}
        strokeWidth="2.2"
        strokeDasharray={dasharray}
        strokeLinecap={cap}
      />
    </svg>
  );
}

export function FillIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18">
      <rect
        x="4"
        y="4"
        width="16"
        height="16"
        rx="3"
        fill={filled ? STROKE : 'none'}
        fillOpacity={filled ? 0.35 : undefined}
        stroke={STROKE}
        strokeWidth="1.3"
      />
    </svg>
  );
}

export function StrokeWidthIcon({ width }: { width: number }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18">
      <line x1="4" y1="12" x2="20" y2="12" stroke={STROKE} strokeWidth={width} strokeLinecap="round" />
    </svg>
  );
}

/** 요구사항(텍스트 상자 테두리 옵션): 켜짐/꺼짐을 CornerIcon과 같은 방식(점선 여부 +
 * 옅기)으로 표현한다 — 진하고 실선이면 테두리가 보인다, 옅고 점선이면 안 보인다. */
export function BorderToggleIcon({ enabled }: { enabled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18">
      <rect
        x="4"
        y="4"
        width="16"
        height="16"
        rx="2"
        fill="none"
        stroke={STROKE}
        strokeWidth="2"
        strokeDasharray={enabled ? undefined : '3 2.5'}
        opacity={enabled ? 1 : 0.4}
      />
    </svg>
  );
}

/** 요구사항(프레임 사이드바): 폭/높이를 서로 맞바꾸는 "방향 전환" 버튼 아이콘. */
export function SwapIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18">
      <path
        d="M6 8h11M17 8l-3-3M17 8l-3 3"
        fill="none"
        stroke={STROKE}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M18 16H7M7 16l3-3M7 16l3 3"
        fill="none"
        stroke={STROKE}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 요구사항(프레임 사이드바 — A4 절반 전체 회전): SwapIcon(비율만 전환)과 구분되는
 * "진짜로 90도 돌린다"는 느낌의 회전 화살표. 화살촉을 곡선 끝에서 갈라진 별도
 * 조각으로 두지 않고, 곡선의 둥근 끝(strokeLinecap:round)과 화살촉의 안쪽 모서리가
 * 맞닿도록 좌표를 맞춰 하나로 이어진 것처럼 보이게 한다. */
export function RotateIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18">
      <path d="M8.5 6A7 7 0 1 1 5.3 16.2" fill="none" stroke={STROKE} strokeWidth="2.2" strokeLinecap="round" />
      <path d="M9.8 3.2 9.2 8l-4.6-1.6z" fill={STROKE} />
    </svg>
  );
}

/** 요구사항(지우개 아이콘 개선): 누구나 바로 "지우개"로 읽을 수 있는 클래식한
 * 두 톤 실루엣 — 몸통을 기울이고, 아래쪽 끝(닳아서 뭉툭해진 팁)만 검게 채워
 * 위쪽(깨끗한 몸통)과 뚜렷이 나뉘게 한다. active(지우개 모드 켜짐)일 때는 몸통
 * 전체를 옅게 채워 다른 Tile의 켜짐 상태와 같은 관례를 따른다. */
export function EraserIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18">
      <g transform="rotate(-40 12 12)">
        <path
          d="M6.6 9.4a2 2 0 0 1 2-2h6.8a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H8.6a2 2 0 0 1-2-2z"
          fill={active ? STROKE : '#fff'}
          fillOpacity={active ? 0.18 : 1}
          stroke={STROKE}
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
        <path d="M6.6 13.4h10.8" stroke={STROKE} strokeWidth="1.7" />
        <path d="M6.6 13.4v2a2 2 0 0 0 2 2h6.8a2 2 0 0 0 2-2v-2z" fill={STROKE} stroke="none" />
      </g>
    </svg>
  );
}

export function BoldIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16">
      <text x="12" y="17" fontSize="15" fontWeight="700" textAnchor="middle" fill={STROKE}>
        B
      </text>
    </svg>
  );
}
