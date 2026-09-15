import { useEffect, useRef } from 'react';
import type { CanvasObject } from '../../types/object';
import { useInteractionStore } from '../../store/interactionStore';
import { useObjectsStore } from '../../store/objectsStore';
import { useViewportStore } from '../../store/viewportStore';
import { useClipboardStore } from '../../store/clipboardStore';
import { pasteClipboardObjects, pasteExternalObjects } from '../actions';
import { deserializeExternalClipboard, serializeExternalClipboard } from './externalClipboardFormat';

/**
 * Phase 7: 선택된 캔버스 객체(Text/Image/Frame/Arrow/Rectangle)의 Ctrl/Cmd+C(복사)·
 * X(잘라내기)·V(붙여넣기). 내부 clipboardStore(canvas 객체 전용)를 기본으로 쓰되,
 * 요구사항(2026-09, 다른 URL의 my_note_web 사이에서도 Ctrl+C/V)에 따라 OS 시스템
 * 클립보드에도 같은 데이터를 함께 실어 보낸다 — 그래야 완전히 다른 브라우저 세션
 * (localhost ↔ Vercel 배포본 등, 메모리 상태를 전혀 공유하지 않는 경우)에서도
 * 붙여넣기가 된다.
 *
 * 버그 수정(요구사항: Frame 등을 복사해둔 채로 스크린샷을 찍고 Ctrl+V하면 스크린샷
 * 대신 예전에 복사한 Frame이 붙여넣어짐): 예전엔 Ctrl+V의 keydown 핸들러가 "이 세션
 * 안에서 뭔가 한 번이라도 복사한 적 있는지"(clipboardStore가 비어있는지)만 보고
 * 그 자리에서 바로 pasteClipboardObjects()를 실행하며 preventDefault했다 — 그러면
 * 브라우저가 뒤이어 합성하는 네이티브 'paste' 이벤트 자체가 아예 발생하지 않아서
 * (keydown의 preventDefault가 paste 이벤트 합성을 막는다), OS 클립보드가 그 사이에
 * 스크린샷 이미지나 다른 텍스트로 바뀌었어도 그걸 확인할 방법이 없이 항상 예전에
 * 복사해둔 객체만 다시 붙여넣어졌다. keydown 시점엔 실제 OS 클립보드 내용을 읽을
 * 방법이 없으므로(clipboardData는 clipboard 이벤트 안에서만 주어진다), 이제 Ctrl+V는
 * keydown에서 아무 것도 하지 않고 항상 네이티브 'paste' 이벤트가 발생하도록 그대로
 * 흘려보낸다 — 실제 판단은 전부 아래 handlePaste(진짜 OS 클립보드 내용을 보는 시점)로
 * 옮겼다:
 *   1. OS 클립보드에 이미지 파일이 있으면(스크린샷 등) 이 훅은 관여하지 않고 그대로
 *      둔다 — useImagePaste.ts가 처리한다(항상 최우선).
 *   2. 아니고 OS 클립보드 텍스트가 우리 서명(MY_NOTE_WEB_CLIPBOARD_V1:)으로 시작하면
 *      캔버스 객체로 복원한다 — clipboardStore에 그 원본이 아직 있으면(=같은 탭 안에서
 *      방금 복사한 경우) pasteClipboardObjects로 원본 위치 기준 살짝 어긋난 위치에
 *      놓고(기존 동작 그대로), 없으면(다른 세션/오리진에서 복사된 경우) pasteExternalObjects로
 *      화면 중앙에 놓는다.
 *   3. OS 클립보드 텍스트가 아예 비어있는데(=이미지도 우리 서명도 아닌, 즉 Image
 *      객체만 복사해서 애초에 OS 클립보드를 건드리지 않은 경우) clipboardStore에
 *      뭔가 남아있으면 그걸로 붙여넣는다(pasteClipboardObjects) — Image 객체는
 *      OS 클립보드로 표현할 수 없으므로 이 fallback이 유일한 경로다.
 *   4. 그 외(우리 서명이 아닌 일반 텍스트 등)는 관여하지 않는다 — useTextPaste.ts의 몫.
 *
 * mode === 'text-edit'일 때는 전혀 관여하지 않는다(useImagePaste.ts와 동일한 관례) —
 * 그 안에서의 Ctrl+C/V는 브라우저 contentEditable의 기본 텍스트 복사/붙여넣기여야 한다.
 * 'select'/'idle' 등 그 외 모드에서만 동작하므로, 객체를 선택했다가 캔버스 빈 곳을
 * 클릭해 선택을 해제한(mode='idle') 뒤에도 여전히 붙여넣기는 가능하다.
 *
 * 이 훅이 useImagePaste.ts/useTextPaste.ts보다 먼저 마운트돼야(Canvas.tsx의 호출
 * 순서 참고) 아래 handlePaste가 'paste' 리스너 중 가장 먼저 실행되고, 우리가 실제로
 * 처리한 경우에만(2/3번) stopImmediatePropagation으로 나머지 두 훅이 같은 이벤트를
 * 또 처리해서 엉뚱한 객체가 함께 생기는 것을 막는다. 1번(이미지)과 4번(관여 안 함)은
 * stopImmediatePropagation하지 않고 그대로 흘려보내 각자의 몫인 훅이 처리하게 한다.
 */
