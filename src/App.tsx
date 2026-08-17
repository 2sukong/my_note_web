import { useEffect } from 'react';
import { Canvas } from './canvas/Canvas';
import { FileTreePanel } from './canvas/sidebar/FileTreePanel';
import { useFileTreeStore } from './storage/fileTreeStore';

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
            color: '#888',
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
