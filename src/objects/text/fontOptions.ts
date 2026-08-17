export const DEFAULT_FONT_FAMILY = 'system-ui, sans-serif';

export interface FontOption {
  id: string;
  label: string;
  family: string;
}

/**
 * Phase 8(스타일 패널): 특정 상용/무료 폰트를 앱에 내장하거나 원격에서 내려받지
 * 않는다(요구사항 명시) — 대신 브라우저/OS가 이미 알아서 매핑해주는 CSS 제네릭
 * 패밀리 키워드만 기본 옵션으로 제공한다. 다운로드 0바이트, 오프라인에서도 항상
 * 동작한다. 사용자가 원하는 특정 폰트가 있으면 store/fontStore.ts로 직접
 * 파일(ttf/otf/woff/woff2)을 업로드해서 쓴다.
 */
export const BUILTIN_FONT_OPTIONS: FontOption[] = [
  { id: 'system', label: '기본(시스템)', family: DEFAULT_FONT_FAMILY },
  { id: 'serif', label: '명조 계열(세리프)', family: 'ui-serif, serif' },
  { id: 'sans', label: '고딕 계열(산세리프)', family: 'ui-sans-serif, sans-serif' },
  { id: 'mono', label: '고정폭', family: 'ui-monospace, monospace' },
  { id: 'cursive', label: '손글씨 느낌', family: 'cursive' },
];
