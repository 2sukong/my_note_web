import type { ArrowObject, ShapeObject } from '../../types/object';
import { useViewportStore } from '../../store/viewportStore';
import { MIN_VISUAL, ShapeSvgContent } from './ShapeSvgContent';

/** 요구사항(2026-09-17, 화살표 클릭 판정 넓히기): 화살표의 보이지 않는 히트 전용
 * stroke 두께 — 화면 기준 고정 px(줌과 무관하게 항상 이만큼 두껍게 느껴진다,
 * SelectionOverlay.tsx의 HANDLE_SCREEN_SIZE와 같은 원리). 기본값 16px(선 중심 기준
 * 양쪽으로 8px씩) — 마우스로 넉넉하게 잡을 수 있으면서 과하게 크지 않은 값으로 골랐다. */
const ARROW_HIT_SCREEN_WIDTH = 16;

interface ShapeViewProps {
  object: ArrowObject | ShapeObject;
}

/**
 * Phase 6: Arrow/Rectangle의 실제 렌더링. ObjectView가 이미 이 객체를
 * position:absolute(left/top/width/height=object의 box) + drag 핸들러가 붙은 div로
 * 감싸주므로(objects/ObjectView.tsx), 여기서는 그 div를 꽉 채우는 <svg> 하나만
 * 그리면 된다 — 별도의 전역 SVG 오버레이 레이어를 두지 않고 각 객체가 자기 박스
 * 안에서 스스로를 그리는 방식을 택했다. 이렇게 하면 드래그 이동/리사이즈/선택
 * (SelectionOverlay)/삭제(useObjectDeleteShortcut) 인프라를 전혀 손대지 않고
 * 그대로 재사용할 수 있다.
 *
 * 알려진 트레이드오프: 클릭 히트 영역이 도형의 실제 선(stroke)이 아니라 bounding
 * box 전체다(대각선으로 그은 얇은 선이라도 박스 안 어디를 클릭해도 선택됨). 실제
 * 손그림 앱(Excalidraw 등)의 stroke-only 히트테스트보다는 덜 정교하지만, 이 프로젝트
 * 규모에서는 자유로운 배치/선택이 항상 가능하다는 장점이 더 크다고 판단했다.
 *
 * 요구사항(2026-09-17, 화살표 클릭/드래그 어려움 수정): 위 트레이드오프가 정확히
 * 수평/수직 화살표에서는 반대로 작용한다는 게 밝혀졌다 — 그런 화살표는
 * object.width 또는 height가 0이 되어(smartGuides.ts 축 스냅) "박스 전체"라는
 * 게 사실상 선 자체(그마저도 렌더링 보정값인 0.5px 두께)로 쪼그라들어, 오히려
 * 대각선 화살표보다 훨씬 클릭하기 어려워진다. 그래서 화살표(type==='arrow')에는
 * ShapeSvgContent의 hitStrokeWidth로 항상 일정한 화면 두께의 투명 히트 stroke를
 * 추가로 깔아준다 — 박스가 큰 대각선 화살표는 원래도 잘 되지만, 박스가 쪼그라드는
 * 수평/수직 화살표에서 특히 체감 차이가 크다. rectangle은 이 문제가 없어서(항상
 * 사각형 테두리를 이루는 실제 면적이 있음) 건드리지 않았다.
 */
export function ShapeView({ object }: ShapeViewProps) {
  const zoom = useViewportStore((s) => s.zoom);
  // 버그 수정(2026-09-15): 화살표를 정확히 수평(height===0)/수직(width===0)으로
  // 그리면(smartGuides.ts의 computeArrowAxisSnap) 이 <svg> 자신의 폭/높이가 0이
  // 돼서 SVG 스펙상 렌더링 자체가 꺼진다(overflow:visible과 무관) — width="100%"/
  // height="100%"는 부모(objects/ObjectView.tsx의 wrapper div, object.width/height
  // 그대로 사용)가 0이면 그대로 0이 되므로, 여기서 직접 최소값을 보정한 실제 px
  // 크기를 준다. ShapeSvgContent 내부의 같은 MIN_VISUAL 보정과 값이 일치해야
  // 좌표 체계가 어긋나지 않는다.
  const svgWidth = Math.max(object.width, MIN_VISUAL);
  const svgHeight = Math.max(object.height, MIN_VISUAL);
  // 화면 기준 고정 폭을 zoom으로 나눠 로컬(world) 단위로 변환 — .canvas-world의
  // CSS transform:scale(zoom) 때문에 로컬 1단위 = zoom 화면 px이라, 여기서 미리
  // 나눠줘야 확대/축소해도 항상 같은 화면 두께로 보인다(리사이즈 핸들과 동일한 계산).
  const arrowHitStrokeWidth = object.type === 'arrow' ? ARROW_HIT_SCREEN_WIDTH / zoom : undefined;
  return (
    <svg
      width={svgWidth}
      height={svgHeight}
      style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible', display: 'block' }}
    >
      <ShapeSvgContent
        type={object.type}
        width={object.width}
        height={object.height}
        strokeColor={object.strokeColor}
        strokeWidth={object.strokeWidth}
        fill={object.type === 'rectangle' && object.fillEnabled ? object.strokeColor : 'none'}
        fillOpacity={object.type === 'rectangle' ? object.fillOpacity : undefined}
        rounded={object.type === 'rectangle' ? object.rounded : undefined}
        flipY={object.type === 'arrow' ? object.flipY : undefined}
        reverseArrow={object.type === 'arrow' ? object.reverseArrow : undefined}
        arrowHead={object.type === 'arrow' ? object.arrowHead : undefined}
        lineStyle={object.lineStyle}
        curveOffset={object.type === 'arrow' ? object.curveOffset : undefined}
        hitStrokeWidth={arrowHitStrokeWidth}
      />
    </svg>
  );
}
