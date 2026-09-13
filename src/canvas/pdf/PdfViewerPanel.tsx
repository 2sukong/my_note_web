import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { usePdfViewerStore } from '../../store/pdfViewerStore';
import {
  getOverlayPageIndexesForPdf,
  getPdfPageRasterUrl,
  releaseRasterUrlsForPdf,
  usePdfLibraryStore,
} from '../../store/pdfLibraryStore';
import { usePdfOverlayStore } from '../../store/pdfOverlayStore';
import { usePdfOverlaySelectionStore } from '../../store/pdfOverlaySelectionStore';
import type { PdfLibraryRecord } from '../../types/pdf';
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from '../../icons/Icons';
import { useOverlayHighlightTool } from './useOverlayHighlightTool';
import { PdfOverlayHighlightLayer } from './PdfOverlayHighlightLayer';
import { useDrawOverlayTextTool } from './useDrawOverlayTextTool';
import { useOverlayTextSelectionTools } from './useOverlayTextSelectionTools';
import { PdfOverlayObjectsLayer } from './PdfOverlayObjectsLayer';
import { useDrawOverlayShapeTool } from './useDrawOverlayShapeTool';
import { PdfOverlayShapeDraftLayer } from './PdfOverlayShapeDraftLayer';
import { PdfOverlayTextDraftLayer } from './PdfOverlayTextDraftLayer';
import { usePdfViewerZoom } from './usePdfViewerZoom';
import { useOverlayImagePlacementTool } from './useOverlayImagePlacementTool';
import { usePdfOverlayImagePickerStore } from '../../store/pdfOverlayImagePickerStore';
import { spawnOverlayImageAt } from './spawnOverlayImage';
import { useOverlayLinkTool } from './useOverlayLinkTool';
import { PdfOverlayLinkMarkersLayer } from './PdfOverlayLinkMarkersLayer';
import './PdfViewerPanel.css';

const THUMB_WIDTH = 64;
const THUMB_HEIGHT = 84;
const THUMB_GAP = 8;
/** 스크롤 위치 앞뒤로 몇 개의 썸네일을 더 렌더링해둘지(빠른 스크롤 시 빈 칸이 잠깐 보이는
 * 것을 줄이기 위한 여유분). 100페이지짜리 PDF에서도 이 범위 밖은 아예 렌더링하지 않으므로
 * (getPdfPageRasterUrl을 부르지 않으므로) 필름스트립 성능이 페이지 수에 영향받지 않는다. */
const VISIBLE_BUFFER = 4;

/** Viewer 패널 열기/닫기 전환 시간(ms) — PdfViewerPanel.css의 transition-duration과 반드시
 * 같은 값을 유지할 것(닫힘 애니메이션이 끝나는 시점을 이 숫자로 setTimeout하기 때문에,
 * CSS 쪽 값만 따로 바뀌면 실제 DOM 제거 타이밍과 어긋난다). */
const PDF_VIEWER_CLOSE_ANIM_MS = 150;

/** 필름스트립 안의 썸네일 하나. 화면에 보이는 범위에 들어왔을 때만 마운트되고
 * (PdfViewerPanel의 visibleRange가 결정), 마운트되면 그때 처음으로 래스터를 요청한다 —
 * 100페이지짜리 PDF를 열어도 한 번에 몇 장만 실제로 렌더링/캐싱된다(v3 §1-4). */
