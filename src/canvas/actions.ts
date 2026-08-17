import type { ArrowObject, CanvasObject, FrameObject, ImageObject, ShapeObject, TextObject } from '../types/object';
import { createPlainLine } from '../objects/text/indentation/types';
import { DEFAULT_FRAME_HEIGHT, DEFAULT_FRAME_WIDTH } from '../objects/frame/frameDefaults';
import { registerImageBlob, retainImage } from '../objects/image/imageStore';
import { computeDiagonal } from '../objects/shapes/shapeGeometry';
import { strokeColorValueFor } from '../objects/shapes/strokeColors';
import { useObjectsStore } from '../store/objectsStore';
import { useInteractionStore } from '../store/interactionStore';
import { useClipboardStore } from '../store/clipboardStore';
import { useToolStore } from '../store/toolStore';

const DEFAULT_TEXT_WIDTH = 220;
const DEFAULT_TEXT_HEIGHT = 60;
const MIN_TEXT_WIDTH = 60; // world px. 드래그로 이보다 좁게 그려도 최소한 타이핑 가능한 폭은 보장한다.
const MIN_TEXT_HEIGHT = 32; // world px. TextObjectView.tsx의 동일 이름 상수(런타임 자동 높이 하한)와 같은 값 — 생성 시 하한.
const MAX_IMAGE_DIM = 320; // world px. 원본이 이보다 크면 비율을 유지한 채 초기 크기를 줄인다.
const MIN_DRAW_DISTANCE = 4; // world px. 이보다 짧게 드래그하면(사실상 클릭) 도형을 만들지 않는다.
const PASTE_OFFSET_STEP = 24; // world px. 붙여넣을 때마다 원본에서 이만큼씩 더 벌어지게 놓는다.

export type ShapeToolId = 'arrow' | 'rectangle';

/** objectsStore.nextZIndex()의 얇은 재노출 — 이 파일의 spawn* 함수들이 쓰던 기존 이름을
 * 그대로 유지한다(Phase 7: 붙여넣기도 같은 로직이 필요해서 store 쪽으로 옮겼다). */
function nextZIndex(): number {
  return useObjectsStore.getState().nextZIndex();
}

/**
 * Phase 4(2차): 새 Text 객체를 world 좌표 (worldX, worldY)에 만들고 즉시 편집 상태로
 * 들어간다. width/height를 생략하면 각각 DEFAULT_TEXT_WIDTH/DEFAULT_TEXT_HEIGHT를
 * 쓴다(붙여넣기 등 드래그로 크기를 정하지 않는 경로용). 요구사항(텍스트 상자 생성/
 * 크기조절, 2차): height는 더 이상 내용에 맞춰서만 정해지지 않는다 — 사용자가 드래그로
 * 만들거나 resize handle로 조절한 값이 그대로 유지되고, 내용이 그 값보다 더 큰 높이를
 * 필요로 할 때만(넘칠 때만) TextObjectView.tsx의 effect가 자동으로 키운다(줄어드는
 * 방향으로는 절대 자동 조정하지 않음 — 그 effect의 hasAutoFitHeightOnceRef 주석 참고).
 *
 * frameId를 넘기면 그 Frame에 논리적으로 속한 Text가 된다(Frame이 이동하면
 * 같이 따라간다 — objectsStore.moveObjectTo 참고). Frame과 DOM 부모-자식 관계는
 * 아니다(요구사항: Frame과 Text는 완전히 별개의 객체).
 */
export function spawnTextAt(
  worldX: number,
  worldY: number,
  frameId: string | null = null,
  width: number = DEFAULT_TEXT_WIDTH,
  height: number = DEFAULT_TEXT_HEIGHT,
): string {
  const t = Date.now();
  const id = crypto.randomUUID();
  // 요구사항 6번: 상단 툴바에서 '텍스트' 도구를 고르면 미리 설정해둔 기본 색상/글꼴/
  // 크기/굵기/테두리 여부(toolStore.textColor/textFontFamily/textFontSize/textBold/
  // textBorderEnabled)를 새로 만드는 Text에 그대로 적용한다.
  const { textColor, textFontFamily, textFontSize, textBold, textBorderEnabled, textLineHeight } =
    useToolStore.getState();
  const obj: TextObject = {
    id,
    type: 'text',
    x: worldX,
    y: worldY,
    width,
    height,
    rotation: 0,
    zIndex: nextZIndex(),
    createdAt: t,
    updatedAt: t,
    lines: [createPlainLine('')],
    baseFontSize: textFontSize,
    color: textColor,
    fontFamily: textFontFamily,
    bold: textBold,
    borderEnabled: textBorderEnabled,
    lineHeight: textLineHeight,
    frameId,
  };
  useObjectsStore.getState().addObject(obj);
  useInteractionStore.getState().select(id);
  useInteractionStore.getState().setMode('text-edit');
  return id;
}

