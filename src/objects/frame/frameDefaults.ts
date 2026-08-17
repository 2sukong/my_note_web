/** A4 용지 비율(210mm × 297mm). Frame 기본 크기는 이 비율을 따른다(세로 방향 기준). */
export const A4_WIDTH_MM = 210;
export const A4_HEIGHT_MM = 297;
export const A4_RATIO = A4_WIDTH_MM / A4_HEIGHT_MM; // ≈ 0.707

/** world 단위 기본 폭. mm를 그대로 px 취급하지 않고, 캔버스에서 다루기 좋은 크기로 스케일링. */
export const DEFAULT_FRAME_WIDTH = 480;
export const DEFAULT_FRAME_HEIGHT = Math.round(DEFAULT_FRAME_WIDTH / A4_RATIO);

export interface FrameSizePreset {
  id: string;
  label: string;
  width: number;
  height: number;
}

const WIDESCREEN_RATIO = 16 / 9;

/**
 * 사이드바 크기 프리셋. width/height는 DEFAULT_FRAME_WIDTH/HEIGHT와 같은 스케일의
 * world 단위다. "A4 절반"은 여기 없다 — 실제 크기는 A4와 동일하고 정중앙에 접선만
 * 그려지는 독립된 속성(FrameObject.centerFold, objects/frame/frameStyles.ts의
 * resolveFrameCenterFold 참고)이라서 별도 크기 프리셋이 필요 없다. 배경 테마
 * (plain/dark)와도 완전히 독립이라 어떤 조합이든(예: 다크 + A4 절반) 가능하다.
 */
export const FRAME_SIZE_PRESETS: FrameSizePreset[] = [
  { id: 'a4', label: 'A4', width: DEFAULT_FRAME_WIDTH, height: DEFAULT_FRAME_HEIGHT },
  { id: 'square', label: '정사각형', width: DEFAULT_FRAME_WIDTH, height: DEFAULT_FRAME_WIDTH },
  {
    id: 'widescreen',
    label: '와이드스크린',
    width: DEFAULT_FRAME_HEIGHT,
    height: Math.round(DEFAULT_FRAME_HEIGHT / WIDESCREEN_RATIO),
  },
];
