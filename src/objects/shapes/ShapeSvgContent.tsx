import { localEndpoints, quadraticControlPoint } from './shapeGeometry';

export type ArrowHeadStyle = 'none' | 'open' | 'triangle';
export type LineStyle = 'solid' | 'dotted' | 'dashed';

export interface ShapeSvgContentProps {
  type: 'arrow' | 'rectangle';
  width: number;
  height: number;
  strokeColor: string;
  strokeWidth: number;
  /** 이미 해석된 최종 채우기 색('none' 또는 실제 색) — fillEnabled 여부 같은 판단은
   * 호출부(ShapeView/DrawPreview)가 하고, 여기는 순수하게 그리기만 한다. */
  fill?: string;
  fillOpacity?: number;
  flipY?: boolean;
  reverseArrow?: boolean;
  arrowHead?: ArrowHeadStyle;
  lineStyle?: LineStyle;
  /** 화살표 중간을 드래그해 만든 굴곡. shapeGeometry.ts의 curveOffset 참고.
   * undefined/0이면 기존과 동일한 직선 <line>으로 그린다. */
  curveOffset?: number;
  /** 사각형 모서리를 둥글게. */
  rounded?: boolean;
}

const MIN_VISUAL = 0.5; // 0-크기 대비, 실제 저장값은 건드리지 않고 렌더링에서만 보정
const ROUNDED_CORNER_RADIUS = 12; // 로컬 svg px. width/height에 비례시키지 않는다(스와치 이미지와 동일하게 항상 일정한 둥글기).

/**
 * strokeWidth에 비례한 점선/파선 패턴을 계산한다. 끝처리(선 끝 모양)는 더 이상
 * 사용자가 고를 수 있는 옵션이 아니다 — 'dotted'만 점처럼 보이도록 둥근 끝을
 * 강제하고, 그 외(실선/파선)는 항상 각지게(butt) 그린다.
 *
 * 버그 수정: 화살표의 <line>이 화살촉(특히 속 채운 삼각형)의 끝점까지 닿을 때,
 * 끝이 둥글면(round) 그 반원이 진행 방향으로 strokeWidth/2만큼 더 튀어나와서
 * "선이 화살촉보다 더 길어 보이는" 문제가 있었다. butt는 좌표에 정확히 딱
 * 맞춰 끝나므로(삼각형 꼭짓점과 정확히 같은 지점) 이 문제가 근본적으로 생기지
 * 않는다 — 그래서 "끝처리 옵션 삭제" 요구사항과 이 버그 수정을 함께 해결한다.
 */
function dashPattern(lineStyle: LineStyle | undefined, strokeWidth: number): { dasharray?: string; effectiveLineCap: 'round' | 'butt' } {
  if (lineStyle === 'dotted') {
    return { dasharray: `${Math.max(0.1, strokeWidth * 0.1)} ${strokeWidth * 2.4}`, effectiveLineCap: 'round' };
  }
  if (lineStyle === 'dashed') {
    return { dasharray: `${strokeWidth * 3} ${strokeWidth * 2.2}`, effectiveLineCap: 'butt' };
  }
  return { dasharray: undefined, effectiveLineCap: 'butt' };
}

/**
 * <rect>/<line>+화살촉을 실제로 그리는 부분. ShapeView(저장된 CanvasObject를 그림)와
 * DrawPreview(드래그 중인 미확정 draft를 그림)가 이 컴포넌트를 공유한다 — "만드는 중에
 * 보이는 모습"과 "만들어진 뒤의 모습"이 항상 똑같아야 하기 때문에 렌더링 로직을
 * 하나로 유지한다.
 *
 * Phase 8(스타일 패널)에서 arrowHead/lineStyle/rounded/fillOpacity를 추가했다.
 * 모든 새 prop은 optional이고 undefined일 때 기존 Phase 6 모양(속 채운 삼각형/실선/
 * 뾰족한 모서리/투명 내부)과 정확히 같게 렌더링되도록 기본값을 잡아뒀다. 끝처리(선
 * 끝 모양)는 사용자 옵션이 아니다 — dashPattern()이 항상 butt(단, dotted는 round)로
 * 고정한다(요구사항: 끝처리 옵션 삭제 + 화살촉보다 선이 길어 보이던 버그 수정).
 */
