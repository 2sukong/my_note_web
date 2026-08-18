import { useEffect, useMemo, useRef } from 'react';
import { useCanvasSearchStore } from '../store/canvasSearchStore';
import { useObjectsStore } from '../store/objectsStore';
import { useViewportStore } from '../store/viewportStore';
import { useInteractionStore } from '../store/interactionStore';
import { useFileTreeUiStore, FILE_TREE_EXPANDED_WIDTH, FILE_TREE_COLLAPSED_WIDTH } from './sidebar/fileTreeUiStore';
import { useFileTreeStore } from '../storage/fileTreeStore';
import { lineText } from '../objects/text/indentation/types';
import type { CanvasObject } from '../types/object';
import { FrameToolIcon, SearchIcon, TextToolIcon } from '../icons/Icons';

interface SearchResult {
  objectId: string;
  kind: 'frame' | 'text';
  /** 결과 목록에 보여줄 제목(프레임 이름, 또는 텍스트 첫 줄 등). */
  title: string;
  /** 매치된 부분을 보여주는 짧은 미리보기(텍스트만 — 프레임은 이름 자체가 제목이라 없음). */
  snippet?: string;
}

const MAX_RESULTS = 30;

function buildResults(objects: Record<string, CanvasObject>, query: string): SearchResult[] {
  const lower = query.trim().toLowerCase();
  if (!lower) return [];
  const results: SearchResult[] = [];

  for (const obj of Object.values(objects)) {
    if (obj.type === 'frame') {
      if (obj.label && obj.label.toLowerCase().includes(lower)) {
        results.push({ objectId: obj.id, kind: 'frame', title: obj.label });
      }
    } else if (obj.type === 'text') {
      const fullText = obj.lines.map((line) => lineText(line)).join('\n');
      const lowerText = fullText.toLowerCase();
      const idx = lowerText.indexOf(lower);
      if (idx !== -1) {
        // 매치 지점 앞뒤로 짧게 잘라서 미리보기로 보여준다.
        const start = Math.max(0, idx - 12);
        const end = Math.min(fullText.length, idx + lower.length + 20);
        const snippet = `${start > 0 ? '…' : ''}${fullText.slice(start, end).replace(/\n/g, ' ')}${end < fullText.length ? '…' : ''}`;
        const firstLine = fullText.split('\n').find((l) => l.trim().length > 0) ?? '(빈 텍스트)';
        results.push({ objectId: obj.id, kind: 'text', title: firstLine.slice(0, 24), snippet });
      }
    }
    if (results.length >= MAX_RESULTS) break;
  }

  return results;
}

/**
 * 요구사항(찾기): 지금 열려 있는 Page 안에서 Frame 이름/Text 내용을 검색하고,
 * 결과를 클릭하면 그 객체가 화면 중앙에 오도록 뷰포트를 이동 + 선택한다(줌은 그대로
 * 유지 — "찾아서 눈에 띄게 보여준다"가 목적이라 굳이 줌까지 바꾸지 않는다).
 * 위치는 예전 canvas-hud가 있던 자리(사이드바 바로 오른쪽 위)를 재사용한다.
 */
export function CanvasSearch() {
  const isOpen = useCanvasSearchStore((s) => s.isOpen);
  const query = useCanvasSearchStore((s) => s.query);
  const toggle = useCanvasSearchStore((s) => s.toggle);
  const close = useCanvasSearchStore((s) => s.close);
  const setQuery = useCanvasSearchStore((s) => s.setQuery);
  const objects = useObjectsStore((s) => s.objects);
  const isSidebarCollapsed = useFileTreeUiStore((s) => s.isCollapsed);
  const currentPageId = useFileTreeStore((s) => s.currentPageId);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => buildResults(objects, query), [objects, query]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  // 요구사항(찾기, 페이지 범위): 검색은 "지금 열려 있는 Page 안에서"만 유효하다 —
  // Canvas.tsx는 Page를 전환해도 언마운트되지 않으므로, Page가 바뀌면 이 검색
  // 패널도 닫고 검색어를 비운다(다른 Page의 결과가 그대로 남아있는 걸 방지).
  useEffect(() => {
    useCanvasSearchStore.getState().close();
  }, [currentPageId]);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isOpen, close]);

  const jumpTo = (objectId: string) => {
    const object = useObjectsStore.getState().objects[objectId];
    if (!object) return;
    const { zoom } = useViewportStore.getState();
    const sidebarWidth = isSidebarCollapsed ? FILE_TREE_COLLAPSED_WIDTH : FILE_TREE_EXPANDED_WIDTH;
    const visibleWidth = window.innerWidth - sidebarWidth;
    const visibleHeight = window.innerHeight;
    const centerX = object.x + object.width / 2;
    const centerY = object.y + object.height / 2;
    useViewportStore.getState().setViewport({
      zoom,
      panX: visibleWidth / 2 - centerX * zoom,
      panY: visibleHeight / 2 - centerY * zoom,
    });
    useInteractionStore.getState().select(objectId);
  };

  return (
    <div ref={ref} className="canvas-search">
      <button
        type="button"
        className={isOpen ? 'canvas-search-toggle is-active' : 'canvas-search-toggle'}
        onClick={toggle}
        title="이 페이지에서 찾기(프레임 이름·텍스트)"
        aria-label="이 페이지에서 찾기"
      >
        <SearchIcon size={15} />
      </button>
      {isOpen && (
        <div className="canvas-search-panel">
          <input
            ref={inputRef}
            type="text"
            className="canvas-search-input"
            placeholder="프레임 이름·텍스트 찾기"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close();
            }}
          />
          {query.trim() && (
            <div className="canvas-search-results">
              {results.length === 0 ? (
                <div className="canvas-search-empty">검색 결과가 없습니다</div>
              ) : (
                results.map((r) => (
                  <button
                    key={`${r.kind}-${r.objectId}`}
                    type="button"
                    className="canvas-search-result"
                    onClick={() => jumpTo(r.objectId)}
                  >
                    <span className="canvas-search-result-icon" aria-hidden>
                      {r.kind === 'frame' ? <FrameToolIcon size={13} /> : <TextToolIcon size={13} />}
                    </span>
                    <span className="canvas-search-result-body">
                      <span className="canvas-search-result-title">{r.title}</span>
                      {r.snippet && <span className="canvas-search-result-snippet">{r.snippet}</span>}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
