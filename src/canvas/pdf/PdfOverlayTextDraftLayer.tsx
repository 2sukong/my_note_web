import { useToolStore } from '../../store/toolStore';
import { usePdfOverlayTextDrawDraftStore } from '../../store/pdfOverlayTextDrawDraftStore';
import { computeDiagonal } from '../../objects/shapes/shapeGeometry';

/**
 * canvas/DrawPreview.tsx의 텍스트 드래그 미리보기 분기(흰 반투명 배경 + 1px 테두리 —
 * 실제 확정된 PdfOverlayTextView.tsx 렌더링과 같은 스타일)를 PDF 오버레이 좌표계로
 * 옮긴 것. PdfOverlayShapeDraftLayer.tsx가 화살표/사각형에 대해 이미 하고 있는 것과
 * 같은 구조 — 아직 확정되지 않은 드래그를 pageWidth/pageHeight 대비 백분율로 실시간
 * 표시한다. 드래그가 끝나면 useDrawOverlayTextTool.ts가 이 draft와 정확히 같은 크기로
 * 실제 TextObject를 만든다("그리는 중 미리보기"와 "확정된 결과"가 항상 같아야 한다는
 * 원칙, 화살표/사각형/메인 캔버스 텍스트와 동일).
 */
export function PdfOverlayTextDraftLayer({ pageWidth, pageHeight }: { pageWidth: number; pageHeight: number }) {
  const draft = usePdfOverlayTextDrawDraftStore((s) => s.draft);
  const textBorderEnabled = useToolStore((s) => s.textBorderEnabled);

  if (!draft || pageWidth <= 0 || pageHeight <= 0) return null;

  const { box } = computeDiagonal(draft.start, draft.current);
  if (box.width <= 0 || box.height <= 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        left: `${(box.x / pageWidth) * 100}%`,
        top: `${(box.y / pageHeight) * 100}%`,
        width: `${(box.width / pageWidth) * 100}%`,
        height: `${(box.height / pageHeight) * 100}%`,
        background: 'rgba(255,255,255,0.7)',
        border: textBorderEnabled ? '1px solid #d9d9d9' : 'none',
        borderRadius: 4,
        pointerEvents: 'none',
      }}
    />
  );
}
