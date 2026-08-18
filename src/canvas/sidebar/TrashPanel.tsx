import { useFileTreeStore } from '../../storage/fileTreeStore';
import { useFileTreeUiStore } from './fileTreeUiStore';
import { CloseIcon, FolderIcon, PageIcon } from '../../icons/Icons';

/**
 * 요구사항(휴지통): fileTreeStore.deleteFile/deletePage는 더 이상 즉시 영구 삭제하지
 * 않고 deletedAt만 찍는다(소프트 삭제) — 이 패널은 그렇게 트래시로 보내진 File/Page를
 * 모아 보여주고, 복원(원래 위치로) 또는 영구 삭제(복구 불가, cascade)를 고른다.
 *
 * 목록에는 "자기 자신이 직접 트래시된" 최상위 항목만 나온다 — 트래시된 폴더 안의
 * Page/하위 File은 자기 deletedAt이 없으므로(조상만 트래시됨, fileTreeStore.ts 참고)
 * 여기 따로 나오지 않는다. 그 폴더 하나를 복원/영구삭제하면 안의 내용 전부가 함께
 * 복원/삭제된다 — 탐색기/Finder 휴지통과 같은 관례.
 */
export function TrashPanel() {
  const files = useFileTreeStore((s) => s.files);
  const pages = useFileTreeStore((s) => s.pages);
  const restoreFile = useFileTreeStore((s) => s.restoreFile);
  const restorePage = useFileTreeStore((s) => s.restorePage);
  const permanentlyDeleteFile = useFileTreeStore((s) => s.permanentlyDeleteFile);
  const permanentlyDeletePage = useFileTreeStore((s) => s.permanentlyDeletePage);
  const emptyTrash = useFileTreeStore((s) => s.emptyTrash);
  const closeTrash = useFileTreeUiStore((s) => s.closeTrash);

  const trashedFiles = Object.values(files)
    .filter((f) => f.deletedAt)
    .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
  const trashedPages = Object.values(pages)
    .filter((p) => p.deletedAt)
    .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
  const isEmpty = trashedFiles.length === 0 && trashedPages.length === 0;

  const formatDate = (ts?: number) => (ts ? new Date(ts).toLocaleString() : '');

  return (
    <div className="trash-panel-overlay" onClick={closeTrash}>
      <div className="trash-panel" onClick={(e) => e.stopPropagation()}>
        <div className="trash-panel-header">
          <span>휴지통</span>
          <button type="button" className="trash-panel-close" onClick={closeTrash} aria-label="닫기">
            <CloseIcon size={14} />
          </button>
        </div>

        <div className="trash-panel-list">
          {isEmpty && <div className="trash-panel-empty">휴지통이 비어 있습니다</div>}

          {trashedFiles.map((file) => (
            <div key={file.id} className="trash-panel-row">
              <span className="trash-panel-row-icon" aria-hidden>
                <FolderIcon />
              </span>
              <div className="trash-panel-row-info">
                <span className="trash-panel-row-name">{file.name}</span>
                <span className="trash-panel-row-date">{formatDate(file.deletedAt)}</span>
              </div>
              <div className="trash-panel-row-actions">
                <button type="button" onClick={() => void restoreFile(file.id)}>
                  복원
                </button>
                <button
                  type="button"
                  className="is-danger"
                  onClick={() => {
                    if (window.confirm(`"${file.name}"과 그 안의 모든 내용을 영구 삭제할까요? 되돌릴 수 없습니다.`)) {
                      void permanentlyDeleteFile(file.id);
                    }
                  }}
                >
                  영구 삭제
                </button>
              </div>
            </div>
          ))}

          {trashedPages.map((page) => (
            <div key={page.id} className="trash-panel-row">
              <span className="trash-panel-row-icon" aria-hidden>
                <PageIcon />
              </span>
              <div className="trash-panel-row-info">
                <span className="trash-panel-row-name">{page.name}</span>
                <span className="trash-panel-row-date">{formatDate(page.deletedAt)}</span>
              </div>
              <div className="trash-panel-row-actions">
                <button type="button" onClick={() => void restorePage(page.id)}>
                  복원
                </button>
                <button
                  type="button"
                  className="is-danger"
                  onClick={() => {
                    if (window.confirm(`"${page.name}" 페이지를 영구 삭제할까요? 되돌릴 수 없습니다.`)) {
                      void permanentlyDeletePage(page.id);
                    }
                  }}
                >
                  영구 삭제
                </button>
              </div>
            </div>
          ))}
        </div>

        {!isEmpty && (
          <div className="trash-panel-footer">
            <button
              type="button"
              className="is-danger"
              onClick={() => {
                if (window.confirm('휴지통을 완전히 비울까요? 되돌릴 수 없습니다.')) {
                  void emptyTrash();
                }
              }}
            >
              휴지통 비우기
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