/**
 * 요구사항(텍스트 상자 생성 경로 통합, 2차): Text도 화살표/사각형과 완전히 동일한
 * 방식으로 만든다 — 상단 '텍스트' 도구를 고른 뒤 캔버스를 드래그해야만 생기고,
 * 드래그 거리가 MIN_DRAW_DISTANCE보다 짧으면(사실상 클릭) 아무것도 만들지 않는다
 * (canvas/interaction/useDrawTextTool.ts가 호출). 요구사항(텍스트 상자 생성/크기조절,
 * 2차): 드래그로 x/y/폭/높이가 전부 정해진다(화살표/사각형과 동일) — 너무 작게
 * 드래그해도 최소한 타이핑 가능한 크기(MIN_TEXT_WIDTH/MIN_TEXT_HEIGHT)는 보장한다.
 */
export function spawnTextFromDraft(
  start: { x: number; y: number },
  end: { x: number; y: number },
  frameId: string | null = null,
): string | null {
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  if (distance < MIN_DRAW_DISTANCE) return null;

  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.max(MIN_TEXT_WIDTH, Math.abs(end.x - start.x));
  const height = Math.max(MIN_TEXT_HEIGHT, Math.abs(end.y - start.y));
  return spawnTextAt(x, y, frameId, width, height);
}

/**
 * Phase 7: OS 클립보드(navigator 붙여넣기 이벤트)의 순수 텍스트로부터 새 Text 객체를
 * world 좌표 (worldX, worldY)에 만든다(canvas/interaction/useTextPaste.ts가 호출).
 * '텍스트' 도구로 빈 상자를 먼저 만들지 않아도, 텍스트를 복사한 뒤 캔버스에 바로
 * Ctrl+V하면 그 내용을 담은 Text가 즉시 생긴다 — Image의 OS 클립보드 붙여넣기
 * (useImagePaste.ts/spawnImageAt)와 완전히 같은 원리다.
 *
 * spawnTextAt과 달리 편집 모드로 들어가지 않고 선택만 한다(요구사항 범위 밖) —
 * pasteClipboardObjects(캔버스 객체 자체를 복사·붙여넣기)가 붙여넣은 뒤 선택만
 * 하는 것과 동일한 관례를 따른다. 줄바꿈이 포함된 텍스트는 줄 단위로 나눠 각각
 * TextLine이 된다.
 */
export function spawnTextFromClipboard(worldX: number, worldY: number, text: string, frameId: string | null = null): string {
  const t = Date.now();
  const id = crypto.randomUUID();
  const lines = text.split(/\r\n|\r|\n/).map((line) => createPlainLine(line));
  const { textColor, textFontFamily, textFontSize, textBold, textBorderEnabled, textLineHeight } =
    useToolStore.getState();
  const obj: TextObject = {
    id,
    type: 'text',
    x: worldX,
    y: worldY,
    width: DEFAULT_TEXT_WIDTH,
    height: DEFAULT_TEXT_HEIGHT,
    rotation: 0,
    zIndex: nextZIndex(),
    createdAt: t,
    updatedAt: t,
    lines: lines.length > 0 ? lines : [createPlainLine('')],
    baseFontSize: textFontSize,
    color: textColor,
    fontFamily: textFontFamily,
    bold: textBold,
    borderEnabled: textBorderEnabled,
    lineHeight: textLineHeight,
    frameId,
  };
  useObjectsStore.getState().addObject(obj);
  useInteractionStore.getState().select(id);
  return id;
}

/**
 * 새 Frame을 world 좌표 (worldX, worldY)를 좌상단으로 하여 만든다. width/height/style을
 * 생략하면 기존과 동일하게 A4 비율 기본 크기 + 흰 배경으로 만들어진다 — 사이드바(프레임
 * 도구를 고르면 뜨는 PropertiesPanel.tsx의 FrameDefaultsSection)에서 미리 골라둔 값은
 * Canvas.tsx가 toolStore에서 읽어 여기로 그대로 넘긴다. 생성 직후 바로 선택 상태로 두어
 * resize handle이 곧바로 보이게 한다(편집 모드는 아님 — Frame 자체는 텍스트 입력 영역이
 * 아니다).
 */
