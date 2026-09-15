import { useEffect } from 'react';
import type { RefObject } from 'react';
import { useToolStore } from '../../store/toolStore';
import { useViewportStore } from '../../store/viewportStore';
import { useFileTreeStore } from '../../storage/fileTreeStore';
import { useLinkDraftStore } from '../../store/linkDraftStore';
import { useLinkStore } from '../../store/linkStore';
import { useObjectsStore } from '../../store/objectsStore';
import { clientToWorld } from '../../utils/coords';
import type { LinkAnchor } from '../../types/link';

/**
 * 🔗(링크) 도구 — 메인 캔버스 쪽(Phase 9). 요구사항 확정대로 드래그는 전혀 쓰지 않고
 * "우클릭 두 번"만 처리한다: 첫 우클릭이 출발지(source) anchor를 linkDraftStore에
 * 잠깐 담아두고, 두 번째 우클릭이 도착지(target) anchor와 묶어 실제 LinkRecord를
 * 만든 뒤 자동으로 '선택' 도구로 돌아간다(text/frame/image 같은 다른 1회용 도구와
 * 동일한 관례 — 다만 그 도구들과 달리 "완료"까지 클릭이 두 번 필요하다는 점만 다르다).
 *
 * 요구사항 변경(2026-09-15, 좌클릭→우클릭): 기존엔 좌클릭 한 번으로 바로 anchor가
 * 찍혔는데, "링크를 만들기 전에 화면 위치를 옮겨야 하는 경우"(Space+마우스 드래그로
 * pan)와 겹쳐서 문제가 있었다 — pan은 Space를 누른 채 좌클릭 드래그로 동작하는데
 * (canvas/viewport/usePan.ts), 브라우저는 pointerdown에서 preventDefault를 해도
 * 마우스 포인터에 한해서는 그 뒤 native mousedown/mouseup/click을 그대로 발생시킨다
 * (터치의 "호환 이벤트 억제"와 달리 마우스는 억제되지 않음) — 그래서 pan을 위해
 * Space+좌클릭 드래그를 하고 손을 뗄 때마다 이 도구가 그 자리를 링크 anchor로 잘못
 * 찍어버렸다. 우클릭으로 바꾸면 pan 트리거(좌클릭/중클릭)와 겹치지 않으므로, 먼저
 * Space+좌클릭 드래그로 원하는 위치까지 화면을 옮긴 뒤 우클릭으로 링크를 놓는 흐름이
 * 항상 안전하다.
 *
 * canvas/pdf/useOverlayLinkTool.ts와 linkDraftStore(store/linkDraftStore.ts) 하나를
 * 공유한다 — 그래야 "메인 캔버스에서 첫 우클릭 → PDF 안에서 두 번째 우클릭"처럼 서로
 * 다른 surface를 잇는 링크(Page↔PDF)도 자연스럽게 만들어진다.
 *
 * 히트테스트는 useDrawTextTool.ts와 완전히 같은 규칙을 그대로 따른다: 캔버스 배경
 * 자신(target===el), Frame의 빈 표면(data-shape-drawable), 기존 객체(data-object-id)
 * 위에서만 반응한다 — Toolbar/PropertiesPanel/PdfLibraryRail처럼 canvas-root 안에 함께
 * 떠 있는 UI chrome을 우클릭했을 때는 이 셋 중 어디에도 해당하지 않아 자연히 걸러진다
 * (별도의 stopPropagation/제외 목록이 필요 없다). Frame의 빈 표면을 우클릭해도
 * data-object-id를 가진 바깥 ObjectView wrapper가 먼저 closest에 잡히므로, 결과적으로
 * "Frame 위 어디를 우클릭하든 그 Frame 자체가 objectId로 잡힌다" — Frame도 필기 객체
 * 중 하나이므로 의도한 동작이다(요구사항: 객체가 있으면 그 객체와 연결).
 *
 * 링크 도구 활성화 중에는 canvas/interaction/useObjectDrag.ts가 자신의 onPointerDown
 * 맨 앞에서 즉시 return하므로(tool==='link' 가드 추가분) 기존 객체 드래그/선택이
 * 전혀 끼어들지 않고, stopPropagation도 하지 않아 이 이벤트가 그대로 컨테이너까지
 * 버블링된다. objects/ObjectView.tsx의 handleContextMenu도 activeTool==='link'일
 * 때는 스스로 아무 것도 하지 않도록 가드해뒀다(그 파일 주석 참고) — 그렇지 않으면
 * 객체를 우클릭할 때마다 이 링크 anchor 지정과 "객체 우클릭 메뉴"가 동시에 열린다.
 */
