import { useEffect, useState } from 'react';
import type { ImageObject } from '../types/object';
import { useImageCropStore } from '../store/imageCropStore';
import { useObjectsStore } from '../store/objectsStore';
import { useViewportStore } from '../store/viewportStore';
import { getCachedImageUrl, loadImageUrl } from '../objects/image/imageStore';
import { RESIZE_HANDLES, handlePosition } from './interaction/resizeMath';
import type { ResizeHandle } from './interaction/resizeMath';
import { useImageCrop } from './interaction/useImageCrop';

/** 요구사항(크롭 핸들 스타일): 리사이즈용 둥근 사각형 점과 구분되는, 카메라/사진
 * 편집 도구에서 흔한 "검은 직각 코너 + 변 중앙 짧은 선" 스타일. 화면 기준 px —
 * zoom과 무관하게 항상 같은 크기로 보인다. */
const CORNER_ARM = 16;
const MARK_THICKNESS = 3;
const HIT_SIZE = 24; // 실제로 드래그를 시작할 수 있는(보이지 않는) 히트 영역 한 변.

/**
 * 요구사항(이미지 자르기): 지금 자르기 모드인 이미지 하나(있다면)를 world 좌표
 * 기준으로 그린다. objects/image/ImageObjectView.tsx 안이 아니라 SelectionOverlay/
 * MarqueeOverlay와 같은 canvas-world의 형제로 둔 이유는, 원본 이미지가 지금 보이는
 * 박스보다 훨씬 클 수 있어서(잘려나갈 부분까지 흐리게 보여줘야 하므로) 이 객체
 * 자신의 로컬 stacking context 밖으로 자유롭게 흘러넘칠 수 있어야 하기 때문이다 —
 * 객체 내부에 중첩하면 그 객체의 z-index가 만드는 stacking context에 갇혀 다른
 * (더 높은 z-index를 가진) 객체 뒤에 가려질 수 있다.
 *
 * 흐린 전체 이미지 위에 선명한(잘리지 않은) 크롭 창을 clip-path로 겹쳐 그리는
 * 방식은 objects/image/ImageObjectView.tsx의 CroppedImageDisplay와 정확히 같은
 * 배율(scaleX/Y) 계산을 공유한다 — 그래야 자르기를 끝냈을 때(자르기 모드를 벗어나
 * CroppedImageDisplay가 대신 그리기 시작할 때) 보이는 결과가 미리보기와 어긋나지 않는다.
 */
