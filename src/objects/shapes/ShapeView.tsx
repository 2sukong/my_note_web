import type { ArrowObject, ShapeObject } from '../../types/object';
import { ShapeSvgContent } from './ShapeSvgContent';

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
 */
export function ShapeView({ object }: ShapeViewProps) {
  return (
    <svg
      width="100%"
      height="100%"
      style={{ position: 'absolute', inset: 0, overflow: 'visible', display: 'block' }}
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
      />
    </svg>
  );
}
