/**
 * PDF Library/Reference Viewer 데이터 모델.
 *
 * 설계 문서: pdf_import_plan_v3.md(설계 원칙) + 2026-08-27 세 번째 라운드 확정사항.
 * 핵심 원칙:
 * - PDF는 Canvas 객체가 아니다 — types/object.ts의 CanvasObject union과는 완전히 분리된
 *   타입이다(BaseObject를 extends하지 않는다).
 * - Library 소속은 File이 아니라 **Page 단위**다(PdfLibraryRecord.pageId).
 * - PDF 페이지 위 필기 객체(Overlay)는 기존 CanvasObject 타입(TextObject/ArrowObject/
 *   ShapeObject/ImageObject)을 그대로 재사용한다 — 새 객체 타입을 만들지 않는다. 주석은
 *   TextObject.lines[].annotations에 이미 포함되어 있으므로 별도 처리가 필요 없다(Text를
 *   오버레이에 올리면 주석 기능이 자동으로 딸려온다).
 * - Overlay 객체의 x/y/width/height는 world 좌표가 아니라 "PDF 페이지 로컬 좌표"다 —
 *   페이지의 고정 기준 배율(PDF_PAGE_REFERENCE_SCALE, pdfRaster.ts에서 페이지를 렌더링할
 *   때 쓰는 것과 동일한 기준)로 저장되고, 실제 화면에 그릴 때만 그 순간의 표시 배율을 곱한다
 *   (IndentAnchor.offsetPx/Annotation.offsetX와 같은 "저장은 zoom-불변, 렌더 시에만 배율 적용"
 *   관례를 그대로 따른다).
 * - Frame은 PDF 오버레이에서 지원하지 않는다(의미가 모호하다고 판단, 사용자 확정).
 */

import type { ArrowObject, ImageHighlight, ImageObject, ShapeObject, TextObject } from './object';

/**
 * Library에 등록된 PDF 한 건. 반드시 어떤 Page에 종속된다(File 아님) — 그 Page를
 * 열었을 때만 좌측 Library 레일에 나타난다. 같은 PDF를 여러 Page에서 쓰려면 각각
 * 별도로 가져와야 한다(v3 §1-1에서 확인된 트레이드오프, 의도된 동작).
 */
export interface PdfLibraryRecord {
  id: string;
  pageId: string;
  /** 사용자가 부여/수정 가능한 이름. 기본값은 원본 파일명에서 확장자를 뗀 것. */
  name: string;
  pageCount: number;
  createdAt: number;
  updatedAt: number;
  /** Viewer를 다시 열었을 때 이 페이지로 복원한다(수업 진도 확인 용도). */
  lastViewedPageIndex?: number;
  /**
   * 요구사항(2026-09-15, 라이브러리 드래그 순서 변경): 같은 Page 안에서 이 PDF가
   * 목록의 몇 번째에 오는지(작을수록 앞). 낮은 정수를 연속으로 재부여하는 방식이라
   * (store/pdfLibraryStore.ts § reorderPdf) 값 자체에 의미는 없고 상대적 순서만
   * 중요하다. 이 필드가 생기기 전에 저장된 기존 레코드에는 없을 수 있어 optional —
   * pdfLibraryStore.ts의 loadForPage가 없는 값을 만나면 createdAt 기준으로 한 번
   * 채워 넣고 그 결과를 다시 저장한다(이후로는 항상 존재).
   */
  order?: number;
  /**
   * 원본 PDF 바이트. 영구 보존한다(v3 §1-4) — 페이지 래스터는 전부 저장하지 않고
   * 이 원본에서 그때그때 다시 렌더링하는 것이 기본 전략이라, 이 필드가 없으면 페이지를
   * 다시 볼 수 없게 된다. Blob이 아니라 ArrayBuffer로 저장한다(idb의 구조화 복제 저장에는
   * 문제없고, pdfjs.getDocument({data: ArrayBuffer})로 바로 열 수 있어서 매번 Blob→
   * ArrayBuffer 변환을 안 해도 된다).
   */
  sourceBytes: ArrayBuffer;
}

/**
 * 페이지 래스터 캐시 — 전체 페이지를 영구 저장하지 않는다(v3 §1-4, 저장 용량 재검토 결과).
 * "최근 본 페이지 한두 장만" 정도의 작은 캐시로 취급하고, 없으면 pdfRaster.ts가 원본에서
 * 즉석 재렌더링한다. 캐시가 사라져도(용량 정리 등) 데이터 손실이 아니다 — 항상 원본에서
 * 재현 가능한 파생 데이터일 뿐이다.
 */
export interface PdfPageRasterCache {
  /** `${pdfId}:${pageIndex}` */
  id: string;
  pdfId: string;
  pageIndex: number;
  blob: Blob;
  /** 페이지 기준 배율(PDF_PAGE_REFERENCE_SCALE)로 렌더링된 실제 픽셀 크기. Overlay 좌표
   * 환산(§ pdfRaster.ts) 및 화면 표시 비율 계산에 쓰인다. */
  width: number;
  height: number;
}

/**
 * 한 PDF 페이지 위에 놓인 필기 객체들의 묶음. `${pdfId}:${pageIndex}`로 식별된다.
 * 실제로 필기가 있는 페이지만 레코드가 생긴다(대부분의 페이지는 레코드 자체가 없음).
 */
export interface PdfPageOverlay {
  /** `${pdfId}:${pageIndex}` */
  id: string;
  pdfId: string;
  pageIndex: number;
  /**
   * Text/Arrow/Rectangle/Image 객체(기존 CanvasObject 타입 그대로 재사용, world 객체가
   * 아니라 §위 설명대로 페이지 로컬 좌표로 해석된다는 점만 다르다). Frame은 여기 포함되지
   * 않는다 — OverlayObject 유니온 자체에 FrameObject가 없다.
   */
  objects: OverlayObject[];
  /**
   * "형광펜" 중 페이지 배경(래스터) 자체에 직접 그은 직선 하이라이트. 기존
   * `ImageObject.highlights`와 완전히 같은 타입/좌표 관례(0~1 비율)를 재사용한다 —
   * PDF 페이지도 텍스트 없는 래스터라는 점에서 ImageObject와 조건이 같다
   * (objects/pdf/pdfRaster.ts 및 canvas/interaction/useImageHighlightTool.ts의 기존 주석
   * "이미지/PDF 전용 직선 형광펜" 참고). Text 객체 위의 형광펜(문자 range 기반)은 이 배열이
   * 아니라 그 Text 객체 자신의 TextLine.highlights에 들어간다 — 서로 다른 메커니즘이다.
   */
  pageHighlights: ImageHighlight[];
}

/** PDF 페이지 오버레이에 올라갈 수 있는 객체 타입. Frame은 의도적으로 제외되어 있다.
 * 새 타입을 추가하지 않고 기존 CanvasObject 구성원 중 일부만 골라 쓰는 것이므로, 메인
 * Canvas 쪽에 새 객체 타입(예: line/circle)이 생기면 여기 유니온에 추가하는 것만으로
 * 확장된다. */
export type OverlayObject = TextObject | ArrowObject | ShapeObject | ImageObject;

export type OverlayObjectType = OverlayObject['type'];
