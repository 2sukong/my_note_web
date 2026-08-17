/**
 * 요구사항(어두운 프레임에서도 A4 절반을 쓸 수 있도록): 예전엔 'plain'/'dark'/'half'가
 * 하나의 배타적 선택지였다 — 'half'가 "흰 배경 + 접선"을 한 덩어리로 묶어놨기 때문에
 * 어두운 배경에는 접선을 넣을 수 없었다. 이제 배경 테마('plain'|'dark')와 접선 표시
 * 여부(FrameObject.centerFold)를 완전히 독립된 축으로 분리해서, 둘을 자유롭게
 * 조합할 수 있다(예: 다크 + A4 절반). 'half'는 과거 저장 파일과의 하위 호환을 위해
 * FrameObject.style의 타입에만 남아 있다 — 새로 만드는 프레임은 절대 style:'half'로
 * 저장하지 않는다(resolveFrameTheme/resolveFrameCenterFold가 대신 처리).
 */
export type FrameStyle = 'plain' | 'dark' | 'half';
/** 배경 테마만 가리키는 타입(새 코드가 실제로 다루는 값) — 'half'는 legacy 입력에만 존재한다. */
export type FrameTheme = 'plain' | 'dark';

export interface FrameThemeDef {
  id: FrameTheme;
  label: string;
  background: string;
  borderColor: string;
  labelColor: string;
}

/**
 * 프레임 배경 테마. 크기 프리셋(frameDefaults.ts의 FRAME_SIZE_PRESETS)이나 접선 표시
 * 여부(FrameObject.centerFold)와 완전히 독립된 축이라, 셋을 자유롭게 조합할 수 있다
 * (예: 다크 + A4 절반 + 정사각형).
 */
export const FRAME_THEMES: Record<FrameTheme, FrameThemeDef> = {
  plain: {
    id: 'plain',
    label: '기본',
    background: '#ffffff',
    borderColor: '#dcdcdc',
    labelColor: '#9a9a9a',
  },
  dark: {
    id: 'dark',
    label: '다크',
    background: '#1f2126',
    borderColor: '#3a3d44',
    labelColor: '#8b8f98',
  },
};

export const FRAME_THEME_IDS: FrameTheme[] = ['plain', 'dark'];

/** object.style(구버전 데이터의 'half' 포함)에서 실제 배경 테마를 뽑아낸다.
 * legacy 'half'는 항상 흰 배경('plain')이었으므로 그대로 취급한다. */
export function resolveFrameTheme(style: FrameStyle | undefined): FrameTheme {
  return style === 'dark' ? 'dark' : 'plain';
}

/** object.centerFold(신규 필드)가 있으면 그 값을, 없으면(구버전 데이터) style==='half'
 * 여부로 접선 표시 여부를 판정한다 — 기존에 저장된 "A4 절반" 프레임을 마이그레이션
 * 없이도 그대로 올바르게(접선 있는 상태로) 계속 보여주기 위함이다. */
export function resolveFrameCenterFold(style: FrameStyle | undefined, centerFold: boolean | undefined): boolean {
  if (centerFold !== undefined) return centerFold;
  return style === 'half';
}