export function ShapeSvgContent({
  type,
  width,
  height,
  strokeColor,
  strokeWidth,
  fill,
  fillOpacity,
  flipY,
  reverseArrow,
  arrowHead = 'triangle',
  lineStyle = 'solid',
  rounded,
  curveOffset,
}: ShapeSvgContentProps) {
  const w = Math.max(width, MIN_VISUAL);
  const h = Math.max(height, MIN_VISUAL);

  if (type === 'rectangle') {
    const sw = strokeWidth;
    const { dasharray, effectiveLineCap } = dashPattern(lineStyle, sw);
    const resolvedFill = fill ?? 'none';
    return (
      <rect
        x={sw / 2}
        y={sw / 2}
        width={Math.max(0, w - sw)}
        height={Math.max(0, h - sw)}
        rx={rounded ? ROUNDED_CORNER_RADIUS : 0}
        ry={rounded ? ROUNDED_CORNER_RADIUS : 0}
        fill={resolvedFill}
        fillOpacity={resolvedFill === 'none' ? undefined : fillOpacity}
        stroke={strokeColor}
        strokeWidth={sw}
        strokeDasharray={dasharray}
        strokeLinecap={effectiveLineCap}
      />
    );
  }

  // arrow
  const { p1, p2 } = localEndpoints(w, h, !!flipY, !!reverseArrow);
  // curveOffset이 0/undefined면 제어점이 중점과 같아져서 곡선이 직선(p1-p2)과
  // 완전히 겹친다 — 그래도 <path>가 아니라 굳이 <line> 분기를 남겨두는 이유는
  // 화살촉 각도 계산과 렌더링을 기존 Phase 6/8 그대로 최소 변경으로 유지하기 위함.
  const hasCurve = !!curveOffset;
  const control = hasCurve ? quadraticControlPoint(p1, p2, curveOffset) : undefined;
  // 화살촉이 선(또는 곡선)의 진행 방향을 그대로 가리키도록: 직선이면 p1->p2,
  // 곡선이면 t=1에서의 접선 방향(제어점->p2)을 쓴다.
  const angle = control ? Math.atan2(p2.y - control.y, p2.x - control.x) : Math.atan2(p2.y - p1.y, p2.x - p1.x);
  const headLen = Math.max(8, strokeWidth * 4);
  const headSpread = 0.5; // 라디안
  const { dasharray, effectiveLineCap } = dashPattern(lineStyle, strokeWidth);

  return (
    <>
      {control ? (
        <path
          d={`M ${p1.x} ${p1.y} Q ${control.x} ${control.y} ${p2.x} ${p2.y}`}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeLinecap={effectiveLineCap}
          strokeDasharray={dasharray}
        />
      ) : (
        <line
          x1={p1.x}
          y1={p1.y}
          x2={p2.x}
          y2={p2.y}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeLinecap={effectiveLineCap}
          strokeDasharray={dasharray}
        />
      )}
      {arrowHead === 'triangle' && (
        <polygon points={arrowHeadPoints(p2, angle, headLen, headSpread)} fill={strokeColor} />
      )}
      {arrowHead === 'open' && (
        <polyline
          points={openArrowHeadPoints(p2, angle, headLen, headSpread)}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </>
  );
}

function arrowHeadPoints(tip: { x: number; y: number }, angle: number, len: number, spread: number): string {
  const back1 = {
    x: tip.x - len * Math.cos(angle - spread),
    y: tip.y - len * Math.sin(angle - spread),
  };
  const back2 = {
    x: tip.x - len * Math.cos(angle + spread),
    y: tip.y - len * Math.sin(angle + spread),
  };
  return `${tip.x},${tip.y} ${back1.x},${back1.y} ${back2.x},${back2.y}`;
}

/** 속을 채우지 않는 "열린(ㅅ자)" 화살촉 — 한쪽 날개 끝 → 촉 → 반대쪽 날개 끝을 잇는
 * 꺾은선 하나로 그린다(참고 이미지의 "기존 화살표 모양"). arrowHeadPoints와 좌표
 * 계산은 같고, <polygon>(채움) 대신 <polyline>(선만)으로 그리는 차이뿐이다. */
function openArrowHeadPoints(tip: { x: number; y: number }, angle: number, len: number, spread: number): string {
  const back1 = {
    x: tip.x - len * Math.cos(angle - spread),
    y: tip.y - len * Math.sin(angle - spread),
  };
  const back2 = {
    x: tip.x - len * Math.cos(angle + spread),
    y: tip.y - len * Math.sin(angle + spread),
  };
  return `${back1.x},${back1.y} ${tip.x},${tip.y} ${back2.x},${back2.y}`;
}