export function spawnFrameAt(
  worldX: number,
  worldY: number,
  width: number = DEFAULT_FRAME_WIDTH,
  height: number = DEFAULT_FRAME_HEIGHT,
  style?: FrameObject['style'],
  foldAxis?: FrameObject['foldAxis'],
  centerFold?: FrameObject['centerFold'],
): string {
  const t = Date.now();
  const id = crypto.randomUUID();
  const obj: FrameObject = {
    id,
    type: 'frame',
    x: worldX,
    y: worldY,
    width,
    height,
    rotation: 0,
    // Frame은 항상 다른 객체들보다 아래에 깔려야 한다(페이지 = 배경에 가깝다).
    zIndex: Math.min(0, ...Object.values(useObjectsStore.getState().objects).map((o) => o.zIndex)) - 1,
    createdAt: t,
    updatedAt: t,
    label: 'Frame',
    style,
    centerFold,
    foldAxis,
  };
  useObjectsStore.getState().addObject(obj);
  useInteractionStore.getState().select(id);
  return id;
}

/**
 * Phase 5: 이미지 파일(드래그앤드롭/붙여넣기/파일선택 대화상자 공통 진입점)로부터
 * 새 Image 객체를 만든다. imageStore.registerImageBlob이 실제 픽셀 크기를 측정해줄
 * 때까지 기다려야 하므로 비동기다. naturalWidth/Height는 원본 그대로 보존하고,
 * 화면에 놓이는 초기 width/height만 MAX_IMAGE_DIM 기준으로 축소한다(큰 사진이
 * 캔버스를 통째로 덮어버리지 않도록) — 종횡비는 항상 유지한다.
 */
export async function spawnImageAt(
  worldX: number,
  worldY: number,
  blob: Blob,
  frameId: string | null = null,
): Promise<string> {
  const { imageId, naturalWidth, naturalHeight } = await registerImageBlob(blob);
  const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(naturalWidth, naturalHeight));
  const width = Math.max(20, Math.round(naturalWidth * scale));
  const height = Math.max(20, Math.round(naturalHeight * scale));

  const t = Date.now();
  const id = crypto.randomUUID();
  const obj: ImageObject = {
    id,
    type: 'image',
    x: worldX,
    y: worldY,
    width,
    height,
    rotation: 0,
    zIndex: nextZIndex(),
    createdAt: t,
    updatedAt: t,
    imageId,
    naturalWidth,
    naturalHeight,
    aspectRatioLocked: true,
    frameId,
  };
  useObjectsStore.getState().addObject(obj);
  useInteractionStore.getState().select(id);
  return id;
}

/**
 * Phase 6: 화살표/사각형 도구로 캔버스를 드래그한 시작점→끝점(world 좌표)으로부터
 * 새 Arrow/Shape 객체를 만든다. canvas/interaction/useDrawShapeTool.ts의 pointerup에서
 * 호출된다. box(x/y/width/height)와 대각선 방향 플래그는 objects/shapes/shapeGeometry.ts
 * computeDiagonal이 계산한다 — 두 점을 canonical bounding box로 접어 넣어야
 * useObjectDrag/useObjectResize/SelectionOverlay를 그대로 재사용할 수 있기 때문이다
 * (types/object.ts의 ArrowObject 주석 참고).
 *
 * 드래그 거리가 MIN_DRAW_DISTANCE보다 짧으면(의도치 않은 미세한 흔들림, 사실상 클릭)
 * 아무것도 만들지 않고 null을 반환한다 — text/frame/image 도구는 클릭 한 번으로
 * 확정되지만 이 두 도구는 드래그 자체가 제스처라서 별도의 "너무 작음" 방지가 필요하다.
 *
 * frameId를 넘기면 그 Frame에 논리적으로 속한 도형이 된다(Frame이 이동하면 같이
 * 따라간다 — objectsStore.moveObjectTo 참고). Text/Image와 완전히 같은 원리.
 */
