import { getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import './pdfjsSetup';

/**
 * PDF 페이지를 항상 이 배율(포인트 단위 원본 대비)로 렌더링/저장한다. Overlay 객체의
 * x/y/width/height(types/pdf.ts의 PdfPageOverlay.objects)는 이 배율 기준의 "페이지 로컬
 * px"로 저장된다 — 화면 표시 배율이 나중에 달라져도(Viewer 리사이즈, 페이지 확대 등)
 * 저장값 자체는 안 바뀌고, 렌더링 시점에만 `현재 표시 배율 / PDF_PAGE_REFERENCE_SCALE`을
 * 곱해서 실제 화면 px로 변환한다.
 *
 * 2로 잡은 이유: 일반적인 디스플레이 스케일링(레티나 등)에서도 텍스트가 흐려 보이지 않을
 * 정도의 해상도이면서, 페이지당 래스터 용량이 과하게 커지지 않는 절충값(v3 §1-4).
 */
export const PDF_PAGE_REFERENCE_SCALE = 2;

/**
 * 요구사항(2026-09, "텍스트/주석 크기가 기존 페이지와 비슷하게"): PDF 오버레이의
 * 절대 크기 값(글자 크기 baseFontSize, 주석 여백/글자 크기 등 — 위치/폭/높이처럼
 * %로 표현되지 않고 PdfOverlayTextView.tsx/PdfOverlayAnnotationNote.tsx가
 * `값 * displayScale`로 CSS px로 바꾸는 값들)에 곱하는 보정 계수.
 *
 * displayScale(화면에 실제로 그려지는 px / 페이지 로컬 px)만 곱하면, 기본 Viewer 폭
 * (PDF_VIEWER_DEFAULT_WIDTH=420px, pdfViewerStore.ts)이 PDF_PAGE_REFERENCE_SCALE(2)
 * 배율로 래스터된 일반적인 A4/Letter 페이지 폭(~1190~1224px)보다 훨씬 좁아서,
 * displayScale이 기본값 기준 대략 0.33~0.35 정도로 작다 — 그 결과 메인 캔버스와
 * "같은 숫자"를 글자 크기로 넣어도 실제 화면에는 3배가량 작게 보였다(사용자 확인,
 * 2026-09: PDF 쪽 48pt가 메인 캔버스 16px 정도로 보임). 이 계수(위 비율의 역수를
 * 반올림한 값)를 displayScale에 곱해 보정하면, 기본 Viewer 폭 기준으로 같은 숫자가
 * 메인 캔버스와 비슷한 크기로 보인다.
 *
 * 페이지마다 실제 원본 크기가 달라 완벽히 정확한 값은 아니다(정확히 맞추려면 그
 * PDF의 실제 raster 폭까지 감안해야 하는데, 그러면 Viewer를 넓힐수록/PDF 페이지를
 * 확대할수록 글자도 커지는 지금의 "화면에 보이는 그대로" 동작 자체가 사라진다 — 그건
 * 의도된 동작이라 유지한다). 기본값 기준으로 맞춰두면 충분히 자연스럽다.
 */
export const PDF_OVERLAY_ABSOLUTE_SIZE_CALIBRATION = 3;

/**
 * 원본 PDF 바이트에서 문서를 연다. `PdfLibraryRecord.sourceBytes`(항상 영구 보존, 절대
 * 지우지 않음)를 넘겨서 호출한다 — 페이지 래스터 캐시가 없거나 사라졌어도 이 함수로
 * 언제든 다시 열어 필요한 페이지를 재렌더링할 수 있다(v3 §1-4의 "래스터는 파생 데이터"
 * 원칙이 성립하는 근거).
 *
 * ArrayBuffer는 pdfjs가 내부적으로 transfer/detach할 수 있으므로, 호출자가 같은 버퍼를
 * 재사용해야 한다면(예: IndexedDB에서 막 읽어온 sourceBytes를 저장 로직에도 써야 하는
 * 경우) 반드시 `.slice(0)`로 복사본을 넘길 것.
 */
export function openPdfDocument(sourceBytes: ArrayBuffer): Promise<PDFDocumentProxy> {
  return getDocument({ data: sourceBytes }).promise;
}

export interface RenderedPdfPage {
  blob: Blob;
  width: number;
  height: number;
}

/**
 * 페이지 하나를 PDF_PAGE_REFERENCE_SCALE 배율로 <canvas>에 렌더링해 Blob으로 만든다.
 * pageIndex는 0-based(pdfjs의 getPage는 1-based이므로 내부에서 +1 보정).
 *
 * 온디맨드 렌더링 전략(v3 §1-4): 이 함수는 캐시를 스스로 확인하지 않는다 — 호출하는 쪽
 * (store/pdfLibraryStore.ts)이 PdfPageRasterCache에 이미 있는지 먼저 보고, 없을 때만
 * 이 함수를 불러 새로 렌더링한 뒤 "최근 본 1~2페이지" 정도로만 캐시를 채우는 정책을
 * 담당한다 — 이 함수 자체는 순수하게 "한 페이지를 렌더링한다"는 책임만 진다.
 */
export async function renderPdfPage(doc: PDFDocumentProxy, pageIndex: number): Promise<RenderedPdfPage> {
  const page = await doc.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale: PDF_PAGE_REFERENCE_SCALE });

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  // pdfjs-dist v5부터 canvas를 직접 넘기는 쪽이 권장 방식이다(canvasContext는 하위호환용,
  // 문서상 canvas와 같이 쓰지 않는 게 맞다 — canvas를 넘기면 pdfjs가 내부에서 2D 컨텍스트를
  // 알아서 얻는다).
  await page.render({ canvas, viewport }).promise;

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PDF 페이지 렌더링 결과를 이미지로 변환하지 못했습니다.');

  return { blob, width: canvas.width, height: canvas.height };
}
