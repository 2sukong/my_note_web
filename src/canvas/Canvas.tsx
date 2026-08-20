import { useEffect, useMemo, useRef } from 'react';
import { useViewportStore } from '../store/viewportStore';
import { useObjectsStore } from '../store/objectsStore';
import { useInteractionStore } from '../store/interactionStore';
import { useToolStore } from '../store/toolStore';
import { useImagePickerStore } from '../store/imagePickerStore';
import { useFontStore } from '../store/fontStore';
import { useWheelZoom } from './viewport/useWheelZoom';
import { usePan } from './viewport/usePan';
import { useTextSelectionTools } from './interaction/useTextSelectionTools';
import { useImageHighlightTool } from './interaction/useImageHighlightTool';
import { useObjectDeleteShortcut } from './interaction/useObjectDeleteShortcut';
import { useImagePaste } from './interaction/useImagePaste';
import { useTextPaste } from './interaction/useTextPaste';
import { useDrawShapeTool } from './interaction/useDrawShapeTool';
import { useDrawTextTool } from './interaction/useDrawTextTool';
import { useMarqueeSelect } from './interaction/useMarqueeSelect';
import { useUndoRedoShortcut } from './interaction/useUndoRedoShortcut';
import { useClipboardShortcuts } from './interaction/useClipboardShortcuts';
import { useGroupShortcut } from './interaction/useGroupShortcut';
import { clientToWorld, registerCanvasContainer } from '../utils/coords';
import { spawnFrameAt, spawnImageAt, findFrameAt } from './actions';
import { ObjectView } from '../objects/ObjectView';
import { SelectionOverlay } from './SelectionOverlay';
import { MarqueeOverlay } from './MarqueeOverlay';
import { ObjectContextMenu } from './ObjectContextMenu';
import { Toolbar } from './Toolbar';
import { DrawPreview } from './DrawPreview';
import { HighlightDragPreview } from './HighlightDragPreview';
import { TextRangeSelectionOverlay } from './TextRangeSelectionOverlay';
import { ImageCropOverlay } from './ImageCropOverlay';
import { AlignmentGuideOverlay } from './AlignmentGuideOverlay';
import { PropertiesPanel } from './PropertiesPanel';
import { CanvasSearch } from './CanvasSearch';
import './Canvas.css';

const GRID_SIZE = 40; // world 단위. zoom에 따라 화면상 픽셀 크기가 변한다.