export function useLinkTool(containerRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleContextMenu = (e: MouseEvent) => {
      if (useToolStore.getState().activeTool !== 'link') return;
      const target = e.target as HTMLElement;
      if (target !== el && !target.closest('[data-shape-drawable="true"]') && !target.closest('[data-object-id]')) return;
      // 링크 마커 자신(canvas/LinkMarkersLayer.tsx)을 우클릭한 경우는 여기서 걸러내야
      // 한다 — 그 컴포넌트의 onContextMenu가 부르는 e.stopPropagation()은 React 합성
      // 이벤트 체계 안에서만 유효하고, 이 훅처럼 DOM에 직접 addEventListener한
      // 리스너는 React의 합성 dispatch보다 먼저(네이티브 버블링 단계에서 곧바로)
      // 실행되므로 stopPropagation의 영향을 받지 않는다. 그래서 "마커 자신 위의
      // 우클릭이면 이 도구는 아예 아무 것도 하지 않는다"를 이 data-* 검사로 직접
      // 보장한다(마커 쪽은 우클릭 시 그 링크를 선택하는 자기 자신의 동작을 그대로
      // 수행한다).
      if (target.closest('[data-link-marker]')) return;
      // 브라우저/OS 기본 우클릭 메뉴가 뜨지 않도록 막는다 — activeTool==='link'일
      // 때만 막으므로, 다른 도구에서는 기존 우클릭 메뉴(객체 컨텍스트 메뉴 등)가
      // 평소처럼 그대로 동작한다.
      e.preventDefault();

      const currentPageId = useFileTreeStore.getState().currentPageId;
      if (!currentPageId) return;

      const objectId = target.closest('[data-object-id]')?.getAttribute('data-object-id') ?? null;
      const world = clientToWorld({ x: e.clientX, y: e.clientY }, useViewportStore.getState());
      // 버그 수정(2026-09-12): objectId가 잡히면 그 객체의 "지금"(=클릭 시점) 원점을
      // anchorObjectX/Y로 같이 남긴다 — utils/linkAnchor.ts의 resolveAnchorPosition이
      // 이 값과 world.x/y의 차이로 "객체 안에서 클릭한 상대 위치"를 구한다. 텍스트
      // 상자처럼 하나의 objectId 안에서 어디를 클릭해도 같은 id가 잡히는 경우에도,
      // 이 오프셋 덕분에 마커가 실제 클릭 지점에 정확히 나타난다.
      const targetObject = objectId ? useObjectsStore.getState().objects[objectId] : undefined;
      const anchor: LinkAnchor = {
        surface: 'page',
        pageId: currentPageId,
        objectId,
        x: world.x,
        y: world.y,
        ...(targetObject ? { anchorObjectX: targetObject.x, anchorObjectY: targetObject.y } : {}),
      };

      const pending = useLinkDraftStore.getState().pending;
      if (!pending) {
        useLinkDraftStore.getState().setPending(anchor);
        return;
      }
      useLinkDraftStore.getState().clear();
      void useLinkStore.getState().addLink(pending, anchor);
      useToolStore.getState().setTool('select');
    };

    el.addEventListener('contextmenu', handleContextMenu);
    return () => el.removeEventListener('contextmenu', handleContextMenu);
  }, [containerRef]);
}