function PdfThumb({
  record,
  pageIndex,
  isActive,
  hasAnnotations,
  onSelect,
}: {
  record: PdfLibraryRecord;
  pageIndex: number;
  isActive: boolean;
  /** 요구사항(2026-09): 이 페이지에 저장된 필기(오버레이 객체/하이라이트)가 있으면
   * 미리보기 테두리를 빨간색으로 칠한다(§ PdfViewerPanel의 annotatedPageIndexes). */
  hasAnnotations: boolean;
  onSelect: (pageIndex: number) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setFailed(false);
    getPdfPageRasterUrl(record, pageIndex)
      .then((res) => {
        if (!cancelled) setUrl(res.url);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // 버그 진단(2026-08): 이 catch가 없던 이전 버전에서는 렌더링 실패 시 아무 표시도
        // 없이 빈 자리만 남아 "PDF가 안 뜨는데 원인을 알 수 없다"는 상태가 됐다 — 콘솔에
        // 남기고 화면에도 작은 실패 표시를 해서 최소한 "실패했다"는 사실 자체는 보이게 한다.
        console.error(`[PdfViewerPanel] 썸네일 렌더링 실패 (page ${pageIndex + 1})`, err);
        setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [record, pageIndex]);

  const boxClassName = hasAnnotations ? 'pdf-viewer-thumb-box has-annotations' : 'pdf-viewer-thumb-box';

  return (
    <button
      type="button"
      className={isActive ? 'pdf-viewer-thumb is-active' : 'pdf-viewer-thumb'}
      onClick={() => onSelect(pageIndex)}
    >
      <span className={boxClassName} style={{ width: THUMB_WIDTH, height: THUMB_HEIGHT }}>
        {url && <img src={url} alt="" draggable={false} />}
        {failed && <span className="pdf-viewer-thumb-error">!</span>}
      </span>
      <span className="pdf-viewer-thumb-num">{pageIndex + 1}</span>
    </button>
  );
}

/**
 * PDF Reference Viewer 패널(Phase 5). v3 §1-3 확정대로 왼쪽 도킹 + 오른쪽 모서리
 * 리사이즈, 세로는 화면 전체(top:0/bottom:0), 위쪽은 선택된 페이지를 크게 보여주는
 * 영역, 아래쪽은 페이지 번호가 붙은 가로 필름스트립이다.
 *
 * Canvas/world 좌표와는 완전히 무관하다(v2 확정) — 이 컴포넌트가 여는/닫는 것은 화면
 * 고정 패널일 뿐이고, canvas-root는 store/pdfViewerStore.ts가 계산한 --pdf-viewer-shift
 * 만큼 오른쪽으로 밀려날 뿐(패널이 Frame이나 다른 PDF와 겹치는지 신경 쓸 필요가 아예 없음
 * — Space+드래그로 Canvas 쪽만 움직이면 Frame이 Viewer 뒤에서 벗어난다).
 */
export function PdfViewerPanel() {
  const openPdfId = usePdfViewerStore((s) => s.openPdfId);
  const currentPageIndex = usePdfViewerStore((s) => s.currentPageIndex);
  const width = usePdfViewerStore((s) => s.width);
  const pageZoom = usePdfViewerStore((s) => s.pageZoom);
  const setCurrentPageIndex = usePdfViewerStore((s) => s.setCurrentPageIndex);
  const setWidth = usePdfViewerStore((s) => s.setWidth);
  const commitWidth = usePdfViewerStore((s) => s.commitWidth);
  const closeViewer = usePdfViewerStore((s) => s.closeViewer);
  const entries = usePdfLibraryStore((s) => s.entries);

  const record = entries.find((e) => e.id === openPdfId);
  // 버그 수정(2026-08): record는 entries 배열에서 매 렌더마다 새로 찾는 객체라서, entries가
  // (값은 그대로인데) 새 참조로 바뀌기만 해도 record 자체가 "다른 객체"가 된다. 아래 두
  // effect는 실제로는 "어떤 PDF/페이지인지"(id 값)만 알면 되므로, record 객체 자체가 아니라
  // 이 id(원시값)에만 의존하게 해서 record의 참조가 흔들려도 불필요하게 다시 실행되지
  // 않도록 한다(store/pdfLibraryStore.ts의 setLastViewedPageIndex 쪽에도 근본 원인을 막는
  // 별도 수정을 해뒀지만, 여기서도 이중으로 방어해둔다).
  const recordId = record?.id ?? null;

  const filmstripRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imageFileInputRef = useRef<HTMLInputElement>(null);
  const resizeRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 0 });
  // 요구사항(2026-09, 필름스트립 빨간 테두리): "지금 보고 있지 않은" 페이지들 중 필기가
  // 저장된 페이지 인덱스 집합 — 아래 loadForPage 효과가 페이지 전환마다(이전 페이지
  // flush가 끝난 뒤) 다시 조회해 채운다. "지금 보고 있는" 페이지는 이 집합이 아니라
  // pdfOverlayStore의 실시간 objects/pageHighlights로 바로 판정한다(디바운스 저장을
  // 기다리지 않고 타이핑/그리기 즉시 테두리가 반응하도록).
  const [annotatedPageIndexes, setAnnotatedPageIndexes] = useState<Set<number>>(new Set());
  const [stagePage, setStagePage] = useState<{ url: string; width: number; height: number } | null>(null);
  const [stageError, setStageError] = useState<string | null>(null);
  const [stageLoading, setStageLoading] = useState(false);

  // 열기/닫기 애니메이션(Phase 7). Viewer는 openPdfId가 null이 되는 순간 곧바로 언마운트되면
  // (기존 동작) 닫히는 모습을 애니메이션할 시간 자체가 없다 — 그래서 실제 데이터/리소스는
  // 지금까지와 똑같이 openPdfId 변화에 맞춰 즉시 정리하되(위쪽 effect들은 전혀 안 건드림),
  // 화면에 그리는 DOM 노드만 별도의 `mounted` 상태로 한 박자 늦게 없앤다. `displayRecordRef`는
  // "마지막으로 열려 있던 PDF"를 기억해서, openPdfId가 null이 돼 record를 못 찾게 된
  // 뒤에도(entries.find가 항상 undefined) 닫히는 동안 패널 헤더/필름스트립이 빈 값 대신
  // 마지막 내용을 보여주며 사라지게 한다.
  const displayRecordRef = useRef<PdfLibraryRecord | null>(null);
  if (record) displayRecordRef.current = record;
  const wasOpenRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);
  const [mounted, setMounted] = useState(false);
  const [entered, setEntered] = useState(false);
  // 리사이즈 드래그 중엔 CSS width transition을 꺼야 한다(PdfViewerPanel.css의 .is-resizing
  // 참고) — 안 그러면 매 pointermove의 setWidth 호출이 transition에 걸려 드래그가 커서보다
  // 뒤늦게 따라오는 것처럼 보인다.
  const [resizing, setResizing] = useState(false);

  // 열려 있던 PDF가 바뀌거나(다른 PDF를 열거나) Viewer가 닫히면, 그 사이 이번 세션에서
  // 만들어둔 object URL을 전부 정리한다(pdfLibraryStore.ts § releaseRasterUrlsForPdf).
  useEffect(() => {
    if (!openPdfId) return;
    const pdfId = openPdfId;
    return () => releaseRasterUrlsForPdf(pdfId);
  }, [openPdfId]);

  // Phase 6: Viewer가 닫히면(다른 PDF로 바뀌는 경우 포함) 오버레이 store도 함께 정리한다
  // — 대기 중인 저장을 flush하고 메모리 상태/undo 스택을 비운다(pdfOverlayStore.ts §
  // closeOverlay). 아래 loadForPage 효과와는 별개로, "이 PDF를 벗어난다"는 시점 자체에만
  // 반응한다(페이지 이동만으로는 발동하지 않음 — deps가 openPdfId뿐).
  useEffect(() => {
    if (!openPdfId) return;
    return () => {
      void usePdfOverlayStore.getState().closeOverlay();
      usePdfOverlaySelectionStore.getState().clear();
    };
  }, [openPdfId]);

  // Phase 6: 지금 보고 있는 페이지가 바뀔 때마다(다른 PDF를 열거나, 페이지를 넘기거나)
  // 그 페이지의 저장된 오버레이(필기)를 불러온다.
  //
  // 요구사항(2026-09, 필름스트립 빨간 테두리): loadForPage는 새 페이지를 불러오기 전에
  // 먼저 "이전 페이지"의 대기 중인 저장을 flush한다(pdfOverlayStore.ts § flushPendingSave)
  // — 그 완료를 기다린 뒤 annotatedPageIndexes를 다시 조회하면, 방금 막 필기하고 떠난
  // 페이지의 빨간 테두리 여부도 곧바로 최신 상태로 반영된다.
  useEffect(() => {
    if (!recordId) return;
    let cancelled = false;
    void (async () => {
      await usePdfOverlayStore.getState().loadForPage(recordId, currentPageIndex);
      usePdfOverlaySelectionStore.getState().clear();
      const indexes = await getOverlayPageIndexesForPdf(recordId);
      if (!cancelled) setAnnotatedPageIndexes(new Set(indexes));
    })();
    return () => {
      cancelled = true;
    };
  }, [recordId, currentPageIndex]);

  // 진도 확인용: 보고 있는 페이지가 바뀔 때마다 Library 레코드에 기억해둔다 — 다음에 이
  // PDF를 다시 열면 PdfLibraryRail.tsx가 이 값으로 openViewer(id, lastViewedPageIndex)를
  // 부른다.
  useEffect(() => {
    if (!recordId) return;
    void usePdfLibraryStore.getState().setLastViewedPageIndex(recordId, currentPageIndex);
  }, [recordId, currentPageIndex]);

  // 큰 미리보기 영역: 선택된 페이지 하나만 온디맨드로 렌더링한다.
  useEffect(() => {
    if (!record) {
      setStagePage(null);
      setStageError(null);
      setStageLoading(false);
      return;
    }
    let cancelled = false;
    setStagePage(null);
    setStageError(null);
    setStageLoading(true);
    getPdfPageRasterUrl(record, currentPageIndex)
      .then((res) => {
        if (cancelled) return;
        setStagePage(res);
        setStageLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // 버그 진단(2026-08): 렌더링이 실패해도 이전엔 아무 표시가 없어(빈 흰 화면) 원인을
        // 알 수 없었다 — 콘솔에 실제 에러를 남기고 화면에도 눈에 보이는 실패 메시지를 준다.
        console.error('[PdfViewerPanel] 페이지 렌더링 실패', err);
        setStageError(err instanceof Error ? err.message : String(err));
        setStageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [record, currentPageIndex]);

  const recomputeVisibleRange = useCallback(() => {
    const el = filmstripRef.current;
    if (!el || !record) return;
    const perThumb = THUMB_WIDTH + THUMB_GAP;
    const start = Math.max(0, Math.floor(el.scrollLeft / perThumb) - VISIBLE_BUFFER);
    const count = Math.ceil(el.clientWidth / perThumb) + VISIBLE_BUFFER * 2;
    const end = Math.min(record.pageCount, start + count);
    setVisibleRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, [record]);

  // 버그 수정(2026-09, "처음 열면 필름스트립이 안 뜨고 </> 를 눌러야 나타남"): 이전엔
  // width(store 값)에만 의존해 재계산했는데, 패널이 열리는 CSS transition(entered
  // 상태) 동안 store의 width 자체는 안 바뀌면서 실제 DOM(filmstripRef)의 clientWidth만
  // 0→실제값으로 바뀐다 — recomputeVisibleRange가 그 순간을 못 잡아 visibleRange가
  // {0,0}에 머물렀다(필름스트립 스크롤 이벤트가 한 번이라도 발생해야, 즉 </> 클릭으로
  // scrollBy가 일어나야만 recomputeVisibleRange가 재실행됐던 것). ResizeObserver로
  // filmstripRef 엘리먼트 자신의 실제 크기 변화를 직접 관찰하면 최초 마운트 시 크기
  // (관찰 시작 시 한 번 즉시 콜백됨), transition 도중의 폭 변화, 리사이즈 핸들 드래그를
  // 전부 한 메커니즘으로 커버해 이런 시점 불일치 자체가 생기지 않는다.
  useEffect(() => {
    const el = filmstripRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => recomputeVisibleRange());
    observer.observe(el);
    return () => observer.disconnect();
  }, [recomputeVisibleRange]);

  // 요구사항(2026-09-09): 상단 이전/다음 페이지 화살표(또는 필름스트립 썸네일 클릭 등
  // currentPageIndex가 바뀌는 어떤 경로로든)로 페이지가 바뀌면, 그 페이지의 썸네일이
  // 필름스트립 밖에 있을 때만 "화면에 보이는 데 필요한 최소 거리"만큼만 스크롤한다 —
  // 이미 보이는 중이면 아무것도 안 함, 왼쪽 밖이면 왼쪽 끝에 맞춰서, 오른쪽 밖이면
  // 오른쪽 끝에 맞춰서(가운데로 강제 정렬하지 않음). 썸네일이 절대좌표
  // (pageIndex * (THUMB_WIDTH + THUMB_GAP))로 배치돼 있어 가상화 범위 밖이라 아직
  // DOM에 없어도 위치를 바로 계산할 수 있다 — scrollIntoView 대신 이 방식을 쓴 이유.
  useEffect(() => {
    const el = filmstripRef.current;
    if (!el) return;
    const perThumb = THUMB_WIDTH + THUMB_GAP;
    const thumbLeft = currentPageIndex * perThumb;
    const thumbRight = thumbLeft + THUMB_WIDTH;
    const viewLeft = el.scrollLeft;
    const viewRight = viewLeft + el.clientWidth;
    let target: number | null = null;
    if (thumbLeft < viewLeft) {
      target = thumbLeft;
    } else if (thumbRight > viewRight) {
      target = thumbRight - el.clientWidth;
    }
    if (target !== null) {
      el.scrollTo({ left: target, behavior: 'smooth' });
    }
  }, [currentPageIndex]);

  // Phase 6: 형광펜 등 오버레이 도구는 이 훅이 stagePage가 없을 때(pageWidth/height<=0)
  // 스스로 아무 것도 하지 않으므로, 다른 훅들과 마찬가지로 항상 호출해도 안전하다(Hooks
  // 규칙: 조건부 return보다 위에서 무조건 호출).
  useOverlayHighlightTool(pageRef, stagePage?.width ?? 0, stagePage?.height ?? 0);
  useDrawOverlayTextTool(pageRef, stagePage?.width ?? 0, stagePage?.height ?? 0);
  useOverlayTextSelectionTools(pageRef, stagePage?.width ?? 0, stagePage?.height ?? 0);
  useDrawOverlayShapeTool(pageRef, stagePage?.width ?? 0, stagePage?.height ?? 0);
  useOverlayImagePlacementTool(pageRef, stagePage?.width ?? 0, stagePage?.height ?? 0);
  // 요구사항(내부 하이퍼링크, Phase 9): 위 훅들과 동일하게 stagePage가 없으면(pageWidth/
  // height<=0) 스스로 아무 것도 하지 않으므로 항상 호출해도 안전하다.
  useOverlayLinkTool(pageRef, stagePage?.width ?? 0, stagePage?.height ?? 0);
  usePdfViewerZoom(stageRef, stagePage?.width ?? 0);

  // 요구사항(2026-09, 필름스트립 빨간 테두리): "지금 보고 있는" 페이지는 디바운스 저장을
  // 기다리지 않고 pdfOverlayStore의 메모리 상태를 그대로 읽어 즉시 반영한다(§ 위
  // annotatedPageIndexes 선언부 주석).
  const currentOverlayObjectCount = usePdfOverlayStore((s) => Object.keys(s.objects).length);
  const currentOverlayHighlightCount = usePdfOverlayStore((s) => s.pageHighlights.length);

  // Phase 6(이미지, 2026-08): Canvas.tsx의 fileInputRef 효과와 완전히 같은 패턴 —
  // React StrictMode 이중 마운트에서도 "첫 실행"을 기준값(baseline)과의 비교로 판정해서
  // 사용자 클릭 없이 파일 선택 창을 열려다 브라우저에 막히는 문제("user activation"
  // 에러)를 피한다.
  const imagePickerRequestId = usePdfOverlayImagePickerStore((s) => s.requestId);
  const baselineImagePickerRequestId = useRef(imagePickerRequestId).current;
  useEffect(() => {
    if (imagePickerRequestId === baselineImagePickerRequestId) return;
    imageFileInputRef.current?.click();
  }, [imagePickerRequestId, baselineImagePickerRequestId]);

  const handleOverlayImageFileInputChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 같은 파일을 연달아 선택할 수 있도록 초기화
    const pending = usePdfOverlayImagePickerStore.getState().pending;
    usePdfOverlayImagePickerStore.getState().clearPending();
    if (file && pending) {
      void spawnOverlayImageAt(pending.x, pending.y, file);
    }
  };

  // 열림(record가 생김)은 즉시 mounted=true로 반영하되, 처음 열리는 프레임에는
  // entered=false로 한 번 그린 뒤(패널이 닫힌 위치/투명 상태) 다음 프레임에 entered=true로
  // 바꿔서(패널이 열린 위치/불투명 상태) 그 사이 CSS transition이 실제로 재생되게 한다 —
  // 두 상태를 같은 프레임에 같이 반영하면 브라우저가 전환할 대상이 없어 애니메이션 없이
  // 바로 열린 모습으로 보인다(흔한 "마운트 다음 프레임에 클래스 전환" 패턴). 닫힘은 반대로
  // entered를 즉시 false로 돌려 slide-out/fade-out을 재생시키고, 그 전환 시간(
  // PDF_VIEWER_CLOSE_ANIM_MS)이 끝난 뒤에야 mounted를 false로 내려 실제로 DOM에서 뗀다.
  useEffect(() => {
    // recordId(원시값)로 판단한다 — entries.find()가 매 렌더 새 참조를 주는 record 객체를
    // 그대로 deps에 넣으면(이 파일 위쪽 '버그 수정(2026-08)' 주석과 같은 함정) entries가
    // 값 변화 없이 참조만 바뀌어도 이 effect가 불필요하게 다시 실행된다.
    const isOpen = Boolean(openPdfId && recordId);
    if (isOpen) {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      const reopening = !wasOpenRef.current;
      wasOpenRef.current = true;
      setMounted(true);
      if (reopening) {
        setEntered(false);
        const raf = requestAnimationFrame(() => setEntered(true));
        return () => cancelAnimationFrame(raf);
      }
      setEntered(true);
      return;
    }
    if (wasOpenRef.current) {
      wasOpenRef.current = false;
      setEntered(false);
      closeTimerRef.current = window.setTimeout(() => {
        setMounted(false);
        closeTimerRef.current = null;
      }, PDF_VIEWER_CLOSE_ANIM_MS);
    }
  }, [openPdfId, recordId]);

  // 언마운트 시 남아있는 타이머 정리(예: Viewer가 닫히는 애니메이션 도중 Canvas.tsx 자체가
  // 사라지는 경우) — 안 지우면 이미 사라진 컴포넌트의 setState를 호출하려는 경고가 뜬다.
  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  if (!mounted || !displayRecordRef.current) return null;
  const panelRecord = displayRecordRef.current;

  const scrollFilmstripByGroup = (direction: 1 | -1) => {
    filmstripRef.current?.scrollBy({ left: direction * (filmstripRef.current?.clientWidth ?? 0), behavior: 'smooth' });
  };

  const isPageAnnotated = (pageIndex: number): boolean =>
    pageIndex === currentPageIndex
      ? currentOverlayObjectCount > 0 || currentOverlayHighlightCount > 0
      : annotatedPageIndexes.has(pageIndex);

  const onResizePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    resizeRef.current = { pointerId: e.pointerId, startX: e.clientX, startWidth: width };
    setResizing(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onResizePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const state = resizeRef.current;
    if (!state || state.pointerId !== e.pointerId) return;
    // useObjectResize.ts와 같은 이유: 브라우저 밖에서 마우스를 놓치는 등으로 pointerup을
    // 못 받으면 e.buttons===0으로 알아채고 여기서 정리한다.
    if (e.buttons === 0) {
      resizeRef.current = null;
      setResizing(false);
      commitWidth();
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      return;
    }
    setWidth(state.startWidth + (e.clientX - state.startX));
  };

  const onResizePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (resizeRef.current?.pointerId !== e.pointerId) return;
    resizeRef.current = null;
    setResizing(false);
    commitWidth();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const pageNumbers = Array.from(
    { length: Math.max(0, visibleRange.end - visibleRange.start) },
    (_, i) => visibleRange.start + i,
  );

  return (
    <div
      className={`pdf-viewer-panel${entered ? ' is-open' : ''}${resizing ? ' is-resizing' : ''}`}
      style={{ width: entered ? width : 0 }}
    >
      <div className="pdf-viewer-header">
        <span className="pdf-viewer-title" title={panelRecord.name}>
          {panelRecord.name}
        </span>
        <button type="button" className="pdf-viewer-close" onClick={closeViewer} title="닫기" aria-label="닫기">
          <CloseIcon size={13} />
        </button>
      </div>

      <input
        ref={imageFileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleOverlayImageFileInputChange}
      />

      {/* 요구사항(2026-09): 기존 "Ctrl+스크롤로 확대했을 때만" 보이던
          .pdf-viewer-page-badge(줌 로직에 종속)를 삭제하고, 줌 여부와 무관하게 항상
          페이지 영역 바로 위 오른쪽에 현재 페이지/전체 페이지 수를 보여준다. */}
      <div className="pdf-viewer-page-indicator-row">
        <button
          type="button"
          className="pdf-viewer-page-nav"
          onClick={() => setCurrentPageIndex(currentPageIndex - 1)}
          disabled={currentPageIndex <= 0}
          title="이전 페이지"
          aria-label="이전 페이지"
        >
          <ChevronLeftIcon size={12} />
        </button>
        <span className="pdf-viewer-page-indicator">
          {currentPageIndex + 1} / {panelRecord.pageCount}
        </span>
        <button
          type="button"
          className="pdf-viewer-page-nav"
          onClick={() => setCurrentPageIndex(currentPageIndex + 1)}
          disabled={currentPageIndex >= panelRecord.pageCount - 1}
          title="다음 페이지"
          aria-label="다음 페이지"
        >
          <ChevronRightIcon size={12} />
        </button>
      </div>

      <div className="pdf-viewer-stage" ref={stageRef}>
        {stagePage && (
          <div
            className="pdf-viewer-page"
            ref={pageRef}
            style={{
              // 버그 수정(2026-08): width와 height를 둘 다 명시적 px로 주면 CSS
              // aspect-ratio가 무시된다(스펙상 aspect-ratio는 둘 중 하나가 auto일 때만
              // 쓰인다) — 그 상태로 .pdf-viewer-page의 max-width/max-height:100%가 가로/
              // 세로를 각각 독립적으로 clamp하면서 실제 페이지 비율과 어긋났고, 안의
              // <img>가 width:100%/height:100%라 그 어긋난 박스에 맞춰 늘어나 "세로로
              // 더 길어져 보이는" 왜곡이 생겼다. height는 지정하지 않고 aspect-ratio가
              // max-width/max-height와 함께 폭·높이를 동시에 맞물려 계산하게 두면(현대
              // 브라우저가 지원하는 표준 동작) 어느 쪽이 더 좁게 clamp되든 항상 원본
              // 비율이 유지된다.
              width: stagePage.width,
              aspectRatio: `${stagePage.width} / ${stagePage.height}`,
              // 요구사항(2026-09, Ctrl+스크롤 확대): pageZoom(usePdfViewerZoom.ts가
              // Ctrl+휠로 갱신)을 transform:scale로 적용한다. 레이아웃 폭/높이(위 width/
              // aspectRatio)는 그대로 두고 시각적으로만 확대하므로, getBoundingClientRect()
              // 로 실측하는 displayScale(PdfOverlayObjectsLayer.tsx)이 확대된 실제 크기를
              // 그대로 읽어 오버레이 글자/객체도 자연스럽게 같이 커진다. 1일 땐 scale(1)이라
              // 기존 동작과 완전히 동일하다.
              transform: `scale(${pageZoom})`,
            }}
          >
            <img src={stagePage.url} alt={`${panelRecord.name} ${currentPageIndex + 1}페이지`} draggable={false} />
            <PdfOverlayHighlightLayer pageWidth={stagePage.width} pageHeight={stagePage.height} />
            <PdfOverlayObjectsLayer pageWidth={stagePage.width} pageHeight={stagePage.height} />
            <PdfOverlayShapeDraftLayer pageWidth={stagePage.width} pageHeight={stagePage.height} />
            <PdfOverlayTextDraftLayer pageWidth={stagePage.width} pageHeight={stagePage.height} />
            <PdfOverlayLinkMarkersLayer pageWidth={stagePage.width} pageHeight={stagePage.height} />
          </div>
        )}
        {!stagePage && stageError && (
          <div className="pdf-viewer-stage-error">
            <p className="pdf-viewer-stage-error-title">이 페이지를 불러오지 못했습니다.</p>
            <p className="pdf-viewer-stage-error-detail">{stageError}</p>
          </div>
        )}
        {!stagePage && !stageError && stageLoading && <div className="pdf-viewer-stage-loading">불러오는 중…</div>}
      </div>

      <div className="pdf-viewer-filmstrip-row">
        <button
          type="button"
          className="pdf-viewer-filmstrip-nav"
          onClick={() => scrollFilmstripByGroup(-1)}
          title="이전 페이지 묶음"
          aria-label="이전 페이지 묶음"
        >
          <ChevronLeftIcon size={13} />
        </button>
        <div className="pdf-viewer-filmstrip" ref={filmstripRef} onScroll={recomputeVisibleRange}>
          <div
            className="pdf-viewer-filmstrip-track"
            style={{ width: panelRecord.pageCount * (THUMB_WIDTH + THUMB_GAP) - THUMB_GAP }}
          >
            {pageNumbers.map((pageIndex) => (
              <div
                key={pageIndex}
                className="pdf-viewer-thumb-slot"
                style={{ left: pageIndex * (THUMB_WIDTH + THUMB_GAP), width: THUMB_WIDTH }}
              >
                <PdfThumb
                  record={panelRecord}
                  pageIndex={pageIndex}
                  isActive={pageIndex === currentPageIndex}
                  hasAnnotations={isPageAnnotated(pageIndex)}
                  onSelect={setCurrentPageIndex}
                />
              </div>
            ))}
          </div>
        </div>
        <button
          type="button"
          className="pdf-viewer-filmstrip-nav"
          onClick={() => scrollFilmstripByGroup(1)}
          title="다음 페이지 묶음"
          aria-label="다음 페이지 묶음"
        >
          <ChevronRightIcon size={13} />
        </button>
      </div>

      <div
        className="pdf-viewer-resize-handle"
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={onResizePointerUp}
      />
    </div>
  );
}

