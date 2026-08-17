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

export function CornerIcon({ rounded }: { rounded: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18">
      <rect
        x="4"
        y="4"
        width="16"
        height="16"
        rx={rounded ? 6 : 0}
        fill="none"
        stroke={STROKE}
        strokeWidth="2"
        strokeDasharray="3 2.5"
      />
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
        strokeWidth="2"
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
 * "진짜로 90도 돌린다"는 느낌의 회전 화살표. */
export function RotateIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18">
      <path
        d="M5 12a7 7 0 1 1 2.1 5"
        fill="none"
        stroke={STROKE}
        strokeWidth="2"
        strokeLinecap="round"
      />
      <polyline points="3,16 4,11 9,12" fill="none" stroke={STROKE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 요구사항(형광펜 지우개): 클래식한 두 톤 지우개 모양 — 몸통을 살짝 기울이고
 * 가운데에 선을 하나 그어 "닳은 쪽/새 쪽"을 나눈 느낌만 낸다. active(지우개 모드
 * 켜짐)일 때는 FillIcon과 같은 관례로 옅게 채워서 눈에 띄게 한다. */
export function EraserIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18">
      <g transform="rotate(-35 12 12)">
        <rect
          x="5"
          y="9"
          width="14"
          height="9"
          rx="2"
          fill={active ? STROKE : 'none'}
          fillOpacity={active ? 0.25 : undefined}
          stroke={STROKE}
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <line x1="5" y1="13.5" x2="19" y2="13.5" stroke={STROKE} strokeWidth="2" />
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
