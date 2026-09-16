import { useEffect, useLayoutEffect, useRef } from 'react';
import type { CompositionEvent as ReactCompositionEvent, FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { TextAnnotation } from '../../objects/text/indentation/types';
import { annotationVisualsFor } from '../../objects/text/annotationColors';
import { usePdfOverlayStore } from '../../store/pdfOverlayStore';
import { usePdfOverlaySelectionStore } from '../../store/pdfOverlaySelectionStore';
import { PDF_OVERLAY_ABSOLUTE_SIZE_CALIBRATION as SIZE_CAL } from '../../objects/pdf/pdfRaster';
import { fontHeightScaleFor } from '../../objects/text/fontMetrics';
import { DEFAULT_FONT_FAMILY } from '../../objects/text/fontOptions';

// objects/text/TextObjectView.tsx의 동일한 이름 상수(비공개, import 불가)와 반드시 같은
// 값이어야 한다 — 그 파일의 fontScale 계산과 여기 fontScale 계산이 같은 기준(16px)을
// 공유해야 메인 캔버스와 PDF 오버레이에서 "글자 크기 대비 주석 크기" 비율이 일치한다.
const REFERENCE_FONT_SIZE = 16;

/**
 * PDF 오버레이 위 주석(Annotation) 하나. v3 §2-9에서 확정한 대로 "Text를 오버레이에
 * 올리면 주석 기능이 자동으로 딸려온다"는 요구사항을 데이터(TextLine.annotations,
 * pdfOverlayStore.ts에 그대로 이식된 objectsStore.ts 액션들)는 100% 동일하게 만족하지만,
 * 화면 표현은 의도적으로 단순화했다: 메인 앱의 AnnotationBubble.tsx(801줄, 손그림
 * SVG 화살표 + 드래그 재배치 + zoom 보정)를 그대로 옮기는 대신, 이 주석이 달린 줄
 * 바로 아래에 "인라인 메모 블록"으로 흘러들어가게 그린다 — 화면 고정 패널(줌 변환이
 * 없는) 안에서 문자 단위 anchor 좌표를 매번 다시 측정해 화살표를 그리는 것보다
 * 훨씬 단순하고 견고하며, 실시간 브라우저 테스트가 불가능한 환경에서 그 복잡도를
 * 감수할 가치가 낮다고 판단했다(v1 스코프 축소, 사용자에게 별도 고지). 나중에 필요하면
 * 화면 표현만 교체할 수 있다 — 데이터 계약은 이미 메인 앱과 동일하다. 같은 이유로
 * TextAnnotation.offsetX(말풍선 드래그 재배치용 필드)는 이 컴포넌트가 읽지 않는다 —
 * 항상 줄 아래 고정 위치에 흐른다.
 *
 * data-annotation-id/data-object-id/data-owner-line-id 속성은 objects/text/
 * selectionCapture.ts의 captureAnnotationSelection()이 문서 전역에서 그대로 찾아내는
 * 규약이라 그대로 유지한다 — 그래야 주석 자기 텍스트 위 형광펜(이번 라운드는 범위
 * 밖이지만 나중에 켜도 되도록) 등 기존 로직이 수정 없이 작동한다.
 *
 * 버그 수정(2026-08, IME 조합 방어): PdfOverlayTextView.tsx와 같은 이유로 composingRef +
 * onCompositionStart/End를 추가했다 — 이 컴포넌트 자체는 [annotation.text] 값(참조가
 * 아니라 원시 문자열)에만 반응하는 effect라 원래도 위험이 낮았지만(같은 주석 자신의
 * 텍스트가 실제로 바뀔 때만 재실행됨), 일관성과 방어적 안전을 위해 텍스트 줄과 동일한
 * 패턴을 적용했다. spellCheck={false}도 추가(브라우저 기본 맞춤법 빨간 밑줄 제거 —
 * TextObjectView.tsx의 동일 설정과 같은 이유).
 */
export function PdfOverlayAnnotationNote({
  objectId,
  lineId,
  annotation,
  displayScale,
  ownerBaseFontSize,
  ownerFontFamily,
}: {
  objectId: string;
  lineId: string;
  annotation: TextAnnotation;
  displayScale: number;
  /** 버그 수정(2026-09-16, "PDF 위 주석 크기가 일반 페이지보다 너무 작음"): 이 주석이
   * 달린 PDF 오버레이 Text 객체 자신의 baseFontSize/fontFamily — 메인 캔버스
   * AnnotationBubble.tsx가 anchor 텍스트의 실제 computed font-size를
   * REFERENCE_FONT_SIZE(16) 대비 배율(fontScale)로 환산해 말풍선 크기에 곱하는 것과
   * 똑같은 보정을 여기서도 적용하기 위해 필요하다(아래 fontScale 참고). 이 값 없이
   * 예전처럼 `(annotation.fontSize ?? 11) * displayScale * SIZE_CAL`만 쓰면, 본문
   * 글자 크기를 키운 PDF 페이지에서는 주석만 그 비율만큼 자라지 않아 메인 캔버스보다
   * 눈에 띄게 작아 보였다(본문이 클수록 격차도 커짐 — 사용자 리포트와 일치).
   */
  ownerBaseFontSize: number;
  ownerFontFamily?: string;
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const composingRef = useRef(false);
  const focusAnnotationId = usePdfOverlaySelectionStore((s) => s.focusAnnotationId);

  // DOM↔store 동기화: pdfOverlayStore.ts § pdfOverlayTextView.tsx의 줄 동기화와 같은
  // 원리 — 현재 DOM 내용이 store와 이미 같으면 손대지 않는다(타이핑 중 커서 위치 보존).
  // 조합(IME) 중에는 절대 건드리지 않는다(조합 버퍼가 store 값으로 덮어써지는 것 방지).
  useLayoutEffect(() => {
    if (composingRef.current) return;
    const el = divRef.current;
    if (!el) return;
    if (el.textContent !== annotation.text) {
      el.textContent = annotation.text;
    }
  }, [annotation.text]);

  // 새로 만든 주석에 자동으로 포커스를 준다(useOverlayTextSelectionTools.ts가
  // addAnnotation 직후 requestAnnotationFocus를 호출) — 한 번 소비하면 스스로 신호를
  // 지운다.
  useEffect(() => {
    if (focusAnnotationId !== annotation.id) return;
    const el = divRef.current;
    if (el) {
      el.focus();
      const selection = window.getSelection();
      if (selection) {
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
    usePdfOverlaySelectionStore.getState().clearAnnotationFocus();
  }, [focusAnnotationId, annotation.id]);

  const visuals = annotationVisualsFor(annotation.color ?? 'red');
  // 요구사항(2026-09-16): 메인 캔버스 AnnotationBubble.tsx의 `scale`(=fontScale)과
  // 완전히 같은 계산 — 이 주석이 달린 Text 객체 자신의 baseFontSize를
  // REFERENCE_FONT_SIZE(16) 대비 배율로 바꾸고, 폰트별 실제 렌더링 높이 차이까지
  // fontHeightScaleFor로 보정한다. object.baseFontSize가 16이면 fontScale=1(기존과
  // 동일한 크기), 그보다 크면 주석도 그 비율만큼 같이 커진다 — 메인 캔버스에서
  // "글자를 키우면 주석도 비례해서 커지는" 동작을 PDF 오버레이에도 그대로 맞춘다.
  const fontScale =
    (ownerBaseFontSize / REFERENCE_FONT_SIZE) * fontHeightScaleFor(ownerFontFamily || DEFAULT_FONT_FAMILY);
  // 보정 계수(SIZE_CAL): pdfRaster.ts의 PDF_OVERLAY_ABSOLUTE_SIZE_CALIBRATION 참고
  // (2026-09, 메인 캔버스 AnnotationBubble.tsx와 비슷한 크기로 보이게 하는 보정).
  // 폰트뿐 아니라 그 크기에 비례하는 여백/모서리 값도 전부 같이 곱해야 비율이 안
  // 무너진다 — fontScale도 마찬가지로 폰트/여백 양쪽에 함께 곱한다.
  const fontSize = (annotation.fontSize ?? 11) * fontScale * displayScale * SIZE_CAL;

  const syncFromDom = (el: HTMLDivElement) => {
    const nextText = el.textContent ?? '';
    if (nextText === annotation.text) return;
    usePdfOverlayStore.getState().updateAnnotationText(objectId, lineId, annotation.id, nextText);
  };

  const handleInput = (e: FormEvent<HTMLDivElement>) => {
    const composing = composingRef.current || (e.nativeEvent instanceof InputEvent && e.nativeEvent.isComposing);
    if (composing) return;
    syncFromDom(e.currentTarget);
  };

  const handleCompositionStart = () => {
    composingRef.current = true;
  };

  const handleCompositionEnd = (e: ReactCompositionEvent<HTMLDivElement>) => {
    composingRef.current = false;
    syncFromDom(e.currentTarget);
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing || composingRef.current || e.key === 'Process') return;
    if (e.key === 'Escape') {
      e.preventDefault();
      (e.currentTarget as HTMLElement).blur();
      return;
    }
    if (e.key === 'Backspace' && annotation.text.length === 0) {
      // 요구사항(빈 주석 정리): 본문 편집 로직과 같은 관례 — 내용이 빈 채로 Backspace를
      // 누르면 주석 자체를 지운다.
      e.preventDefault();
      usePdfOverlayStore.getState().removeAnnotation(objectId, lineId, annotation.id);
    }
  };

  return (
    <div
      className="pdf-overlay-annotation-note"
      style={{
        marginLeft: 10 * fontScale * displayScale * SIZE_CAL,
        marginTop: 2 * fontScale * displayScale * SIZE_CAL,
        marginBottom: 2 * fontScale * displayScale * SIZE_CAL,
        padding: `${2 * fontScale * displayScale * SIZE_CAL}px ${7 * fontScale * displayScale * SIZE_CAL}px`,
        borderRadius: 5 * fontScale * displayScale * SIZE_CAL,
        borderLeft: `${Math.max(2, 2 * fontScale * displayScale * SIZE_CAL)}px solid ${visuals.tick}`,
        background: visuals.selectedBg,
      }}
    >
      <div
        ref={divRef}
        className="pdf-overlay-annotation-note-text"
        data-annotation-id={annotation.id}
        data-object-id={objectId}
        data-owner-line-id={lineId}
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        style={{
          color: visuals.text,
          fontSize,
          fontFamily: annotation.fontFamily,
          lineHeight: 1.35,
          outline: 'none',
          minWidth: 12 * fontScale * displayScale * SIZE_CAL,
          wordBreak: 'break-word',
          // 버그 수정: 이 div도 .canvas-root(user-select:none)의 자손이라 그대로 두면
          // 형광펜 도구로 주석 자기 텍스트를 드래그해도 선택 자체가 안 생긴다(위
          // PdfOverlayTextView.tsx의 같은 수정과 동일한 이유) — 주석은 항상
          // contentEditable이라 별도 "이동 제스처와 충돌" 우려 없이 항상 켜둬도 된다.
          userSelect: 'text',
          WebkitUserSelect: 'text',
        }}
      />
    </div>
  );
}
