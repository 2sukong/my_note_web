/**
 * canvas/PropertiesPanel.tsx(텍스트 "크기" 드롭다운)와 canvas/pdf/PdfOverlayTextSection.tsx
 * (같은 컨트롤의 PDF 오버레이 버전)가 공유하는 폰트 크기 프리셋 목록. 원래
 * PropertiesPanel.tsx 안의 지역 상수였는데, PDF 쪽에서도 그대로 재사용하려고 export를
 * 붙였더니 oxlint의 react-refresh(only-export-components) 경고가 났다 — 컴포넌트
 * 파일은 컴포넌트만 export하는 게 Fast Refresh에 유리하다는 규칙이라, 값 하나 때문에
 * 파일을 오염시키는 대신 이렇게 별도 모듈로 분리했다(objects/text/textColors.ts,
 * objects/text/lineSpacing.ts와 같은 패턴).
 */
export const FONT_SIZE_PRESETS = [12, 14, 16, 18, 20, 24, 28, 32, 36, 48];
