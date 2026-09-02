import { useToolStore } from '../../store/toolStore';
import { usePdfOverlayShapeDraftStore } from '../../store/pdfOverlayShapeDraftStore';
import { computeDiagonal } from '../../objects/shapes/shapeGeometry';
import { strokeColorValueFor } from '../../objects/shapes/strokeColors';
import { ShapeSvgContent } from '../../objects/shapes/ShapeSvgContent';
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
  if (box.width <= 0 || box.height <= 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        left: `${(box.x / pageWidth) * 100}%`,
        top: `${(box.y / pageHeight) * 100}%`,
        width: `${(box.width / pageWidth) * 100}%`,
        height: `${(box.height / pageHeight) * 100}%`,
        opacity: 0.8,
        pointerEvents: 'none',
      }}
    >
      <svg width="100%" height="100%" viewBox={`0 0 ${box.width} ${box.height}`} style={{ overflow: 'visible', display: 'block' }}>
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
