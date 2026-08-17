import { DEFAULT_FONT_FAMILY } from './fontOptions';

/**
 * 요구사항(폰트 목록 통합 — 실제 렌더링 크기 반영): "같은 16pt라도 폰트에 따라
 * 실제 보이는 크기가 다르다" — 지금까지 주석(AnnotationBubble)의 크기는 CSS
 * font-size 값(computedFontSizePx / REFERENCE_FONT_SIZE)에만 비례했는데, 이건
 * "숫자로 지정한 크기"일 뿐 폰트마다 실제 글자가 차지하는 높이(ascent+descent)는
 * 꽤 다르다(예: 획이 크고 통통한 폰트 vs 가늘고 작은 폰트). 그래서 CSS font-size
 * 비율에 "이 폰트가 실제로 얼마나 크게 그려지는지"의 보정 배율을 곱한다.
 *
 * Canvas 2D의 TextMetrics.actualBoundingBoxAscent/Descent는 지정한 문자열이 실제
 * 캔버스에 래스터화됐을 때 위/아래로 차지하는 실측 픽셀 높이를 알려준다(폰트의
 * line-height 메타데이터가 아니라 실제 잉크가 닿는 영역) — DOM 레이아웃을 건드리지
 * 않고(오프스크린 <canvas>, 화면에 그리지 않음) 몇 번의 measureText 호출만으로
 * 얻을 수 있어 매 렌더마다 불러도 비용이 작고, 결과는 폰트별로 캐시해서 한 번만
 * 계산한다.
 *
 * 기준(비율 1.0)은 이 프로젝트의 다른 모든 크기 상수(AnnotationBubble.tsx의
 * *_BASE 값들)가 애초에 튜닝됐던 DEFAULT_FONT_FAMILY(시스템 기본 산세리프)다.
 */
const PROBE_FONT_SIZE = 100; // 크게 잴수록 반올림 오차가 작아진다.
// 라틴 대문자/소문자(어센더·디센더 포함) + 한글(자모 조합에 따라 세로 폭이 크게
// 갈리는 대표 글자, 이 프로젝트가 한글 손글씨 메모 앱이라는 점을 반영)을 섞은
// 프로브 문자열 — 실제 사용자가 입력할 법한 문자 종류를 두루 대표하게 한다.
const PROBE_TEXT = 'Hg한글Ay';

let measureCtx: CanvasRenderingContext2D | null | undefined;

function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (measureCtx !== undefined) return measureCtx;
  try {
    const canvas = document.createElement('canvas');
    measureCtx = canvas.getContext('2d');
  } catch {
    measureCtx = null;
  }
  return measureCtx;
}

function measureRenderedHeightPx(fontFamily: string): number | null {
  const ctx = getMeasureCtx();
  if (!ctx) return null;
  try {
    ctx.font = `${PROBE_FONT_SIZE}px ${fontFamily}`;
    const m = ctx.measureText(PROBE_TEXT);
    const ascent = m.actualBoundingBoxAscent;
    const descent = m.actualBoundingBoxDescent;
    if (!Number.isFinite(ascent) || !Number.isFinite(descent)) return null;
    const height = ascent + descent;
    return height > 0 ? height : null;
  } catch {
    return null;
  }
}

const ratioCache = new Map<string, number>();

/**
 * fontFamily(CSS font-family 문자열, 콤마로 이어진 폴백 스택 그대로)의 실제 렌더링
 * 높이가 DEFAULT_FONT_FAMILY 대비 몇 배인지 반환한다. 측정에 실패하면(구형 브라우저
 * 등 actualBoundingBox 미지원, 또는 canvas 컨텍스트를 못 얻는 환경) 1(차이 없음으로
 * 취급 — 기존 동작과 동일하게 폴백)을 반환해서 항상 안전하다.
 */
export function fontHeightScaleFor(fontFamily: string): number {
  const key = fontFamily || DEFAULT_FONT_FAMILY;
  const cached = ratioCache.get(key);
  if (cached !== undefined) return cached;

  const targetHeight = measureRenderedHeightPx(key);
  const refHeight = measureRenderedHeightPx(DEFAULT_FONT_FAMILY);
  const ratio = targetHeight && refHeight && refHeight > 0 ? targetHeight / refHeight : 1;
  const clamped = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  ratioCache.set(key, clamped);
  return clamped;
}
