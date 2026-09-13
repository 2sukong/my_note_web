import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePdfOverlayStore } from '../../store/pdfOverlayStore';
import { usePdfOverlaySelectionStore } from '../../store/pdfOverlaySelectionStore';
import { usePdfViewerStore } from '../../store/pdfViewerStore';
import { PdfOverlayTextView } from './PdfOverlayTextView';
import { PdfOverlayShapeView } from './PdfOverlayShapeView';
import { PdfOverlayImageView } from './PdfOverlayImageView';

/**
 * PDF 페이지 오버레이 위의 Text 객체들을 렌더링하는 레이어(Phase 6, 2026-08).
 * PdfOverlayHighlightLayer.tsx(페이지 배경 형광펜 SVG)와 나란히 `.pdf-viewer-page`
 * 안에 놓인다. 이 레이어 자신은 position:absolute;inset:0;pointer-events:none인
 * 빈 래퍼일 뿐이다 — 빈 페이지 배경 클릭이 이 레이어를 그냥 투과해서 아래
 * `.pdf-viewer-page` 자신(pageRef)에 도달해야 useDrawOverlayTextTool.ts의
 * "빈 배경 클릭으로 새 텍스트 생성" 로직이 정상 동작한다. 실제 상호작용이 필요한
 * 부분(각 텍스트 상자, 그 안의 주석)만 PdfOverlayTextView.tsx에서 개별적으로
 * pointerEvents:'auto'를 되살린다.
 *
 * displayScale 계산: 폰트 크기(baseFontSize)처럼 %로 표현할 수 없는 값을 실제 CSS px로
 * 바꾸려면 "지금 화면에 실제로 그려지는 px 대 페이지 기준 px(PDF_PAGE_REFERENCE_SCALE)"
 * 비율이 필요하다. 이 레이어의 래퍼가 부모 `.pdf-viewer-page`와 정확히 같은 크기로
 * 그려지므로(inset:0), 래퍼 자신의 실제 렌더링 폭을 pageWidth로 나누면 곧 그 비율이다 —
 * 별도로 pageRef를 이 컴포넌트까지 넘겨받을 필요가 없다.
 *
 * 버그 수정(2026-09-13, canvas/pdf/PdfOverlayLinkMarkersLayer.tsx에서 먼저 발견된 것과
 * 동일한 문제 — 그 파일의 동일한 주석 참고): 최종 비율은 (1) 패널 폭에 따른 반응형
 * 축소(max-width:100%, 레이아웃에 실제로 반영됨)와 (2) pageZoom(`.pdf-viewer-page`의
 * transform:scale, 시각적으로만 확대) 두 가지가 함께 만든다. 예전엔 이 둘을 구분하지
 * 않고 getBoundingClientRect().width(transform 이후 크기 포함)를 ResizeObserver
 * 콜백에서만 쟀는데, ResizeObserver는 레이아웃 박스 크기만 관찰해서 transform만
 * 바뀌는 경우(=Ctrl+휠로 pageZoom만 바뀌는 경우)엔 콜백이 다시 호출되지 않는다 — 그
 * 결과 확대한 뒤에는 이 글자 크기 배율이 확대 전 값에 멈춰(오버레이 글자/주석이 PDF
 * 확대를 따라가지 못함) 있었다. 고친 방식: ResizeObserver 쪽은 offsetWidth(transform의
 * 영향을 받지 않는 순수 레이아웃 폭)로 "반응형 축소분"(layoutRatio)만 재고, pageZoom은
 * usePdfViewerStore를 reactive하게 구독해서 렌더링마다 곱한다.
 */
export function PdfOverlayObjectsLayer({ pageWidth, pageHeight }: { pageWidth: number; pageHeight: number }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [layoutRatio, setLayoutRatio] = useState(1);
  const pageZoom = usePdfViewerStore((s) => s.pageZoom);
  const displayScale = layoutRatio * (pageZoom > 0 ? pageZoom : 1);
  const objects = usePdfOverlayStore((s) => s.objects);

  useLayoutEffect(() => {
    const el = wrapperRef.current;
    if (!el || pageWidth <= 0) return;

    const measure = () => {
      const width = el.offsetWidth;
      if (width > 0) setLayoutRatio(width / pageWidth);
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [pageWidth]);

  // 요구사항(삭제): Delete/Backspace로 선택된 오버레이 객체를 지운다. 편집 중(문자를
  // 지우는 중)에는 절대 반응하면 안 되므로 editingId가 null일 때만 — 실제 텍스트 편집의
  // Backspace는 PdfOverlayTextView.tsx의 줄 단위 onKeyDown이 이미 전담한다(이 리스너와
  // 겹치지 않는다: 편집 중엔 이 조건에서 걸러진다).
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const { selectedId, editingId } = usePdfOverlaySelectionStore.getState();
      if (!selectedId || editingId) return;
      const target = e.target as HTMLElement | null;
      // 다른 입력 필드(예: 페이지 검색창 등)에 포커스가 가 있을 때 실수로 삭제되지
      // 않도록, 편집 가능한 요소에 포커스가 있으면 이 전역 단축키를 무시한다.
      if (target && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      usePdfOverlayStore.getState().removeObject(selectedId);
      usePdfOverlaySelectionStore.getState().select(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const textObjects = Object.values(objects).filter((o) => o.type === 'text');
  const shapeObjects = Object.values(objects).filter((o) => o.type === 'arrow' || o.type === 'rectangle');
  const imageObjects = Object.values(objects).filter((o) => o.type === 'image');

  return (
    <div ref={wrapperRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {textObjects.map((obj) => (
        <PdfOverlayTextView key={obj.id} object={obj} pageWidth={pageWidth} pageHeight={pageHeight} displayScale={displayScale} />
      ))}
      {shapeObjects.map((obj) => (
        <PdfOverlayShapeView key={obj.id} object={obj} pageWidth={pageWidth} pageHeight={pageHeight} displayScale={displayScale} />
      ))}
      {imageObjects.map((obj) => (
        <PdfOverlayImageView key={obj.id} object={obj} pageWidth={pageWidth} pageHeight={pageHeight} displayScale={displayScale} />
      ))}
    </div>
  );
}
