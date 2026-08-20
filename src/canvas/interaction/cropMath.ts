import type { ResizeHandle } from './resizeMath';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropRect {
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
}

export interface CropState {
  box: Box;
  crop: CropRect;
  naturalWidth: number;
  naturalHeight: number;
}

/** 자연 이미지 픽셀 기준 최소 크롭 크기 — 크롭 영역이 완전히 사라지는 것을 막는다. */
export const MIN_CROP_PX = 10;

/**
 * 리사이즈 핸들 드래그(world px 이동량 dx/dy)를 "지금 보이는 박스(box)"와 "그 박스가
 * 원본 이미지의 어느 자연 픽셀 영역을 보여주는지(crop)"의 새 값으로 함께 변환한다.
 *
 * 원리: 지금 이 크롭 영역의 확대/축소 비율(scale = box px / crop 자연 px)은 핸들을
 * 드래그하는 동안 절대 바뀌지 않는다 — 크롭은 "같은 배율로 보던 창을 늘리거나
 * 줄이는 것"이지 리사이즈처럼 "같은 영역을 다른 배율로 보는 것"이 아니기 때문이다.
 * 그래서 world px 이동량을 scale로 나누면 그대로 "자연 픽셀 기준 크롭 이동량"이 된다.
 * west/north 핸들은 크롭의 반대쪽 끝(cropX+cropWidth / cropY+cropHeight)이 고정된
 * 채로 시작 지점이 움직이고, east/south 핸들은 시작 지점이 고정된 채 크기만 변한다 —
 * resizeMath.ts의 computeResizedBox와 완전히 같은 원리를 crop 공간에서 반복한다.
 *
 * 자연 이미지 경계(0~naturalWidth/Height) 밖으로는 절대 확장할 수 없다(원본에 없는
 * 픽셀을 보여줄 수는 없으므로) — 그 경계에서 클램프한 뒤, 클램프된 crop 델타를 다시
 * scale을 곱해 world 델타로 역산해서 box도 함께 정확히 맞춘다(box와 crop이 항상
 * 1:1로 맞아떨어지게 유지하기 위함 — 아니면 화면에 보이는 박스 크기와 실제로
 * 보여주는 이미지 영역의 배율이 어긋나 버린다).
 */
export function computeCroppedState(start: CropState, handle: ResizeHandle, dx: number, dy: number): CropState {
  const scaleX = start.box.width / start.crop.cropWidth;
  const scaleY = start.box.height / start.crop.cropHeight;

  const hasWest = handle.includes('w');
  const hasEast = handle.includes('e');
  const hasNorth = handle.includes('n');
  const hasSouth = handle.includes('s');

  let cropX = start.crop.cropX;
  let cropWidth = start.crop.cropWidth;
  if (hasWest) {
    cropX = start.crop.cropX + dx / scaleX;
    cropWidth = start.crop.cropWidth - dx / scaleX;
  } else if (hasEast) {
    cropWidth = start.crop.cropWidth + dx / scaleX;
  }

  let cropY = start.crop.cropY;
  let cropHeight = start.crop.cropHeight;
  if (hasNorth) {
    cropY = start.crop.cropY + dy / scaleY;
    cropHeight = start.crop.cropHeight - dy / scaleY;
  } else if (hasSouth) {
    cropHeight = start.crop.cropHeight + dy / scaleY;
  }

  // 자연 이미지 경계 + 최소 크기로 클램프.
  if (hasWest) {
    cropX = Math.max(0, Math.min(cropX, start.crop.cropX + start.crop.cropWidth - MIN_CROP_PX));
    cropWidth = start.crop.cropX + start.crop.cropWidth - cropX;
  } else if (hasEast) {
    cropWidth = Math.max(MIN_CROP_PX, Math.min(cropWidth, start.naturalWidth - start.crop.cropX));
  }
  if (hasNorth) {
    cropY = Math.max(0, Math.min(cropY, start.crop.cropY + start.crop.cropHeight - MIN_CROP_PX));
    cropHeight = start.crop.cropY + start.crop.cropHeight - cropY;
  } else if (hasSouth) {
    cropHeight = Math.max(MIN_CROP_PX, Math.min(cropHeight, start.naturalHeight - start.crop.cropY));
  }

  // 클램프된 crop 델타를 world 델타로 역산해 box를 crop과 정확히 맞춘다.
  let boxX = start.box.x;
  let boxWidth = start.box.width;
  if (hasWest) {
    boxX = start.box.x + (cropX - start.crop.cropX) * scaleX;
    boxWidth = start.box.width - (cropX - start.crop.cropX) * scaleX;
  } else if (hasEast) {
    boxWidth = start.box.width + (cropWidth - start.crop.cropWidth) * scaleX;
  }

  let boxY = start.box.y;
  let boxHeight = start.box.height;
  if (hasNorth) {
    boxY = start.box.y + (cropY - start.crop.cropY) * scaleY;
    boxHeight = start.box.height - (cropY - start.crop.cropY) * scaleY;
  } else if (hasSouth) {
    boxHeight = start.box.height + (cropHeight - start.crop.cropHeight) * scaleY;
  }

  return {
    box: { x: boxX, y: boxY, width: boxWidth, height: boxHeight },
    crop: { cropX, cropY, cropWidth, cropHeight },
    naturalWidth: start.naturalWidth,
    naturalHeight: start.naturalHeight,
  };
}
