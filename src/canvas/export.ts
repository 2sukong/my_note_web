import { toPng, toJpeg } from 'html-to-image';
import { jsPDF } from 'jspdf';
import { useObjectsStore } from '../store/objectsStore';
import { loadAllFontRecords } from '../store/fontPersistence';
import type { CanvasObject, FrameObject } from '../types/object';

/**
 * 요구사항(PNG/JPG/PDF 내보내기, 프레임 단위): Frame은 "종이 한 장"이라는 개념과
 * 가장 잘 맞아서(architecture_analysis.md, FrameObjectView.tsx 주석 참고) 내보내기
 * 단위로 프레임을 골랐다(원래 화면에 보이는 대로: 사용자가 우클릭한 그 프레임 하나).
 *
 * 구현 방식: 브라우저에 직접 손으로 "DOM을 SVG로 직렬화 → Canvas로 그리기"를
 * 구현하는 대신 html-to-image(순수 클라이언트, 네트워크 요청 없음)를 쓴다 —
 * architecture_analysis.md 4절이 idb를 채택한 논리와 같다: "완성된 서비스에
 * 의존"하는 게 아니라 "브라우저 API(SVG foreignObject 렌더링)를 더 쓰기 편하게
 * 감싸는 유틸"일 뿐이라 원칙 9번(외부 API/서비스 의존하지 않음)과 충돌하지 않는다.
 * DOM 트리를 손으로 다시 그리는 자체 구현은 폰트/그라디언트/컨텐트에디터블 등 온갖
 * 엣지 케이스에서 깨지기 쉬워, 검증된 소규모 유틸에 위임하는 편이 프로젝트 원칙
 * (핵심 구조는 직접 설계하되, 검증된 브라우저 API 래퍼까지 전부 재발명하지는 않음)에
 * 더 맞는다고 판단했다. PDF는 jsPDF로 그 PNG를 한 장짜리 페이지에 붙여넣는다.
 *
 * Frame은 Text/Image/Arrow/Rectangle의 DOM 부모가 아니라 논리적 소속(frameId)일
 * 뿐이라(types/object.ts 주석), 프레임 자신의 DOM 서브트리만 캡처하면 그 위에
 * "보이는" 다른 객체들이 전혀 안 찍힌다. 그래서 프레임 자신의 DOM이 아니라
 * canvas-world 전체를 캡처 대상으로 삼되:
 *  1) style.transform으로 프레임의 좌상단이 출력 이미지의 (0,0)에 오도록 평행이동하고
 *     zoom을 1로 고정한다(현재 화면 줌과 무관하게 항상 "world 해상도"로 내보내짐).
 *  2) filter로 프레임의 바운딩 박스와 겹치는 객체(data-object-id, ObjectView.tsx)만
 *     남기고 나머지 객체 + 선택 테두리/마퀴/정렬 가이드 같은 편집 중 UI chrome
 *     (data-export-exclude, Canvas.tsx)은 통째로 제외한다.
 */

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function intersects(a: Box, b: Box): boolean {
  return !(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
}

function findCanvasWorldEl(): HTMLElement {
  const el = document.querySelector('.canvas-world');
  if (!(el instanceof HTMLElement)) {
    throw new Error('캔버스를 찾을 수 없습니다.');
  }
  return el;
}

function buildIncludedObjectIds(frame: FrameObject, objects: Record<string, CanvasObject>): Set<string> {
  const frameBox: Box = { x: frame.x, y: frame.y, width: frame.width, height: frame.height };
  const includedIds = new Set<string>();
  for (const obj of Object.values(objects)) {
    if (intersects(frameBox, obj)) includedIds.add(obj.id);
  }
  return includedIds;
}

const CUSTOM_FONT_FAMILY_PREFIX = 'user-font-';

/**
 * 버그 수정(내보낸 이미지의 폰트가 실제 사용 중인 폰트와 다르게 나오던 문제):
 * html-to-image는 폰트를 자동으로 감지해서 base64로 임베드해주는 기능
 * (embedWebFonts, embed-webfonts.js)이 있지만, 이건 document.styleSheets에
 * 실제로 등록된 @font-face CSS 규칙만 훑는다. 이 앱이 사용자가 업로드한 폰트를
 * 등록하는 방식(store/fontStore.ts)은 new FontFace(...) + document.fonts.add(...)
 * 라는 JS API라서 CSSOM에 @font-face 규칙이 전혀 생기지 않고, 그래서
 * html-to-image 입장에서는 이 폰트가 아예 "안 보인다" — 결국 브라우저가 알아서
 * 시스템 폴백 폰트로 대체해 렌더링해버린다. 그래서 여기서 내보낼 프레임 안에서
 * 실제로 쓰인 커스텀 폰트 family들을 직접 찾아서, 이미 IndexedDB에 저장해둔
 * 원본 바이트(fontPersistence.ts)로부터 @font-face CSS를 직접 만들어
 * options.fontEmbedCSS로 넘긴다 — 이 옵션이 설정되면 html-to-image는 자동
 * 감지를 건너뛰고 이 CSS를 그대로 쓴다.
 */
function collectUsedCustomFontFamilies(includedIds: Set<string>, objects: Record<string, CanvasObject>): Set<string> {
  const families = new Set<string>();
  const consider = (family: string | undefined) => {
    if (family && family.startsWith(CUSTOM_FONT_FAMILY_PREFIX)) families.add(family);
  };
  for (const id of includedIds) {
    const obj = objects[id];
    if (!obj || obj.type !== 'text') continue;
    consider(obj.fontFamily);
    for (const line of obj.lines) {
      for (const run of line.runs) consider(run.fontFamily);
      for (const annotation of line.annotations ?? []) consider(annotation.fontFamily);
    }
  }
  return families;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK_SIZE = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
  }
  return btoa(binary);
}