export function Canvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const zoom = useViewportStore((s) => s.zoom);
  const panX = useViewportStore((s) => s.panX);
  const panY = useViewportStore((s) => s.panY);

  // 주의: getOrderedObjects()처럼 매번 새 배열을 만드는 메서드를 셀렉터로 직접 쓰면 안 된다.
  // zustand(useSyncExternalStore)는 getSnapshot이 매 호출마다 참조가 다르면 "무한 루프"로 보고
  // 즉시 에러를 던진다. 그래서 셀렉터에서는 원본 record(참조 안정적)만 구독하고,
  // 정렬된 배열은 컴포넌트 쪽에서 useMemo로 그 record가 실제로 바뀔 때만 다시 계산한다.
  const objectsRecord = useObjectsStore((s) => s.objects);
  const objects = useMemo(
    () => Object.values(objectsRecord).sort((a, b) => a.zIndex - b.zIndex),
    [objectsRecord],
  );
  const deselect = useInteractionStore((s) => s.deselect);

  // 버그 수정: canvas-root는 왼쪽 파일트리 사이드바 폭만큼 화면 왼쪽 끝에서 오프셋돼
  // 있다 — clientToWorld(utils/coords.ts)가 포인터 좌표를 world로 바꿀 때 그 오프셋을
  // 보정하려면 이 컨테이너 엘리먼트를 알아야 한다.
  useEffect(() => {
    registerCanvasContainer(containerRef.current);
    return () => registerCanvasContainer(null);
  }, []);

  useWheelZoom(containerRef);
  useTextSelectionTools(containerRef);
  useImageHighlightTool(containerRef);
  useObjectDeleteShortcut();
  useImagePaste();
  useTextPaste();
  useDrawShapeTool(containerRef);
  useDrawTextTool(containerRef);
  useUndoRedoShortcut();
  useClipboardShortcuts();
  useGroupShortcut();
  const { cursor, isSpacePressed } = usePan(containerRef);
  // Phase 7: 마퀴 선택은 usePan의 isSpacePressed를 알아야 스페이스+드래그(pan)와
  // 충돌하지 않는다 — 그래서 usePan 다음에 호출한다(useMarqueeSelect.ts 주석 참고).
  useMarqueeSelect(containerRef, isSpacePressed);
  const activeTool = useToolStore((s) => s.activeTool);

  // Phase 5: '이미지' 도구로 캔버스/Frame을 클릭하면 imagePickerStore에 위치가
  // 기억되고 requestId가 증가한다 — 그 신호를 받아 숨겨진 file input을 연다.
  // 최초 마운트 시(requestId===0으로 시작) 파일 창이 뜨면 안 되므로, "처음 봤던
  // requestId"를 기준값으로 고정해두고 그 값과 달라졌을 때만 연다. (예전엔 "이번이
  // 첫 실행인지"를 나타내는 boolean 플래그를 껐다 켰다 했는데, React 18 StrictMode의
  // 개발 모드 마운트 시 effect 이중 실행 때문에 그 플래그가 첫 번째 실행에서 이미
  // false로 바뀌어버려서 두 번째 실행이 "첫 실행이 아니다"로 오판, 사용자 클릭 없이
  // 파일 선택 창을 열려다 브라우저에 막히는 버그가 있었다 — "Chrome DevTools:
  // file chooser dialog can only be shown with a user activation" 콘솔 에러로
  // 나타남. 기준값과 비교하는 방식은 effect가 몇 번 실행되든 항상 같은 결과를
  // 내므로 이중 실행에 안전하다.)
  const pickerRequestId = useImagePickerStore((s) => s.requestId);
  const baselinePickerRequestId = useRef(pickerRequestId).current;
  useEffect(() => {
    if (pickerRequestId === baselinePickerRequestId) return;
    fileInputRef.current?.click();
  }, [pickerRequestId, baselinePickerRequestId]);

  // 요구사항(폰트 목록 통합): 새로고침 후에도 커스텀 폰트가 유지되도록, 앱이 처음
  // 뜰 때 한 번 IndexedDB(store/fontPersistence.ts)에 저장된 폰트를 불러와
  // document.fonts에 다시 등록한다. 마운트당 한 번만 실행되면 되므로 deps는 빈 배열
  // — 다만 StrictMode 이중 실행 자체는 막지 못하므로, 실제 중복 등록 방지는
  // fontStore.loadPersistedFonts 쪽에서 in-flight promise로 보장한다(같은 이유로
  // 위 파일 피커 effect도 고쳤다 — 주석 참고).
  useEffect(() => {
    void useFontStore.getState().loadPersistedFonts();
  }, []);

  const handleFileInputChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 같은 파일을 연달아 선택할 수 있도록 초기화
    const pending = useImagePickerStore.getState().pending;
    useImagePickerStore.getState().clearPending();
    if (file && pending) {
      void spawnImageAt(pending.x, pending.y, file, pending.frameId);
    }
  };

  // Phase 5: 파일을 캔버스로 드래그 앤 드롭하면 그 자리에 이미지를 만든다.
  // 드롭 지점이 Frame 위라면 findFrameAt으로 찾아 소속시킨다(파일선택/붙여넣기와
  // 동일한 규칙). 여러 파일을 한 번에 드롭하면 살짝씩 어긋나게 놓아 겹치지 않게 한다.
  const handleDrop: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'));
    if (files.length === 0) return;
    const world = clientToWorld({ x: e.clientX, y: e.clientY }, useViewportStore.getState());
    const frameId = findFrameAt(world.x, world.y);
    files.forEach((file, i) => {
      void spawnImageAt(world.x + i * 24, world.y + i * 24, file, frameId);
    });
  };

  const handleDragOver: React.DragEventHandler<HTMLDivElement> = (e) => {
    if (e.dataTransfer.types.includes('Files')) e.preventDefault();
  };

  const gridBackgroundStyle: React.CSSProperties = {
    backgroundSize: `${GRID_SIZE * zoom}px ${GRID_SIZE * zoom}px`,
    backgroundPosition: `${panX}px ${panY}px`,
  };

  // 빈 캔버스(배경) 자체를 클릭했을 때만 선택 해제한다.
  // 객체 위에서는 useObjectDrag가 stopPropagation하므로 여기까지 전파되지 않는다.
  //
  // Phase 7: activeTool==='select'일 때는 useMarqueeSelect가 같은 배경 pointerdown을
  // native 리스너로 먼저 받아 드래그-vs-클릭을 판별한 뒤(pointerup 시점에) 선택 해제
  // 여부를 대신 결정한다 — 여기서 즉시 deselect해버리면 그 직후 시작되는 마퀴 드래그가
  // "이미 비어버린 선택"에서 시작하는 꼴이라 무의미하진 않지만, 클릭인지 드래그인지
  // 아직 모르는 시점에 서둘러 처리하는 것보다 마퀴 훅에 위임하는 편이 일관적이다.
  // highlight/annotation/도형 도구 등 다른 도구에서는 기존과 동일하게 즉시 처리한다.
  const handleBackgroundPointerDown: React.PointerEventHandler<HTMLDivElement> = (e) => {
    if (isSpacePressed || e.button !== 0) return; // pan 트리거는 배경 클릭으로 취급하지 않음
    if (activeTool === 'select') return; // useMarqueeSelect가 담당
    if (e.target === e.currentTarget) {
      deselect();
    }
  };

  // Phase 4(2차): '프레임'/'이미지' 도구가 활성화된 상태에서 빈 캔버스를 한 번 클릭하면
  // 그 자리에 새 객체를 만든다. 1회용 도구라서 만들고 나면 바로 'select'로 되돌아간다.
  // e.target === e.currentTarget 검사로 다른 객체(Frame 포함) 위의 클릭은 걸러낸다 —
  // Frame은 자기 자신의 클릭 핸들러를 갖고 있다.
  //
  // 요구사항(텍스트 상자 생성 경로 통합, 2차): Text는 더 이상 이 배경 "클릭"으로
  // 만들어지지 않는다 — '텍스트' 도구를 고른 뒤 화살표/사각형처럼 캔버스를
  // "드래그"해야만 생긴다(canvas/interaction/useDrawTextTool.ts). 빈 캔버스
  // 더블클릭으로 만들던 방법과 Frame 내부 더블클릭/클릭으로 만들던 방법
  // (objects/frame/FrameObjectView.tsx)도 함께 제거했다 — Ctrl+V 붙여넣기
  // (useTextPaste.ts)만 예외로 유지된다.
  const handleBackgroundClick: React.MouseEventHandler<HTMLDivElement> = (e) => {
    if (e.target !== e.currentTarget) return;
    const { activeTool: tool, setTool } = useToolStore.getState();
    if (tool !== 'frame' && tool !== 'image') return;

    const world = clientToWorld({ x: e.clientX, y: e.clientY }, useViewportStore.getState());
    if (tool === 'frame') {
      const { frameWidth, frameHeight, frameStyle, frameFoldAxis, frameCenterFold } = useToolStore.getState();
      spawnFrameAt(world.x, world.y, frameWidth, frameHeight, frameStyle, frameFoldAxis, frameCenterFold);
    } else useImagePickerStore.getState().requestPicker(world.x, world.y, null);
    setTool('select');
  };

  return (
    <div
      ref={containerRef}
      className="canvas-root"
      style={{ ...gridBackgroundStyle, cursor }}
      onPointerDown={handleBackgroundPointerDown}
      onClick={handleBackgroundClick}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      <CanvasSearch />
      <Toolbar />
      <PropertiesPanel />
      <ObjectContextMenu />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFileInputChange}
      />

      <div
        className="canvas-world"
        style={{
          transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
        }}
      >
        {objects.map((object) => (
          <ObjectView key={object.id} object={object} isSpacePressed={isSpacePressed} />
        ))}
        {/* 요구사항(내보내기): 이 다섯 개는 전부 편집 중에만 보이는 UI chrome(그리기
            미리보기·마퀴·정렬 가이드·선택 테두리)이라 PNG/JPG/PDF로 내보낼 때는
            같이 찍히면 안 된다. data-export-exclude 하나로 canvas/actions.ts의
            exportFrame이 html-to-image filter에서 통째로 건너뛴다 — position:static
            래퍼라 안의 절대 위치 자식들의 좌표 기준(canvas-world)에는 영향이 없다. */}
        <div data-export-exclude="true">
          <DrawPreview />
          <HighlightDragPreview />
          <TextRangeSelectionOverlay />
          <AlignmentGuideOverlay />
          <MarqueeOverlay />
          <SelectionOverlay />
          <ImageCropOverlay />
        </div>
      </div>
    </div>
  );
}
