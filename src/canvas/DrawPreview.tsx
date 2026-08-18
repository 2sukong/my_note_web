import { useDrawDraftStore } from '../store/drawDraftStore';
import { useTextDrawDraftStore } from '../store/textDrawDraftStore';
import { useToolStore } from '../store/toolStore';
import { strokeColorValueFor } from '../objects/shapes/strokeColors';
import { computeDiagonal } from '../objects/shapes/shapeGeometry';
import { ShapeSvgContent } from '../objects/shapes/ShapeSvgContent';

/**
 * Phase 6: useDrawShapeTool.ts가 드래그 중 갱신하는 drawDraftStore를 구독해서
 * "아직 확정되지 않은" 도형을 실시간으로 보여준다. 실제 저장된 객체(ShapeView.tsx)와
 * 정확히 같은 ShapeSvgContent를 공유하므로 미리보기와 최종 결과물의 모양이 항상 같다.
 * canvas-world 안(Canvas.tsx)에 렌더링되어 pan/zoom transform을 그대로 상속받는다.
 *
 * 요구사항(텍스트 상자 생성/크기조절, 2차): '텍스트' 도구도 드래그로 상자를 그리게
 * 되면서, textDrawDraftStore(useDrawTextTool.ts)를 함께 구독한다. 드래그 중 미리보기가
 * 실제 만들어질 상자와 다른 모양(보라 점선 + 반투명 칠)이었던 걸, 실제 TextObjectView.tsx
 * 렌더링과 똑같은 스타일(흰 반투명 배경 + 1px 테두리, textBorderEnabled 기본값 반영)로
 * 바꿨다 — "그리는 중 미리보기"와 "확정된 결과"가 항상 같아야 한다는 원칙을 화살표/
 * 사각형과 동일하게 텍스트에도 적용한 것. 드래그한 폭/높이 그대로 미리보기 크기로 쓴다
 * (canvas/actions.ts spawnTextFromDraft가 실제로도 그 크기를 그대로 쓴다).
 */
export function DrawPreview() {
  const shapeDraft = useDrawDraftStore((s) => s.draft);
  const textDraft = useTextDrawDraftStore((s) => s.draft);
  const strokeColorId = useToolStore((s) => s.shapeStrokeColor);
  const strokeWidth = useToolStore((s) => s.shapeStrokeWidth);
  const arrowHead = useToolStore((s) => s.shapeArrowHead);
  const lineStyle = useToolStore((s) => s.shapeLineStyle);
  const rounded = useToolStore((s) => s.shapeRounded);
  const textBorderEnabled = useToolStore((s) => s.textBorderEnabled);

  if (textDraft) {
    const { box } = computeDiagonal(textDraft.start, textDraft.current);
    return (
      <div
        style={{
          position: 'absolute',
          left: box.x,
          top: box.y,
          width: box.width,
          height: box.height,
          background: 'rgba(255,255,255,0.7)',
          border: textBorderEnabled ? '1px solid #d9d9d9' : 'none',
          borderRadius: 4,
          pointerEvents: 'none',
        }}
      />
    );
  }

  if (!shapeDraft) return null;

  const { box, flipY, reverseDirection } = computeDiagonal(shapeDraft.start, shapeDraft.current);

  return (
    <svg
      style={{
        position: 'absolute',
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
        overflow: 'visible',
        opacity: 0.8,
        pointerEvents: 'none',
      }}
    >
      <ShapeSvgContent
        type={shapeDraft.tool}
        width={box.width}
        height={box.height}
        strokeColor={strokeColorValueFor(strokeColorId)}
        strokeWidth={strokeWidth}
        fill="none"
        flipY={flipY}
        reverseArrow={reverseDirection}
        // 실제 생성 시 기본값(canvas/actions.ts spawnShapeFromDraft, toolStore의
        // shapeArrowHead/shapeLineStyle/shapeRounded)과 동일한 값을 구독해서
        // "그리는 중 미리보기"와 "확정된 결과"가 항상 같게 한다.
        arrowHead={arrowHead}
        lineStyle={lineStyle}
        rounded={rounded}
      />
    </svg>
  );
}
