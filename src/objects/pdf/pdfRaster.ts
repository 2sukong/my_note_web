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
