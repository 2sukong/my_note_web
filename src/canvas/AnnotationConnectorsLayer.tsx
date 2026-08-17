// Phase 4(2차)에서 제거됨.
//
// Annotation이 독립 CanvasObject였을 때는 캔버스 전체를 덮는 SVG 레이어에서
// world 좌표로 화살표를 그려야 했다. 이제 Annotation은 TextLine에 종속된
// 데이터이고 항상 자신의 anchor 텍스트 바로 위에만 표시되므로, 화살표도
// TextObjectView 내부(그 텍스트 객체의 로컬 좌표계)에서 함께 그린다
// (objects/text/AnnotationBubble.tsx 참고). 더 이상 전역 레이어가 필요 없다.
//
// 이 파일은 (샌드박스 파일시스템 제약으로) 완전히 삭제하지 못해 빈 상태로 남겨둔다.
// 어디에서도 import하지 않는다.
export {};
