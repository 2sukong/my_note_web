import { Fragment, useEffect, useRef, useState } from 'react';
import { useFileTreeStore } from '../../storage/fileTreeStore';
import { usePdfLibraryStore } from '../../store/pdfLibraryStore';
import { usePdfViewerStore, consumeSuppressNextAutoClose } from '../../store/pdfViewerStore';
import { usePdfLibraryDragStore } from './pdfLibraryDragStore';
import { PdfFileIcon, PlusIcon } from '../../icons/Icons';
import './PdfLibraryRail.css';

const PDF_ACCEPT = 'application/pdf,.pdf';
/** 드래그 중인 PDF 항목을 dataTransfer에 담을 때 쓰는 커스텀 MIME 타입.
 * FileTreePanel.tsx의 DND_MIME과는 다른 값을 써서(값 자체가 아니라 항목 id만
 * 담으면 되므로 JSON도 필요 없다) File/Page 드래그와 서로 섞이지 않게 한다. */
const PDF_DND_MIME = 'application/x-my-note-web-pdf-item';

/** 요구사항(2026-09-15): 순서 변경 미리보기 — FileTreePanel.tsx의 DropGapLine과
 * 완전히 같은 방식(실제로 목록 사이에 끼워 넣는, 높이가 있는 엘리먼트라 다른
 * 항목들이 진짜로 자리를 비켜준다)이다. 그쪽 컴포넌트가 export돼 있지 않고
 * PDF Library는 File/Page 트리와 무관한 별개 기능이라 작게 복제해 둔다(같은
 * 시각적 스타일은 PdfLibraryRail.css의 클래스로 재현). */
function PdfLibraryDropGapLine() {
  return (
    <div className="pdf-library-drop-gap" aria-hidden>
      <div className="pdf-library-drop-gap-line" />
    </div>
  );
}

/** 이름 변경용 인라인 입력. FileTreePanel.tsx의 InlineNameInput과 같은 관례(Enter/blur
 * 확정, Escape 취소)지만, 그쪽은 파일 트리 전용으로 export돼 있지 않아 그대로 가져다
 * 쓸 수 없다 — PDF Library는 File/Page 트리와 무관한 별개 기능이라 작게 복제해 둔다. */
function RenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <input
      ref={inputRef}
      className="pdf-library-rename-input"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          const trimmed = value.trim();
          onCommit(trimmed.length > 0 ? trimmed : initial);
        } else if (e.key === 'Escape') {
          onCancel();
        }
      }}
      onBlur={() => {
        const trimmed = value.trim();
        onCommit(trimmed.length > 0 ? trimmed : initial);
      }}
    />
  );
}

interface ContextMenuState {
  id: string;
  x: number;
  y: number;
}

/**
 * 좌측 사이드바 바로 오른쪽, 돋보기(CanvasSearch) 토글 아래에 배치되는 PDF Library
 * 레일(v2/v3 §PDF Library). 데이터 소속은 **Page 단위**라(v3 §1-1 확정) 지금 열려
 * 있는 Page에 종속된 PDF만 보여준다 — Page를 전환하면 목록도 그 Page 것으로 바뀐다.
 *
 * PDF 자체는 더 이상 Canvas 객체가 아니므로(v3 §1-2 확정) 선택/라벨 UI가 없다 — 클릭하면
 * pdfViewerStore를 통해 Viewer가 열릴 뿐이고, 이 레일 자체의 책임은 "목록 표시 + 가져오기
 * + 이름변경/삭제"로 끝난다. 실제 Viewer 패널(페이지 탐색 등)은 Phase 5에서 별도로 만든다.
 *
 * [2026-09-07 개정, 요구사항] PDF마다 아이콘 하나씩 세로로 쌓이던 목록을 없애고, 아이콘
 * 하나로 통합했다: 클릭하면 예전 '+' 버튼과 동일하게 바로 파일 선택 창이 뜨고, hover하면
 * '새로 가져오기' + 저장된 PDF 제목 목록이 오른쪽에 플라이아웃으로 뜬다. 이름변경/삭제는
 * 목록 항목을 우클릭하는 기존 방식 그대로 유지한다. 플라이아웃은 순수 CSS :hover가 아니라
 * JS 상태(flyoutOpen)로 열고 닫는다 — 이름변경 입력창이나 우클릭 메뉴가 떠 있는 동안
 * 마우스가 아이콘/플라이아웃 밖으로 나가도 플라이아웃이 사라지면 안 되기 때문이다
 * (renamingId/contextMenu가 있으면 hover 여부와 무관하게 계속 보이도록 OR로 묶는다).
 */
