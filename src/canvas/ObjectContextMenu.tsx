import { useEffect, useRef } from 'react';
import { useObjectContextMenuStore } from '../store/objectContextMenuStore';
import { useObjectsStore } from '../store/objectsStore';

/**
 * 요구사항(우클릭 쌓임 순서 메뉴): 모든 캔버스 객체(Text/Image/Frame/Arrow/Rectangle)를
 * 우클릭하면 뜨는 쌓임 순서(z-index) 메뉴 — 앞으로/뒤로 한 칸, 맨 앞/맨 뒤로.
 * canvas/sidebar/FileTreePanel.tsx의 ContextMenu와 완전히 같은 패턴(고정 위치 팝업,
 * 바깥 pointerdown으로 닫힘)이고, 대상 객체가 무엇이든 옵션 4개가 항상 동일해서
 * FileTreePanel처럼 kind별 분기가 필요 없다. ObjectView.tsx가 모든 객체 타입에
 * 공통으로 onContextMenu를 붙여주므로 이 메뉴 하나로 전부 커버된다.
 */
export function ObjectContextMenu() {
  const menu = useObjectContextMenuStore((s) => s.menu);
  const close = useObjectContextMenuStore((s) => s.close);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [menu, close]);

  if (!menu) return null;

  const { objectId } = menu;
  const items: Array<{ label: string; onClick: () => void }> = [
    { label: '맨 앞으로 가져오기', onClick: () => useObjectsStore.getState().bringToFront(objectId) },
    { label: '앞으로 가져오기', onClick: () => useObjectsStore.getState().bringForward(objectId) },
    { label: '뒤로 보내기', onClick: () => useObjectsStore.getState().sendBackward(objectId) },
    { label: '맨 뒤로 보내기', onClick: () => useObjectsStore.getState().sendToBack(objectId) },
  ];

  return (
    <div ref={ref} className="object-context-menu" style={{ left: menu.x, top: menu.y }}>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          onClick={() => {
            item.onClick();
            close();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
