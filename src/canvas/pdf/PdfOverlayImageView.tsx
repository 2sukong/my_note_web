import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { ImageObject } from '../../types/object';
import { getCachedImageUrl, loadImageUrl } from '../../objects/image/imageStore';
import { useToolStore } from '../../store/toolStore';
import { usePdfOverlayStore } from '../../store/pdfOverlayStore';
import { usePdfOverlaySelectionStore } from '../../store/pdfOverlaySelectionStore';
import { PdfOverlayResizeHandles } from './PdfOverlayResizeHandles';

/**
 * PDF 페이지 오버레이 위 이미지 하나(Phase 6, 2026-08). objects/image/
 * ImageObjectView.tsx와 같은 비동기 로드 관례(캐시 우선 조회 → 없으면 loadImageUrl)를
 * 그대로 재사용한다 — imageStore.ts 자체가 좌표계와 무관한 전역 모듈이라 그대로 쓸 수
 * 있다(spawnOverlayImage.ts 상단 주석 참고).
 *
 * 리사이즈(추가 Phase, 2026-09): 메인 캔버스의 ImageObjectView.tsx와 동일하게
 * aspectRatioLocked가 true(spawnOverlayImage.ts 기본값)면 "지금 보이는" 가로세로
 * 비율을 유지한 채 리사이즈된다(PdfOverlayResizeHandles.tsx → usePdfOverlayObjectResize.ts
 * 의 aspectRatio 인자). 정렬 가이드/스냅은 이번 범위에서 제외(사용자 확정 2026-08-31).
 *
 * v1 범위로 여전히 의도적으로 줄여둔 것(PdfOverlayShapeView.tsx와 같은 기준): 자르기
 * (crop) 없음, 이미지 전용 직선 형광펜 없음. 선택/삭제(Delete)/드래그 이동은
 * PdfOverlayShapeView.tsx와 동일하게 지원한다(드래그 로직 자체를 그대로 포크했다 —
 * 객체 종류만 다를 뿐 좌표 변환은 똑같다).
 */
export function PdfOverlayImageView({
  object,
  pageWidth,
  pageHeight,
  displayScale,
}: {
  object: ImageObject;
  pageWidth: number;
  pageHeight: number;
  displayScale: number;
}) {
  const [url, setUrl] = useState<string | undefined>(() =>
    object.imageId ? getCachedImageUrl(object.imageId) : undefined,
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    if (!object.imageId) {
      setUrl(undefined);
      return;
    }
    const cached = getCachedImageUrl(object.imageId);
    if (cached) {
      setUrl(cached);
      return;
    }
    let cancelled = false;
    void loadImageUrl(object.imageId).then((loaded) => {
      if (!cancelled) setUrl(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [object.imageId]);

  const dragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);

  const selectedId = usePdfOverlaySelectionStore((s) => s.selectedId);
  const isSelected = selectedId === object.id;
  const activeTool = useToolStore((s) => s.activeTool);

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (activeTool !== 'select') return;
    usePdfOverlaySelectionStore.getState().select(object.id);
    dragRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: object.x,
      startY: object.y,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (e.buttons === 0) {
      dragRef.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      return;
    }
    const dxClient = e.clientX - drag.startClientX;
    const dyClient = e.clientY - drag.startClientY;
    if (!drag.moved && Math.hypot(dxClient, dyClient) < 2) return; // 지터 방지(실수로 살짝 움직인 클릭)
    drag.moved = true;
    usePdfOverlayStore
      .getState()
      .updateObject(
        object.id,
        { x: drag.startX + dxClient / displayScale, y: drag.startY + dyClient / displayScale },
        `move:${object.id}`,
      );
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <div
      className={'pdf-overlay-image' + (isSelected ? ' is-selected' : '')}
      style={{
        position: 'absolute',
        left: `${(object.x / pageWidth) * 100}%`,
        top: `${(object.y / pageHeight) * 100}%`,
        width: `${(object.width / pageWidth) * 100}%`,
        height: `${(object.height / pageHeight) * 100}%`,
        zIndex: object.zIndex,
        pointerEvents: 'auto',
        cursor: activeTool === 'select' ? 'move' : 'default',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {!url || failed ? (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#f4f4f4',
            border: '1px dashed #c7c7c7',
            borderRadius: 4,
            color: '#8a8a8a',
            fontSize: 12,
            fontFamily: 'system-ui, sans-serif',
            textAlign: 'center',
            boxSizing: 'border-box',
          }}
        >
          {failed ? '이미지를 불러오지 못했습니다' : '불러오는 중…'}
        </div>
      ) : (
        <img
          src={url}
          draggable={false}
          onError={() => setFailed(true)}
          alt=""
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            borderRadius: 4,
            display: 'block',
            // ImageObjectView.tsx와 같은 이유: 이동 드래그는 항상 이 div(부모)의 몫이라,
            // img 자신은 pointer 이벤트를 받지 않게 해서 네이티브 이미지 드래그/우클릭
            // 저장 메뉴 등과 커스텀 드래그 로직이 충돌하지 않도록 한다.
            pointerEvents: 'none',
          }}
        />
      )}
      {isSelected && activeTool === 'select' && (
        <PdfOverlayResizeHandles
          objectId={object.id}
          box={{ x: object.x, y: object.y, width: object.width, height: object.height }}
          displayScale={displayScale}
          aspectRatio={object.aspectRatioLocked ? object.width / object.height : undefined}
        />
      )}
    </div>
  );
}