export function PdfLibraryRail() {
  const currentPageId = useFileTreeStore((s) => s.currentPageId);
  const entries = usePdfLibraryStore((s) => s.entries);
  const loadForPage = usePdfLibraryStore((s) => s.loadForPage);
  const importPdf = usePdfLibraryStore((s) => s.importPdf);
  const renamePdf = usePdfLibraryStore((s) => s.renamePdf);
  const removePdf = usePdfLibraryStore((s) => s.removePdf);
  const reorderPdf = usePdfLibraryStore((s) => s.reorderPdf);
  const openPdfId = usePdfViewerStore((s) => s.openPdfId);
  const openViewer = usePdfViewerStore((s) => s.openViewer);
  // 요구사항(2026-09-15, 라이브러리 드래그 순서 변경): 이 목록도 File/Page 트리와
  // 같은 "자리를 비켜주는" 드롭 미리보기를 쓴다 — 실제 목표는 fileTreeDragStore와
  // 같은 이유로 전역 store 하나에만 쓰고, 여기서는 그 값을 구독만 한다.
  const draggingId = usePdfLibraryDragStore((s) => s.draggingId);
  const dropBeforeId = usePdfLibraryDragStore((s) => s.dropBeforeId);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [hoverOpen, setHoverOpen] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // 드래그 중에는 마우스가 아이콘/플라이아웃 밖(다른 항목 위 등)으로 나가도 플라이아웃이
  // 사라지면 안 된다 — renamingId/contextMenu와 같은 이유로 OR에 추가한다.
  const flyoutOpen = hoverOpen || renamingId !== null || contextMenu !== null || draggingId !== null;

  // Page를 전환하면 그 Page에 속한 PDF 목록을 새로 불러온다. CanvasSearch.tsx가
  // currentPageId 변경 시 검색 패널을 닫는 것과 같은 이유로, 다른 Page의 PDF를 보여주던
  // Viewer가 열려 있었다면 같이 닫는다(Library 소속 자체가 Page 단위이므로, Page를
  // 벗어난 순간 그 Viewer가 가리키던 PDF는 더 이상 "지금 화면"의 것이 아니다).
  //
  // 요구사항(내부 하이퍼링크, Phase 9): 단, store/linkNavigationStore.ts가 Page→PDF
  // 링크를 따라 "이 Page를 연 직후 곧바로 그 PDF의 Viewer를 다시 연다"고 미리 표시해둔
  // 경우(markSuppressNextAutoClose)는 예외다 — 표시가 없을 때와 완전히 동일하게
  // loadForPage는 그대로 부르되(이 Page의 PDF 목록 자체는 항상 최신이어야 하므로),
  // closeViewer만 이번 한 번 건너뛴다. consumeSuppressNextAutoClose가 플래그를 읽는 즉시
  // 꺼버리므로(1회성) 그다음 Page 전환부터는 원래 동작으로 자동 복귀한다.
  useEffect(() => {
    if (currentPageId) void loadForPage(currentPageId);
    if (!consumeSuppressNextAutoClose()) {
      usePdfViewerStore.getState().closeViewer();
    }
    setRenamingId(null);
    setContextMenu(null);
    setHoverOpen(false);
  }, [currentPageId, loadForPage]);

  useEffect(() => {
    if (!contextMenu) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setContextMenu(null);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [contextMenu]);

  useEffect(() => {
    if (!importError) return;
    const timer = window.setTimeout(() => setImportError(null), 3000);
    return () => window.clearTimeout(timer);
  }, [importError]);

  if (!currentPageId) return null;

  const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 같은 파일을 연달아 선택할 수 있도록 초기화
    if (!file) return;
    const looksLikePdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (!looksLikePdf) {
      setImportError('PDF 파일만 가져올 수 있습니다.');
      return;
    }
    void importPdf(currentPageId, file)
      .then((record) => openViewer(record.id, record.lastViewedPageIndex ?? 0))
      .catch(() => setImportError('PDF를 가져오지 못했습니다.'));
  };

  const handleDelete = (id: string) => {
    setContextMenu(null);
    if (!window.confirm('이 PDF를 삭제할까요? 이 PDF 위에 작성한 필기도 함께 삭제됩니다.')) return;
    if (openPdfId === id) usePdfViewerStore.getState().closeViewer();
    void removePdf(id);
  };

  return (
    <div className="pdf-library-rail">
      {/* 요구사항(2026-09-07): 우클릭하면 Chrome 기본 우클릭 메뉴가 떠서 우리 플라이아웃을
          가리는 문제가 있었다 — 이 아이콘/버튼 자체엔 우클릭으로 할 일이 없으므로
          (기존 PDF 각 항목의 이름변경/삭제 우클릭 메뉴와는 별개) onContextMenu를
          preventDefault해서 브라우저 기본 메뉴 자체가 뜨지 않게 막는다. */}
      <div
        className="pdf-library-icon-menu"
        onMouseEnter={() => setHoverOpen(true)}
        onMouseLeave={() => setHoverOpen(false)}
        onContextMenu={(e) => e.preventDefault()}
      >
        <button
          type="button"
          className={openPdfId ? 'pdf-library-add is-open' : 'pdf-library-add'}
          onClick={() => fileInputRef.current?.click()}
          title="PDF 가져오기"
          aria-label="PDF 가져오기 / 저장된 PDF 목록 보기"
        >
          <PdfFileIcon size={16} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept={PDF_ACCEPT}
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />

        {flyoutOpen && (
          <div className="pdf-library-flyout">
            <button type="button" className="pdf-library-flyout-item" onClick={() => fileInputRef.current?.click()}>
              <PlusIcon size={13} />
              <span>새로 가져오기</span>
            </button>
            {entries.length > 0 && (
              <>
                <div className="pdf-library-flyout-divider" />
                <div
                  className="pdf-library-flyout-list"
                  onDragOver={(e) => {
                    if (!e.dataTransfer.types.includes(PDF_DND_MIME)) return;
                    e.preventDefault();
                    // 이 핸들러는 아래 각 항목이 stopPropagation()하지 않은 경우에만
                    // 실행된다 — 즉 어떤 특정 항목 위도 아닌 "빈 공간"(목록 맨 끝
                    // 아래) 위에 있다는 뜻이므로, FileTreePanel.tsx의 목록 레벨
                    // onDragOver와 같은 이유로 "맨 끝"으로 해석한다.
                    if (usePdfLibraryDragStore.getState().draggingId) {
                      usePdfLibraryDragStore.getState().setDropTarget(null);
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const draggedId = e.dataTransfer.getData(PDF_DND_MIME);
                    const target = usePdfLibraryDragStore.getState().dropBeforeId;
                    if (draggedId && target !== undefined) {
                      void reorderPdf(draggedId, target);
                    }
                    usePdfLibraryDragStore.getState().endDrag();
                  }}
                >
                  {entries.map((entry, index) => (
                    <Fragment key={entry.id}>
                      {dropBeforeId === entry.id && <PdfLibraryDropGapLine />}
                      {renamingId === entry.id ? (
                        <div className="pdf-library-flyout-rename-wrap">
                          <RenameInput
                            initial={entry.name}
                            onCommit={(name) => {
                              setRenamingId(null);
                              if (name !== entry.name) void renamePdf(entry.id, name);
                            }}
                            onCancel={() => setRenamingId(null)}
                          />
                        </div>
                      ) : (
                        <button
                          type="button"
                          className={entry.id === openPdfId ? 'pdf-library-flyout-item is-open' : 'pdf-library-flyout-item'}
                          draggable
                          onDragStart={(e) => {
                            usePdfLibraryDragStore.getState().startDrag(entry.id);
                            e.dataTransfer.setData(PDF_DND_MIME, entry.id);
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                          onDragEnd={() => usePdfLibraryDragStore.getState().endDrag()}
                          onDragOver={(e) => {
                            const drag = usePdfLibraryDragStore.getState();
                            if (!drag.draggingId || !e.dataTransfer.types.includes(PDF_DND_MIME)) return;
                            e.preventDefault();
                            // 요구사항(다른 항목 겹칠 시 목표를 덮어쓰지 않기): FileTreePanel의
                            // 행 onDragOver와 같은 이유로, 판정을 이 항목에서 끝내고 바깥
                            // (목록 컨테이너)으로 더는 안 번지게 한다.
                            e.stopPropagation();
                            if (drag.draggingId === entry.id) return; // 자기 자신 위에서는 갱신 안 함.
                            const rect = e.currentTarget.getBoundingClientRect();
                            if (e.clientY < rect.top + rect.height / 2) {
                              drag.setDropTarget(entry.id);
                            } else {
                              const next = entries[index + 1];
                              drag.setDropTarget(next ? next.id : null);
                            }
                          }}
                          onClick={() => openViewer(entry.id, entry.lastViewedPageIndex ?? 0)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setContextMenu({ id: entry.id, x: e.clientX, y: e.clientY });
                          }}
                          title={entry.name}
                        >
                          <PdfFileIcon size={13} />
                          <span className="pdf-library-flyout-item-name">{entry.name}</span>
                        </button>
                      )}
                    </Fragment>
                  ))}
                  {draggingId && dropBeforeId === null && <PdfLibraryDropGapLine />}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {importError && <div className="pdf-library-error">{importError}</div>}

      {contextMenu && (
        <div ref={menuRef} className="object-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <button
            type="button"
            onClick={() => {
              setRenamingId(contextMenu.id);
              setContextMenu(null);
            }}
          >
            이름 변경
          </button>
          <button type="button" onClick={() => handleDelete(contextMenu.id)}>
            삭제
          </button>
        </div>
      )}
    </div>
  );
}