function guessFontMimeType(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer.slice(0, 4));
  const sig = String.fromCharCode(...bytes);
  if (sig === 'wOFF') return 'font/woff';
  if (sig === 'wOF2') return 'font/woff2';
  if (sig === 'OTTO') return 'font/otf';
  return 'font/ttf';
}

async function buildCustomFontEmbedCSS(usedFamilies: Set<string>): Promise<string> {
  if (usedFamilies.size === 0) return '';
  const records = await loadAllFontRecords();
  const rules: string[] = [];
  for (const record of records) {
    if (!usedFamilies.has(record.family)) continue;
    const base64 = arrayBufferToBase64(record.data);
    const mime = guessFontMimeType(record.data);
    rules.push(`@font-face { font-family: '${record.family}'; src: url(data:${mime};base64,${base64}); }`);
  }
  return rules.join('\n');
}

async function rasterizeFrame(frame: FrameObject, format: 'png' | 'jpeg'): Promise<string> {
  const worldEl = findCanvasWorldEl();
  const objects = useObjectsStore.getState().objects;
  const includedIds = buildIncludedObjectIds(frame, objects);

  const filter = (node: HTMLElement) => {
    const dataset = node.dataset;
    if (!dataset) return true;
    if (dataset.exportExclude === 'true') return false;
    if (dataset.objectId) return includedIds.has(dataset.objectId);
    return true;
  };

  const usedCustomFontFamilies = collectUsedCustomFontFamilies(includedIds, objects);
  const customFontEmbedCSS = await buildCustomFontEmbedCSS(usedCustomFontFamilies);

  const width = Math.max(1, Math.round(frame.width));
  const height = Math.max(1, Math.round(frame.height));
  const options = {
    filter,
    width,
    height,
    pixelRatio: 2,
    backgroundColor: '#ffffff',
    fontEmbedCSS: customFontEmbedCSS,
    style: {
      transform: `translate(${-frame.x}px, ${-frame.y}px)`,
      transformOrigin: '0 0',
      // 주의(버그 수정: 프레임 내보내기가 항상 백지로 나오던 문제의 원인): 여기 overflow:'hidden'을
      // 절대 넣지 말 것. CSS에서 overflow 클리핑은 transform이 적용되기 "이전"의 로컬 박스
      // 기준으로 계산된다 — canvas-world는 위 transform으로 화면상 위치만 옮겨질 뿐, 그
      // 자신의 로컬 박스는 여전히 (0,0)~(width,height)(=frame 크기)이므로, 그보다 훨씬 큰
      // world 좌표(예: frame.x=700일 때 objectId의 x=760)에 있는 자식들은 로컬 박스 밖으로
      // 벗어나 overflow:hidden에 의해 transform이 적용되기도 전에 통째로 잘려나가 버린다
      // (그 결과 프레임 자신조차 백지로 내보내졌다). 최종 출력 크기는 어차피 아래 width/
      // height와 toPng/toJpeg가 만드는 svg의 width/height(viewBox)로 이미 고정되므로,
      // 여기서 별도로 overflow를 잘라낼 필요가 없다 — 그 svg 자체가 이미 정확한 크기의
      // 캔버스로 래스터라이즈되면서 자연스럽게 그 경계 밖은 그려지지 않는다.
    },
  };

  return format === 'png' ? toPng(worldEl, options) : toJpeg(worldEl, options);
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

function safeFileName(label: string | undefined): string {
  const base = (label ?? 'frame').trim() || 'frame';
  return base.replace(/[\\/:*?"<>|]/g, '_');
}

export async function exportFrameAsPng(frame: FrameObject): Promise<void> {
  const dataUrl = await rasterizeFrame(frame, 'png');
  downloadDataUrl(dataUrl, `${safeFileName(frame.label)}.png`);
}

export async function exportFrameAsJpg(frame: FrameObject): Promise<void> {
  const dataUrl = await rasterizeFrame(frame, 'jpeg');
  downloadDataUrl(dataUrl, `${safeFileName(frame.label)}.jpg`);
}

export async function exportFrameAsPdf(frame: FrameObject): Promise<void> {
  const dataUrl = await rasterizeFrame(frame, 'png');
  // Frame 자체의 가로세로 비율(world 단위) 그대로 PDF 페이지 크기를 잡는다 — A4든
  // 와이드스크린이든 사용자가 고른 프레임 크기(objects/frame/frameDefaults.ts)를
  // 그대로 따라간다. 단위는 pt(포인트)를 그대로 world px 값처럼 취급한다 — 별도
  // mm 환산을 하지 않아도 "프레임 비율이 그대로 유지되는 한 장짜리 PDF"라는
  // 목적에는 충분하고, 필요하면 사용자가 프린트/뷰어에서 맞춰 볼 수 있다.
  const pdf = new jsPDF({
    orientation: frame.width >= frame.height ? 'landscape' : 'portrait',
    unit: 'pt',
    format: [frame.width, frame.height],
  });
  pdf.addImage(dataUrl, 'PNG', 0, 0, frame.width, frame.height);
  pdf.save(`${safeFileName(frame.label)}.pdf`);
}