export function useClipboardShortcuts() {
  // execCommand('copy')로 강제 발생시킨 동기 'copy' 이벤트 핸들러가 "지금 막 클립보드에
  // 실어야 할 JSON 문자열"을 넘겨받는 용도. state가 아니라 ref인 이유: 이 값은 렌더링과
  // 무관한 일회성 전달값이고, keydown 핸들러(클로저가 마운트 시점에 한 번만 만들어짐)와
  // copy 핸들러가 항상 최신 값을 공유해야 하기 때문이다.
  const pendingExternalPayloadRef = useRef<string | null>(null);

  useEffect(() => {
    // 요구사항(2026-09, 다른 URL의 my_note_web 사이에서도 Ctrl+C/V): 실제 브라우저
    // Selection이 없는 캔버스에서는 Ctrl+C를 눌러도 네이티브 'copy' 이벤트가 저절로
    // 발생하지 않는다(복사할 선택 영역 자체가 없으므로) — document.execCommand('copy')로
    // 그 이벤트를 직접 합성해서 발생시킨다(TextObjectView.tsx의 handleCut이 이미
    // clipboardData.setData를 쓰는 것과 같은 동기 ClipboardEvent API 계열 —
    // navigator.clipboard의 비동기 권한 모델을 새로 끌어들이지 않는다). execCommand
    // 자체는 폐기 예정(deprecated) 표시가 붙어 있지만 이 용도(임의 데이터를 클립보드에
    // 실어 보내기 위해 copy 이벤트만 합성)로는 여전히 모든 주요 브라우저가 지원한다.
    const handleCopyEvent = (e: ClipboardEvent) => {
      const payload = pendingExternalPayloadRef.current;
      if (payload === null) return;
      pendingExternalPayloadRef.current = null;
      e.clipboardData?.setData('text/plain', payload);
      e.preventDefault();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey;
      if (!isMod) return;
      const key = e.key.toLowerCase();
      // 버그 수정: Ctrl+V(key==='v')는 더 이상 여기서 다루지 않는다 — keydown 시점엔
      // 실제 OS 클립보드 내용을 읽을 수 없어(clipboardData는 clipboard 이벤트 전용)
      // "이 세션에서 뭔가 복사한 적 있는지"만으로 판단할 수밖에 없었고, 그게 스크린샷
      // 등으로 OS 클립보드가 바뀐 뒤에도 항상 예전 복사본을 붙여넣는 버그의 원인이었다
      // (위 함수 docstring 참고). 이제 Ctrl+V는 항상 그대로 흘려보내 네이티브 'paste'
      // 이벤트가 발생하게 하고, 실제 판단은 전부 아래 handlePaste에서 한다.
      if (key !== 'c' && key !== 'x') return;

      if (useInteractionStore.getState().mode === 'text-edit') return;

      // 선택된 객체가 없으면 아무 것도 하지 않는다(네이티브 동작에 영향 없음).
      const { selectedIds } = useInteractionStore.getState();
      if (selectedIds.length === 0) return;
      e.preventDefault();

      const objects = useObjectsStore.getState().objects;
      const toCopy = selectedIds
        .map((id) => objects[id])
        .filter((o): o is CanvasObject => o !== undefined)
        .map((o) => structuredClone(o));
      if (toCopy.length === 0) return;

      useClipboardStore.getState().copy(toCopy);

      // 같은 데이터를 OS 시스템 클립보드에도 실어 보낸다(위 handleCopyEvent가 실제로
      // clipboardData에 쓴다) — 이미지 객체만 있으면 serializeExternalClipboard가
      // null을 반환하므로 이 경우 시스템 클립보드는 건드리지 않는다(내부 clipboardStore
      // 복사는 이미 끝났으므로 같은 세션 안 붙여넣기는 그대로 동작).
      const payload = serializeExternalClipboard(toCopy);
      if (payload !== null) {
        pendingExternalPayloadRef.current = payload;
        document.execCommand('copy');
        // execCommand가 (드물게) 아무 'copy' 이벤트도 못 만들었을 경우를 대비해 정리—
        // 다음 번 실제 copy 이벤트가 훨씬 나중에 발생해 엉뚱한 시점에 이 값을 써버리는
        // 것을 막는다.
        pendingExternalPayloadRef.current = null;
      }

      if (key === 'x') {
        // 요구사항(객체 잠금): 복사는 잠긴 객체도 포함해서 되지만(위 toCopy),
        // 잘라내기의 "지우기" 절반은 잠긴 객체를 제외한다 — Delete/Backspace와
        // 동일한 규칙(useObjectDeleteShortcut.ts 참고).
        const removableIds = selectedIds.filter((id) => !objects[id]?.locked);
        if (removableIds.length > 0) {
          useObjectsStore.getState().removeObjects(removableIds);
        }
        useInteractionStore.getState().deselect();
      }
    };

    // 버그 수정(위 함수 docstring 참고): Ctrl+V의 실제 판단을 전부 여기(진짜 OS
    // 클립보드 내용을 읽을 수 있는 유일한 시점)로 옮겼다. mode==='text-edit'일 때는
    // useImagePaste.ts/useTextPaste.ts와 똑같이 관여하지 않는다. 우리가 실제로
    // 처리하는 경우(2/3번)에만 stopImmediatePropagation으로 나머지 두 훅을 막는다 —
    // 이 훅이 Canvas.tsx에서 그 두 훅보다 먼저 마운트되어야(=addEventListener가 먼저
    // 호출되어야) 이 핸들러가 'paste' 리스너 중 가장 먼저 실행된다.
    const handlePaste = (e: ClipboardEvent) => {
      if (useInteractionStore.getState().mode === 'text-edit') return;

      // 1. OS 클립보드에 이미지 파일이 있으면(스크린샷 등) 항상 최우선 — 이 훅은
      // 관여하지 않고 그대로 흘려보내 useImagePaste.ts가 처리하게 한다. 이게 바로
      // 이번에 고치는 버그의 핵심이다: 예전엔 이 확인 자체가 없어서(그리고 keydown이
      // 이미 preventDefault해버려서 애초에 이 지점까지 오지도 못했다) 방금 찍은
      // 스크린샷이 있어도 무조건 예전에 복사한 캔버스 객체가 붙여넣어졌다.
      const hasImageFile = Array.from(e.clipboardData?.items ?? []).some(
        (item) => item.kind === 'file' && item.type.startsWith('image/'),
      );
      if (hasImageFile) return;

      const text = e.clipboardData?.getData('text/plain') ?? '';
      const externalObjects = deserializeExternalClipboard(text);

      if (externalObjects !== null) {
        // 2. OS 클립보드 텍스트가 우리 서명이다 — clipboardStore에 그 원본이 아직
        // 남아있으면(같은 탭에서 방금 복사한 경우) 기존과 동일하게 원본 위치 기준
        // 살짝 어긋난 자리에 놓고(pasteClipboardObjects, frameId도 그대로 유지),
        // 없으면(다른 세션/오리진에서 온 경우) 화면 중앙에 놓는다(pasteExternalObjects).
        e.preventDefault();
        e.stopImmediatePropagation();
        if (useClipboardStore.getState().objects.length > 0) {
          pasteClipboardObjects();
          return;
        }
        const { zoom, panX, panY } = useViewportStore.getState();
        const viewportCenterWorld = {
          x: (window.innerWidth / 2 - panX) / zoom,
          y: (window.innerHeight / 2 - panY) / zoom,
        };
        pasteExternalObjects(externalObjects, viewportCenterWorld);
        return;
      }

      // 3. 이미지도 아니고 우리 서명도 아닌데 텍스트 자체가 비어있으면 — Image
      // 객체만 복사해서 애초에 OS 클립보드를 건드리지 않은 경우(externalClipboardFormat.ts의
      // serializeExternalClipboard 참고)일 수 있다. clipboardStore에 아직 남아있는
      // 그 복사본이 유일한 소스이므로 이때만 fallback으로 쓴다.
      if (text === '' && useClipboardStore.getState().objects.length > 0) {
        e.preventDefault();
        e.stopImmediatePropagation();
        pasteClipboardObjects();
        return;
      }

      // 4. 그 외(우리 서명이 아닌 일반 텍스트 등)는 관여하지 않는다 — useTextPaste.ts의 몫.
    };

    document.addEventListener('copy', handleCopyEvent);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('paste', handlePaste);
    return () => {
      document.removeEventListener('copy', handleCopyEvent);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('paste', handlePaste);
    };
  }, []);
}