export function spawnShapeFromDraft(
  tool: ShapeToolId,
  start: { x: number; y: number },
  end: { x: number; y: number },
  strokeColorId: string,
  strokeWidth: number,
  frameId: string | null = null,
): string | null {
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  if (distance < MIN_DRAW_DISTANCE) return null;

  const { box, flipY, reverseDirection } = computeDiagonal(start, end);
  const t = Date.now();
  const id = crypto.randomUUID();
  const strokeColor = strokeColorValueFor(strokeColorId);
  // 요구사항(메뉴/사이드바 상태 통합): 사각형/화살표 사이드바에서 미리 설정해둔
  // 기본 모양(toolStore.shapeArrowHead/shapeLineStyle/shapeRounded/shapeFillEnabled/
  // shapeFillOpacity)을 그대로 적용한다 — 예전엔 이 다섯 값이 하드코딩돼 있었다.
  const {
    shapeArrowHead,
    shapeLineStyle,
    shapeRounded,
    shapeFillEnabled,
    shapeFillOpacity,
  } = useToolStore.getState();

  const obj: ArrowObject | ShapeObject =
    tool === 'arrow'
      ? {
          id,
          type: tool,
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          rotation: 0,
          zIndex: nextZIndex(),
          createdAt: t,
          updatedAt: t,
          strokeColor,
          strokeWidth,
          flipY,
          reverseArrow: reverseDirection,
          frameId,
          arrowHead: shapeArrowHead,
          lineStyle: shapeLineStyle,
        }
      : {
          id,
          type: tool,
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          rotation: 0,
          zIndex: nextZIndex(),
          createdAt: t,
          updatedAt: t,
          strokeColor,
          strokeWidth,
          frameId,
          rounded: shapeRounded,
          fillEnabled: shapeFillEnabled,
          fillOpacity: shapeFillOpacity,
          lineStyle: shapeLineStyle,
        };

  useObjectsStore.getState().addObject(obj);
  useInteractionStore.getState().select(id);
  return id;
}

/**
 * world 좌표가 어떤 Frame 위에 있는지 찾는다(여러 개 겹치면 zIndex가 가장 높은 것).
 * 이미지를 Frame 위에 드롭/배치하면 그 Frame에 논리적으로 소속시키기 위해 쓴다.
 * DOM data attribute로 판정하지 않고 world 좌표 hit-test로 판정한다 — 이 프로젝트에서
 * Frame/Text의 소속 관계는 항상 world 좌표가 단일 진실 원천이기 때문이다.
 */
export function findFrameAt(worldX: number, worldY: number): string | null {
  let best: FrameObject | null = null;
  for (const o of Object.values(useObjectsStore.getState().objects)) {
    if (o.type !== 'frame') continue;
    const inside = worldX >= o.x && worldX <= o.x + o.width && worldY >= o.y && worldY <= o.y + o.height;
    if (inside && (!best || o.zIndex > best.zIndex)) best = o;
  }
  return best?.id ?? null;
}

/**
 * Phase 7: clipboardStore에 담긴 마지막 복사본을 새 id로 붙여넣는다(canvas/interaction/
 * useClipboardShortcuts.ts의 Ctrl+V가 호출). 원본과 겹치지 않도록 붙여넣을 때마다
 * PASTE_OFFSET_STEP만큼 더 벌어지게 놓는다(Illustrator류의 "계속 누르면 계단식으로
 * 벌어짐" 관례) — 새로 Ctrl+C하면 clipboardStore.copy()가 pasteCount를 0으로
 * 리셋하므로 다시 원본 위치 바로 옆부터 시작한다.
 *
 * Frame이 복사 대상에 포함돼 있어도 그 Frame에 속했던 다른 객체들까지 함께 복제하지는
 * 않는다(요구사항 범위 밖 — Frame 삭제가 하위 객체를 연쇄 삭제하지 않는 것과 같은
 * 원칙: Frame 소속 관계는 항상 명시적으로만 바뀐다). 복사된 객체가 원래 frameId를
 * 갖고 있었다면(그 Frame 자신이 복사 대상이 아니었더라도) 그대로 유지한다 — 같은
 * Frame 안에 붙여넣기 하는 흔한 경우를 자연스럽게 만들기 위해서다.
 *
 * Image 객체는 Blob을 다시 인코딩하지 않고 같은 imageId를 공유한다 — 대신
 * imageStore.retainImage로 참조 카운트를 올려서, 원본이나 사본 중 하나를 지워도
 * 나머지가 멀쩡하게 남아있도록 한다.
 */
export function pasteClipboardObjects(): string[] {
  const { objects: clipboard, bumpPasteCount } = useClipboardStore.getState();
  if (clipboard.length === 0) return [];

  const step = bumpPasteCount();
  const offset = PASTE_OFFSET_STEP * step;
  const t = Date.now();
  let z = nextZIndex();
  const newIds: string[] = [];

  const pasted: CanvasObject[] = clipboard.map((original) => {
    const clone = structuredClone(original) as CanvasObject;
    const id = crypto.randomUUID();
    newIds.push(id);
    clone.id = id;
    clone.x = original.x + offset;
    clone.y = original.y + offset;
    clone.zIndex = z++;
    clone.createdAt = t;
    clone.updatedAt = t;
    if (clone.type === 'image' && clone.imageId) retainImage(clone.imageId);
    return clone;
  });

  useObjectsStore.getState().addObjects(pasted);
  useInteractionStore.getState().setSelection(newIds);
  return newIds;
}
