import type { ArrowObject, ShapeObject, TextObject } from '../../types/object';
import { usePdfOverlayStore } from '../../store/pdfOverlayStore';
import { usePdfOverlaySelectionStore } from '../../store/pdfOverlaySelectionStore';
import { usePdfViewerStore } from '../../store/pdfViewerStore';
import { useLinkStore } from '../../store/linkStore';
import { collectPageLinkEntries } from '../../utils/linkAnchor';
import { PanelShell, ArrowSection, RectangleSection, LinkSection } from '../PropertiesPanel';
import { PdfOverlayTextSection } from './PdfOverlayTextSection';

/**
 * canvas/PropertiesPanel.tsx의 PDF 오버레이 전용 대응물(추가 Phase, 2026-09) —
 * usePdfOverlaySelectionStore.selectedId가 있을 때 그 객체의 속성 패널을 보여준다.
 * 지금까지는(Phase 6~7) PDF 오버레이 객체를 선택해도 오른쪽 사이드바가 완전히
 * 비어 있었다 — PropertiesPanel.tsx가 메인 캔버스의 useInteractionStore/objectsStore만
 * 구독해서 PDF 오버레이를 아예 모르기 때문(그래서 새로 만든 파일도 objects/pdf가 아니라
 * canvas/pdf 아래 둔다 — PropertiesPanel.tsx와 나란한 위치).
 *
 * 텍스트는 부분 서식이 없는 PdfOverlayTextSection(새로 작성)을 쓰고, 화살표/사각형은
 * ArrowSection/RectangleSection을 그대로 재사용한다(그 두 컴포넌트는 object/update prop
 * 만으로 동작해서 store가 달라도 안전 — PropertiesPanel.tsx의 export 주석 참고). 이미지는
 * 메인 캔버스도 속성 패널이 없으므로(크롭 전용 인라인 UI만 있고 사이드바 섹션 자체가 없음)
 * 여기서도 만들지 않는다 — 리사이즈 핸들만으로 충분하다는 기존 관례를 그대로 따른다.
 *
 * canvas/Canvas.tsx가 PropertiesPanel과 이 컴포넌트 중 하나만 렌더링하도록 분기한다
 * (PDF 오버레이 선택이 있으면 이쪽, 없으면 기존 PropertiesPanel) — 두 패널이 동시에
 * 오른쪽에 겹쳐 뜨는 일이 없게 하기 위함.
 */
export function PdfOverlayPropertiesPanel() {
  const selectedId = usePdfOverlaySelectionStore((s) => s.selectedId);
  const selectedLinkId = usePdfOverlaySelectionStore((s) => s.selectedLinkId);
  const deselect = () => usePdfOverlaySelectionStore.getState().select(null);
  const objects = usePdfOverlayStore((s) => s.objects);
  const links = useLinkStore((s) => s.links);
  const openPdfId = usePdfViewerStore((s) => s.openPdfId);
  const currentPageIndex = usePdfViewerStore((s) => s.currentPageIndex);

  // 요구사항(내부 하이퍼링크, 링크 삭제 UX): PDF 오버레이 쪽 링크 마커 선택도 메인
  // 캔버스(PropertiesPanel.tsx의 fineSelection kind:'link')와 완전히 같은 LinkSection을
  // 그대로 재사용한다 — object/update prop만으로 동작하는 ArrowSection/RectangleSection과
  // 같은 이유로 이 파일에서도 안전하게 재사용 가능.
  if (selectedLinkId) {
    const link = links[selectedLinkId];
    if (!link) return null;
    // 요구사항(2026-09-16): 이 PDF의 지금 보고 있는 페이지에 걸린 링크 전체를 함께
    // 보여준다 — canvas/pdf/PdfOverlayLinkMarkersLayer.tsx가 마커를 그리는 것과 같은
    // 기준(surface==='pdf' && pdfId===openPdfId && pageIndex===currentPageIndex)으로
    // 골라서, "지금 이 페이지에 보이는 마커들"과 "목록"이 항상 일치하게 한다.
    const pageLinks = openPdfId ? collectPageLinkEntries(links, { pdfId: openPdfId, pageIndex: currentPageIndex }) : [];
    return (
      <PanelShell
        title="링크"
        onClose={() => usePdfOverlaySelectionStore.getState().selectLink(null)}
        panelKey={`pdfoverlay-link:${selectedLinkId}`}
      >
        <LinkSection
          targetPageId={link.target.pageId}
          targetIsPdf={link.target.surface === 'pdf'}
          targetPageIndex={link.target.pageIndex}
          onDelete={() => {
            void useLinkStore.getState().removeLink(selectedLinkId);
            usePdfOverlaySelectionStore.getState().selectLink(null);
          }}
          pageLinks={pageLinks}
          selectedLinkId={selectedLinkId}
          onSelectLink={(linkId) => usePdfOverlaySelectionStore.getState().selectLink(linkId)}
        />
      </PanelShell>
    );
  }

  if (!selectedId) return null;
  const object = objects[selectedId];
  if (!object) return null;

  const update = (patch: Record<string, unknown>, coalesceKey?: string) =>
    usePdfOverlayStore.getState().updateObject(object.id, patch, coalesceKey);

  if (object.type === 'text') {
    return (
      <PanelShell title="텍스트" onClose={deselect} panelKey={`pdfoverlay:${selectedId}`}>
        <PdfOverlayTextSection object={object as TextObject} update={update} />
      </PanelShell>
    );
  }
  if (object.type === 'arrow') {
    return (
      <PanelShell title="화살표" onClose={deselect} panelKey={`pdfoverlay:${selectedId}`}>
        <ArrowSection object={object as ArrowObject} update={update} />
      </PanelShell>
    );
  }
  if (object.type === 'rectangle') {
    return (
      <PanelShell title="사각형" onClose={deselect} panelKey={`pdfoverlay:${selectedId}`}>
        <RectangleSection object={object as ShapeObject} update={update} />
      </PanelShell>
    );
  }
  // image: 메인 캔버스도 속성 패널이 없다(위 주석 참고) — 리사이즈 핸들만 지원.
  return null;
}
