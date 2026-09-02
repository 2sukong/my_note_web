import { useToolStore } from '../../store/toolStore';
import { usePdfOverlayStore } from '../../store/pdfOverlayStore';
import { usePdfOverlayHighlightDraftStore } from '../../store/pdfOverlayHighlightDraftStore';
import { resolveHighlightStrokeWidth } from '../../objects/image/imageHighlightGeometry';
import { highlightBackgroundFor } from '../../objects/text/highlightColors';
import { PDF_OVERLAY_ABSOLUTE_SIZE_CALIBRATION } from '../../objects/pdf/pdfRaster';

/**
 * PDF 페이지 배경 위 "형광펜" 확정 선들 + 지금 그리는 중인 draft를 그린다.
 * objects/image/ImageObjectView.tsx의 ImageHighlightOverlay와 같은 원리이지만,
 * 부모 div가 world 좌표(zoom transform 안)가 아니라 화면 고정 Viewer 패널 안에
 * 있으므로 "부모 div의 CSS px == 저장 좌표"라는 그쪽의 전제가 성립하지 않는다 —
 * 대신 viewBox="0 0 pageWidth pageHeight"로 SVG 자체가 페이지 로컬 px 좌표계를
 * 그대로 쓰게 하고, 실제 화면 표시 배율 변환은 SVG 엔진이 알아서 처리하게 한다
 * (useOverlayHighlightTool.ts가 포인터 좌표를 이 좌표계로 환산하는 것과 쌍을 이룬다).
 */
export function PdfOverlayHighlightLayer({ pageWidth, pageHeight }: { pageWidth: number; pageHeight: number }) {
  const highlights = usePdfOverlayStore((s) => s.pageHighlights);
  const draft = usePdfOverlayHighlightDraftStore((s) => s.draft);
  const highlightColor = useToolStore((s) => s.highlightColor);
  const eraserActive = useToolStore((s) => s.highlightEraserActive);
  const highlightThickness = useToolStore((s) => s.highlightThickness);

  if (highlights.length === 0 && !draft) return null;

  const draftStroke = eraserActive ? 'rgba(120, 120, 120, 0.5)' : highlightBackgroundFor(highlightColor);

  return (
    <svg
      viewBox={`0 0 ${pageWidth} ${pageHeight}`}
      preserveAspectRatio="none"
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    >
      {highlights.map((h) => (
        <line
          key={h.id}
          x1={h.x1 * pageWidth}
          y1={h.y1 * pageHeight}
          x2={h.x2 * pageWidth}
          y2={h.y2 * pageHeight}
          stroke={highlightBackgroundFor(h.color)}
          // 요구사항(굵기 페이지-PDF 동등화, 2026-09-01): PdfOverlayShapeView.tsx와
          // 같은 이유 — 이 <svg>도 viewBox="0 0 pageWidth pageHeight"(참조 px)라서
          // strokeWidth가 displayScale만큼 자동으로 줄어든다, CALIBRATION을 곱해 상쇄.
          strokeWidth={resolveHighlightStrokeWidth(h.thicknessRatio, pageWidth, pageHeight) * PDF_OVERLAY_ABSOLUTE_SIZE_CALIBRATION}
          strokeLinecap="round"
        />
      ))}
      {draft && (
        <line
          x1={draft.start.x}
          y1={draft.start.y}
          x2={draft.current.x}
          y2={draft.current.y}
          stroke={draftStroke}
          // 확정된 선(위)과 같은 이유로 CALIBRATION을 곱한다 — 그려지는 중 미리보기도
          // 커밋 후와 항상 같은 굵기로 보여야 한다.
          strokeWidth={highlightThickness * PDF_OVERLAY_ABSOLUTE_SIZE_CALIBRATION}
          strokeLinecap="round"
          strokeDasharray={
            eraserActive
              ? `${highlightThickness * PDF_OVERLAY_ABSOLUTE_SIZE_CALIBRATION * 0.6} ${highlightThickness * PDF_OVERLAY_ABSOLUTE_SIZE_CALIBRATION * 0.5}`
              : undefined
          }
        />
      )}
    </svg>
  );
}
