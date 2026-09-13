import { useEffect } from 'react';
import { Canvas } from './canvas/Canvas';
import { FileTreePanel } from './canvas/sidebar/FileTreePanel';
import { useFileTreeStore } from './storage/fileTreeStore';
import { useLinkStore } from './store/linkStore';

/**
 * Phase 8: 앱이 뜨면 가장 먼저 fileTreeStore.init()으로 IndexedDB에서 File/Page
 * 트리를 불러오고, 마지막으로 열려 있던(또는 최초 실행이면 새로 만든 기본) Page를
 * 연다. 그 로딩이 끝나기 전까지는 Canvas를 아예 렌더링하지 않는다 — 빈 objects나
 * 데모 콘텐츠가 잠깐 보였다가 실제 데이터로 바뀌는 깜빡임을 막기 위해서다.
 */
function App() {
  const loaded = useFileTreeStore((s) => s.loaded);
  const currentPageId = useFileTreeStore((s) => s.currentPageId);

  useEffect(() => {
    void useFileTreeStore.getState().init();
    // 요구사항(내부 하이퍼링크, Phase 9): 링크는 store/linkStore.ts 주석대로 Page
    // 단위로 지연 로딩하지 않고 앱이 뜰 때 전체를 한 번에 불러온다 — fileTreeStore.init()과
    // 독립적인 별개의 로딩이라(서로 기다릴 필요 없음) 그냥 나란히 fire-and-forget으로
    // 시작한다.
    void useLinkStore.getState().loadAll();
  }, []);

  const isReady = loaded && currentPageId !== null;

  return (
    <div className="app-shell">
      <FileTreePanel />
      {isReady ? (
        <Canvas />
      ) : (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            left: 'var(--file-tree-width, 240px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'system-ui, sans-serif',
            color: '#9a9a9a',
            fontSize: 14,
          }}
        >
          불러오는 중…
        </div>
      )}
    </div>
  );
}

export default App;
