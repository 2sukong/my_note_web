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
 * 붙여넣기가 된다. 두 경로는 서로 무관하게 공존한다: 같은 탭/세션 안에서는 여전히
 * clipboardStore가 먼저 쓰이고(원본 위치 기준으로 조금씩 어긋나게 놓임 —
 * pasteClipboardObjects), clipboardStore가 비어 있을 때만(=이 세션에서 한 번도 복사한
 * 적 없을 때만) 시스템 클립보드에 우리 서명이 있는지 검사해 그 데이터로 붙여넣는다
 * (pasteExternalObjects, 화면 중앙 기준).
 *
 * mode === 'text-edit'일 때는 전혀 관여하지 않는다(useImagePaste.ts와 동일한 관례) —
 * 그 안에서의 Ctrl+C/V는 브라우저 contentEditable의 기본 텍스트 복사/붙여넣기여야 한다.
 * 'select'/'idle' 등 그 외 모드에서만 동작하므로, 객체를 선택했다가 캔버스 빈 곳을
 * 클릭해 선택을 해제한(mode='idle') 뒤에도 여전히 붙여넣기는 가능하다.
 *
 * Ctrl+V는 clipboardStore가 비어 있으면(캔버스 객체를 한 번도 복사한 적 없으면)
 * preventDefault조차 하지 않고 그대로 흘려보낸다 — 그래야 OS 클립보드의 이미지/텍스트를
 * 붙여넣는 useImagePaste.ts/useTextPaste.ts의 전역 'paste' 이벤트가 정상적으로 계속
 * 발생한다(keydown에서 preventDefault하면 브라우저가 뒤이어 합성하는 paste 이벤트
 * 자체가 발생하지 않는다). 이 훅이 그 두 훅보다 먼저 마운트돼야(Canvas.tsx의 호출
 * 순서 참고) 아래 handlePaste가 'paste' 리스너 중 가장 먼저 실행되고, 우리 서명을
 * 찾으면 stopImmediatePropagation으로 나머지 두 훅이 같은 이벤트를 또 처리해서 엉뚱한
 * 일반 텍스트 객체가 함께 생기는 것을 막는다.
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
      if (key !== 'c' && key !== 'x' && key !== 'v') return;

      if (useInteractionStore.getState().mode === 'text-edit') return;

      if (key === 'v') {
        if (useClipboardStore.getState().objects.length === 0) return;
        e.preventDefault();
        pasteClipboardObjects();
        return;
      }

      // c 또는 x: 선택된 객체가 없으면 아무 것도 하지 않는다(네이티브 동작에 영향 없음).
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

    // 요구사항(2026-09, 다른 URL의 my_note_web 사이에서도 Ctrl+C/V): clipboardStore가
    // 비어 있어(위 handleKeyDown의 'v' 분기가 preventDefault하지 않아) 브라우저가 실제로
    // 발생시키는 전역 'paste' 이벤트를 가로채, OS 클립보드의 text/plain이 우리 서명으로
    // 시작하는지 확인한다. useImagePaste.ts/useTextPaste.ts와 똑같이 mode==='text-edit'일
    // 때는 관여하지 않는다. 서명을 찾아 실제로 처리했을 때만
    // stopImmediatePropagation으로 나머지 두 훅(이미지 파일 없음/일반 텍스트로 오인)을
    // 막는다 — 이 훅이 Canvas.tsx에서 그 두 훅보다 먼저 마운트되어야(=addEventListener가
    // 먼저 호출되어야) 이 핸들러가 'paste' 리스너 중 가장 먼저 실행된다.
    const handlePaste = (e: ClipboardEvent) => {
      if (useInteractionStore.getState().mode === 'text-edit') return;

      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (text === '') return;

      const objects = deserializeExternalClipboard(text);
      if (objects === null) return;

      e.preventDefault();
      e.stopImmediatePropagation();

      const { zoom, panX, panY } = useViewportStore.getState();
      const viewportCenterWorld = {
        x: (window.innerWidth / 2 - panX) / zoom,
        y: (window.innerHeight / 2 - panY) / zoom,
      };
      pasteExternalObjects(objects, viewportCenterWorld);
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
