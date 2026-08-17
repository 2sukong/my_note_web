// Phase 4(2차)에서 제거됨.
//
// Annotation은 더 이상 독립 CanvasObject(노란 박스)가 아니다. 이제 특정 TextLine에
// 종속된 데이터(TextLine.annotations)로 관리되며, 렌더링/편집은
// objects/text/AnnotationBubble.tsx + TextObjectView.tsx가 담당한다.
//
// 이 파일은 (샌드박스 파일시스템 제약으로) 완전히 삭제하지 못해 빈 상태로 남겨둔다.
// 어디에서도 import하지 않는다 — 참조가 남아있다면 그것이 버그다.
export {};