export function ImageCropOverlay() {
  const croppingObjectId = useImageCropStore((s) => s.croppingObjectId);
  const object = useObjectsStore((s) => (croppingObjectId ? s.objects[croppingObjectId] : undefined));
  const zoom = useViewportStore((s) => s.zoom);
  const imageId = object?.type === 'image' ? object.imageId : undefined;
  const [url, setUrl] = useState<string | undefined>(() => (imageId ? getCachedImageUrl(imageId) : undefined));

  useEffect(() => {
    if (!imageId) {
      setUrl(undefined);
      return;
    }
    const cached = getCachedImageUrl(imageId);
    if (cached) {
      setUrl(cached);
      return;
    }
    let cancelled = false;
    void loadImageUrl(imageId).then((loaded) => {
      if (!cancelled) setUrl(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [imageId]);

  if (!object || object.type !== 'image' || !url) return null;

  const cropX = object.cropX ?? 0;
  const cropY = object.cropY ?? 0;
  const cropWidth = object.cropWidth ?? object.naturalWidth;
  const cropHeight = object.cropHeight ?? object.naturalHeight;
  const scaleX = object.width / cropWidth;
  const scaleY = object.height / cropHeight;
  const fullWidth = object.naturalWidth * scaleX;
  const fullHeight = object.naturalHeight * scaleY;
  const fullLeft = object.x - cropX * scaleX;
  const fullTop = object.y - cropY * scaleY;

  // clip-path: inset(top right bottom left) — 이 <img> 자신의 박스(fullWidth x
  // fullHeight) 기준 각 변에서 안쪽으로 얼마나 잘라낼지를 뜻한다.
  const clipTop = cropY * scaleY;
  const clipLeft = cropX * scaleX;
  const clipRight = fullWidth - (cropX + cropWidth) * scaleX;
  const clipBottom = fullHeight - (cropY + cropHeight) * scaleY;

  const borderWidth = 1.5 / zoom;

  return (
    <>
      {/* 요구사항(더 흐리게): 잘려나갈 부분은 눈에 덜 띄도록 0.35 -> 0.12로 낮췄다. */}
      <img
        src={url}
        draggable={false}
        alt=""
        style={{
          position: 'absolute',
          left: fullLeft,
          top: fullTop,
          width: fullWidth,
          height: fullHeight,
          maxWidth: 'none',
          display: 'block',
          opacity: 0.12,
          pointerEvents: 'none',
          zIndex: 9996,
        }}
      />
      <img
        src={url}
        draggable={false}
        alt=""
        style={{
          position: 'absolute',
          left: fullLeft,
          top: fullTop,
          width: fullWidth,
          height: fullHeight,
          maxWidth: 'none',
          display: 'block',
          pointerEvents: 'none',
          clipPath: `inset(${clipTop}px ${clipRight}px ${clipBottom}px ${clipLeft}px)`,
          zIndex: 9997,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: object.x,
          top: object.y,
          width: object.width,
          height: object.height,
          border: `${borderWidth}px solid #4f8cff`,
          pointerEvents: 'none',
          zIndex: 9998,
        }}
      >
        {RESIZE_HANDLES.map((handle) => (
          <CropHandleMark key={handle} object={object} handle={handle} zoom={zoom} />
        ))}
      </div>
    </>
  );
}

/** 핸들 하나가 대표하는 지점(박스 기준 상대 좌표) — 코너/변 마크와 히트 영역을
 * 모두 이 점 중심으로 그린다. */
function anchorPointFor(handle: ResizeHandle, width: number, height: number): { x: number; y: number } {
  const table: Record<ResizeHandle, { x: number; y: number }> = {
    nw: { x: 0, y: 0 },
    n: { x: width / 2, y: 0 },
    ne: { x: width, y: 0 },
    e: { x: width, y: height / 2 },
    se: { x: width, y: height },
    s: { x: width / 2, y: height },
    sw: { x: 0, y: height },
    w: { x: 0, y: height / 2 },
  };
  return table[handle];
}

/** 요구사항(크롭 핸들 스타일): 리사이즈의 둥근 사각형 대신, 코너는 검은 직각(ㄴ자)
 * 브라켓을, 변 중앙은 검은 짧은 선을 그린다 — 실제 드래그를 시작하는 히트 영역은
 * 그보다 넉넉하게 잡되(보이지 않음) 눈에 보이는 마크 자체는 얇게 유지한다. */
function CropHandleMark({ object, handle, zoom }: { object: ImageObject; handle: ResizeHandle; zoom: number }) {
  const drag = useImageCrop(object, handle);
  const arm = CORNER_ARM / zoom;
  const thickness = MARK_THICKNESS / zoom;
  const hitSize = HIT_SIZE / zoom;
  const cursor = handlePosition(handle, object.width, object.height, 0).cursor;
  const anchor = anchorPointFor(handle, object.width, object.height);
  const isCorner = handle.length === 2;
  const half = hitSize / 2;

  return (
    <div
      {...drag}
      style={{
        position: 'absolute',
        left: anchor.x - half,
        top: anchor.y - half,
        width: hitSize,
        height: hitSize,
        cursor,
        pointerEvents: 'auto',
        touchAction: 'none',
      }}
    >
      {isCorner ? (
        <CornerBracket handle={handle as 'nw' | 'ne' | 'se' | 'sw'} half={half} arm={arm} thickness={thickness} />
      ) : (
        <EdgeTick handle={handle as 'n' | 's' | 'e' | 'w'} half={half} arm={arm} thickness={thickness} />
      )}
    </div>
  );
}

/** 코너 지점(half, half — 히트 영역 자신의 중심)에서 박스 안쪽을 향해 뻗는 두 개의
 * 검은 막대(가로 하나 + 세로 하나)로 직각을 표현한다. */
function CornerBracket({
  handle,
  half,
  arm,
  thickness,
}: {
  handle: 'nw' | 'ne' | 'se' | 'sw';
  half: number;
  arm: number;
  thickness: number;
}) {
  const towardEast = handle === 'nw' || handle === 'sw'; // 안쪽(박스 내부)이 오른쪽인가
  const towardSouth = handle === 'nw' || handle === 'ne'; // 안쪽이 아래쪽인가

  const horizontalLeft = towardEast ? half : half - arm;
  const horizontalTop = towardSouth ? half : half - thickness;
  const verticalLeft = towardEast ? half : half - thickness;
  const verticalTop = towardSouth ? half : half - arm;

  const barStyle = { position: 'absolute' as const, background: '#000000' };
  return (
    <>
      <div style={{ ...barStyle, left: horizontalLeft, top: horizontalTop, width: arm, height: thickness }} />
      <div style={{ ...barStyle, left: verticalLeft, top: verticalTop, width: thickness, height: arm }} />
    </>
  );
}

/** 변 중앙(half, half)에 짧은 검은 선 하나 — n/s는 가로, e/w는 세로. */
function EdgeTick({ handle, half, arm, thickness }: { handle: 'n' | 's' | 'e' | 'w'; half: number; arm: number; thickness: number }) {
  const horizontal = handle === 'n' || handle === 's';
  return (
    <div
      style={{
        position: 'absolute',
        left: horizontal ? half - arm / 2 : half - thickness / 2,
        top: horizontal ? half - thickness / 2 : half - arm / 2,
        width: horizontal ? arm : thickness,
        height: horizontal ? thickness : arm,
        background: '#000000',
      }}
    />
  );
}
