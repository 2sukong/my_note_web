import { useToolStore } from '../../store/toolStore';
import { usePdfOverlayShapeDraftStore } from '../../store/pdfOverlayShapeDraftStore';
import { computeDiagonal } from '../../objects/shapes/shapeGeometry';
import { strokeColorValueFor } from '../../objects/shapes/strokeColors';
import { MIN_VISUAL, ShapeSvgContent } from '../../objects/shapes/ShapeSvgContent';
import { PDF_OVERLAY_ABSOLUTE_SIZE_CALIBRATION } from '../../objects/pdf/pdfRaster';

/**
 * canvas/DrawPreview.tsx의 화살표/사각형 미리보기 분기와 같은 원리 — 아직 확정되지
 * 않은 draft를 실시간으로 보여준다(같은 ShapeSvgContent를 공유하므로 미리보기와
 * 확정된 결과의 모양이 항상 같다). 좌표계만 다르다: 여기는 world가 아니라 PDF
 * 페이지 로컬 px라, PdfOverlayTextView.tsx와 같은 방식(pageWidth/pageHeight 대비
 * 백분율)으로 배치하고, 도형 자체는 그 박스 안에서 SVG viewBox로 그린다
 * (PdfOverlayHighlightLayer.tsx의 viewBox 방식과 동일).
 */
export function PdfOverlayShapeDraftLayer({ pageWidth, pageHeight }: { pageWidth: number; pageHeight: number }) {
  const draft = usePdfOverlayShapeDraftStore((s) => s.draft);
  const strokeColorId = useToolStore((s) => s.shapeStrokeColor);
  const strokeWidth = useToolStore((s) => s.shapeStrokeWidth);
  const arrowHead = useToolStore((s) => s.shapeArrowHead);
  const lineStyle = useToolStore((s) => s.shapeLineStyle);
  const rounded = useToolStore((s) => s.shapeRounded);

  if (!draft || pageWidth <= 0 || pageHeight <= 0) return null;

  const { box, flipY, reverseDirection } = computeDiagonal(draft.start, draft.current);
  // 버그 수정(2026-09-15): 기존엔 폭/높이 "둘 중 하나라도" 0이면(||) 미리보기 전체를
  // 숨겼는데, 드래그로 정확히 수평/수직 화살표를 그리는 중(정상적인 진행 상황)에도
  // width 또는 height는 0이 될 수 있다 — 그때마다 미리보기가 사라지는 게 이 버그의
  // 증상 중 하나였다. 완전히 퇴화한 경우(시작점=현재점, 둘 다 0)만 걸러내도록
  // &&로 변경한다.
  if (box.width <= 0 && box.height <= 0) return null;

  // PdfOverlayShapeView.tsx와 같은 이유로 <svg>/wrapper의 실제 렌더링 폭·높이를
  // 최소값으로 보정한다(viewBox의 폭 또는 높이 성분이 0이면 SVG 스펙상 렌더링이
  // 꺼짐).
  const boxWidth = Math.max(box.width, MIN_VISUAL);
  const boxHeight = Math.max(box.height, MIN_VISUAL);

  return (
    <div
      style={{
        position: 'absolute',
        left: `${(box.x / pageWidth) * 100}%`,
        top: `${(box.y / pageHeight) * 100}%`,
        width: `${(boxWidth / pageWidth) * 100}%`,
        height: `${(boxHeight / pageHeight) * 100}%`,
        opacity: 0.8,
        pointerEvents: 'none',
      }}
    >
      <svg width="100%" height="100%" viewBox={`0 0 ${boxWidth} ${boxHeight}`} style={{ overflow: 'visible', display: 'block' }}>
        <ShapeSvgContent
          type={draft.tool}
          width={box.width}
          height={box.height}
          strokeColor={strokeColorValueFor(strokeColorId)}
          // PdfOverlayShapeView.tsx와 같은 이유(viewBox 자동 스케일 보정) —
          // 미리보기(draft)도 확정된 도형과 항상 같은 굵기로 보이게 여기도 곱한다.
          strokeWidth={strokeWidth * PDF_OVERLAY_ABSOLUTE_SIZE_CALIBRATION}
          fill="none"
          flipY={flipY}
          reverseArrow={reverseDirection}
          arrowHead={arrowHead}
          lineStyle={lineStyle}
          rounded={rounded}
        />
      </svg>
    </div>
  );
}
