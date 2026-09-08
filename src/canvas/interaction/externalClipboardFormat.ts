import type { CanvasObject } from '../../types/object';

/**
 * 요구사항(2026-09, 다른 URL의 my_note_web 사이에서도 텍스트 상자/Frame Ctrl+C/V):
 * OS 시스템 클립보드(text/plain)에 캔버스 객체를 실어 보내기 위한 자체 포맷.
 *
 * clipboardStore.ts는 원래 "이 앱의 객체는 OS 클립보드 포맷(텍스트/이미지)으로 표현할
 * 수 없는 구조화된 데이터라서 시스템 클립보드를 쓰지 않는다"고 되어 있었지만, 그건
 * 같은 브라우저 탭(정확히는 같은 세션)에서만 붙여넣을 때 얘기다 — 완전히 다른 URL로
 * 열린 다른 세션(예: localhost와 Vercel 배포본)은 메모리 상태를 전혀 공유하지 않으므로
 * OS 클립보드 없이는 아예 방법이 없다. 여기서 하는 일은 "시스템 클립보드에 원격
 * 서비스를 거는 것"이 아니라 브라우저가 이미 제공하는 로컬 클립보드 텍스트 포맷에
 * 우리 데이터를 얹는 것뿐이라, 요구사항의 "외부 API/서비스 의존 금지"와 충돌하지
 * 않는다(navigator.clipboard 대신 이미 코드베이스 곳곳에서 쓰는 동기 ClipboardEvent
 * API만 사용 — TextObjectView.tsx의 handleCut 참고).
 *
 * 일반 텍스트 앞에 이 서명을 붙여서, 붙여넣기 쪽(useClipboardShortcuts.ts)이 "이
 * 텍스트가 정말 우리 앱이 만든 객체 데이터인지"를 다른 텍스트 붙여넣기(useTextPaste.ts)와
 * 확실히 구분할 수 있게 한다. 서명에 버전 번호를 넣어둬서, 나중에 포맷이 바뀌면 예전
 * 버전의 서명은 다르게 취급하도록 확장할 수 있다.
 *
 * 이미지(Image) 객체는 대상에서 뺀다 — 이미지의 실제 픽셀 데이터는 이 세션의
 * imageStore(메모리 전용 blob, objects/image/imageStore.ts)에만 있어서, 이 JSON에
 * imageId만 넣어봐야 다른 브라우저 세션에서는 그 id에 대응하는 그림이 없는 빈 참조일
 * 뿐이다(요구사항 자체도 텍스트 상자/Frame으로 한정한다). 선택 항목에 이미지가 섞여
 * 있어도 나머지(텍스트/Frame/화살표/사각형)만 걸러서 보낸다 — 전부 이미지뿐이면
 * null을 반환해 아무 것도 시스템 클립보드에 쓰지 않는다(내부 clipboardStore에는
 * 여전히 전부 복사되므로 같은 세션 안에서의 붙여넣기는 그대로 동작한다).
 */
const SIGNATURE = 'MY_NOTE_WEB_CLIPBOARD_V1:';

export function serializeExternalClipboard(objects: CanvasObject[]): string | null {
  const copyable = objects.filter((o) => o.type !== 'image');
  if (copyable.length === 0) return null;
  return SIGNATURE + JSON.stringify(copyable);
}

/** text/plain 문자열이 우리 서명으로 시작하면 객체 배열로 되돌리고, 아니거나 파싱에
 * 실패하면 null을 반환한다(호출부는 null이면 일반 텍스트 붙여넣기 등 다른 경로에
 * 그대로 맡긴다 — useClipboardShortcuts.ts 참고). */
export function deserializeExternalClipboard(text: string): CanvasObject[] | null {
  if (!text.startsWith(SIGNATURE)) return null;
  try {
    const parsed: unknown = JSON.parse(text.slice(SIGNATURE.length));
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed as CanvasObject[];
  } catch {
    return null;
  }
}
