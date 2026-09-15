import { useEffect, useRef } from 'react';
import { useInteractionStore } from '../../store/interactionStore';
import { useObjectsStore } from '../../store/objectsStore';
import { useHistoryStore } from '../../store/historyStore';
import type { TextObject } from '../../types/object';
import { ANNOTATION_OFFSET_Y_BELOW_SENTINEL } from '../../objects/text/annotationLayout';

const NUDGE_STEP = 1; // world px. 화살표 키 한 번 = 1px(zoom 100%에서 화면 1px와 동일).
const NUDGE_STEP_SHIFT = 10; // world px. Shift+화살표 키 한 번 = 10px.
/** 꾹 눌렀을 때 계속 이동하는 주기(ms) — OS/브라우저마다 다른 keydown 자동반복
 * 지연/속도에 기대지 않고 이 훅이 직접 타이머로 재생한다(아래 handleKeyDown의
 * e.repeat 가드 참고). */
const NUDGE_REPEAT_INTERVAL_MS = 40;
/**
 * 버그 수정(2026-09-15, "한 번만 눌렀는데 훨씬 많이 이동함"): 처음 구현은 keydown
 * 즉시 1스텝 이동시킨 뒤 곧바로(지연 없이) setInterval을 시작했다 — 그런데 실제
 * "짧게 한 번 누름"도 물리적으로는 보통 80~150ms 정도 지속된다(순식간에 떼는 게
 * 아니라 누르고-떼는 데 시간이 걸린다). NUDGE_REPEAT_INTERVAL_MS(40ms) 간격으로
 * 지연 없이 바로 반복을 시작하면, 그 80~150ms 사이에 interval이 이미 1~3번 더
 * 발화해버려서 "한 번 눌렀다고 생각했는데 3~4px씩 이동"하는 것처럼 보였다 — 이동
 * 단위(1px) 자체의 문제가 아니라 "꾹 누름"을 너무 성급하게 인식한 것이 원인이었다.
 * 그래서 이제 keydown 시 즉시 1스텝만 이동시키고, 이 지연(스페이스바/일반적인
 * 키보드 typematic delay와 같은 개념) 동안 계속 눌려 있을 때만(setTimeout이
 * keyup보다 먼저 발화할 때만) 그제서야 연속 이동(setInterval)을 시작한다 — 그
 * 전에 손을 떼면(대부분의 "한 번 클릭") 정확히 1스텝만 움직인다.
 */
const NUDGE_HOLD_DELAY_MS = 300;

type ArrowKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

function isArrowKey(key: string): key is ArrowKey {
  return key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight';
}

/**
 * 요구사항(2026-09-15): 선택된 객체(들)를 화살표 키로 이동한다. 기본 1px씩, Shift를
 * 같이 누르면 10px씩 — 키를 꾹 누르고 있으면 계속 이동한다.
 *
 * 대상 결정은 useObjectDeleteShortcut.ts와 완전히 같은 순서·규칙을 따른다:
 *  1. fineSelection.kind==='annotation' — 그 주석 하나만 옮긴다. 가로(Left/Right)는
 *     annotation.offsetX를 계속 밀 수 있지만, 세로(Up/Down)는 이 앱의 주석 세로 배치가
 *     애초에 "텍스트 위/아래" 이진값이라(annotationLayout.ts의 snapAnnotationOffsetY —
 *     0 아니면 totalGap*배수, 그 사이 어떤 값도 저장되지 않는다) 픽셀 단위로 밀 수
 *     없다. 그래서 Up/Down은 누를 때마다(꾹 눌러도 반복 없이 딱 한 번만) 위/아래를
 *     토글한다 — 이미 그 방향에 가 있으면 아무 일도 없다(더 갈 곳이 없는 이진 상태).
 *  2. selectedIds — 일반 캔버스 객체(Text/Image/Frame/Arrow/Rectangle). useObjectDrag.ts와
 *     동일하게 그룹 멤버를 확장하고, 잠긴 객체는 제외한다. Frame을 옮기면
 *     objectsStore.moveObjectTo의 기존 cascade가 그 자식들도 같이 옮겨준다.
 *
 * mode==='text-edit'(본문/주석에 타이핑 중)이거나 사이드바 입력창에 포커스가 있으면
 * 전혀 개입하지 않는다(useObjectDeleteShortcut.ts와 동일한 이유) — 화살표 키는 캐럿
 * 이동/커서 이동이어야 한다.
 *
 * 여러 방향 키를 동시에 누르면(예: ↑+→로 대각선) 지금 눌려 있는 모든 키의 delta를
 * 매 tick 합산한다. "누르고 있는 동안"(첫 keydown ~ 모든 키가 떨어질 때까지) 전체를
 * historyStore의 beginTransaction/endTransaction(useObjectDrag.ts와 동일한 관례)으로
 * 묶어서 Ctrl+Z 한 번에 통째로 되돌아가게 한다.
 */
export function useArrowKeyNudge() {
  const heldKeysRef = useRef<Set<ArrowKey>>(new Set());
  const shiftRef = useRef(false);
  const intervalRef = useRef<number | null>(null);
  const holdTimeoutRef = useRef<number | null>(null);
  const targetIdsRef = useRef<string[]>([]);
  const annotationTargetRef = useRef<{ objectId: string; lineId: string; id: string } | null>(null);

  useEffect(() => {
    function computeStepDelta(): { dx: number; dy: number } {
      const step = shiftRef.current ? NUDGE_STEP_SHIFT : NUDGE_STEP;
      let dx = 0;
      let dy = 0;
      if (heldKeysRef.current.has('ArrowLeft')) dx -= step;
      if (heldKeysRef.current.has('ArrowRight')) dx += step;
      if (heldKeysRef.current.has('ArrowUp')) dy -= step;
      if (heldKeysRef.current.has('ArrowDown')) dy += step;
      return { dx, dy };
    }

    function tick() {
      const { dx, dy } = computeStepDelta();
      if (dx === 0 && dy === 0) return;

      if (annotationTargetRef.current) {
        // 주석은 가로(offsetX)만 계속 민다 — 세로는 keydown에서 한 번만 토글되고
        // 여기(반복 tick)까지 오지 않는다(아래 handleKeyDown 참고).
        if (dx === 0) return;
        const { objectId, lineId, id } = annotationTargetRef.current;
        const obj = useObjectsStore.getState().objects[objectId] as TextObject | undefined;
        const line = obj?.type === 'text' ? obj.lines.find((l) => l.id === lineId) : undefined;
        const annotation = line?.annotations?.find((a) => a.id === id);
        if (!annotation) return;
        useObjectsStore
          .getState()
          .updateAnnotationOffset(objectId, lineId, id, (annotation.offsetX ?? 0) + dx, annotation.offsetY ?? 0);
        return;
      }

      for (const id of targetIdsRef.current) {
        const obj = useObjectsStore.getState().objects[id];
        if (!obj) continue;
        useObjectsStore.getState().moveObjectTo(id, obj.x + dx, obj.y + dy);
      }
    }

    function stopHold() {
      if (holdTimeoutRef.current !== null) {
        window.clearTimeout(holdTimeoutRef.current);
        holdTimeoutRef.current = null;
      }
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (heldKeysRef.current.size > 0 || targetIdsRef.current.length > 0 || annotationTargetRef.current) {
        useHistoryStore.getState().endTransaction();
      }
      heldKeysRef.current.clear();
      targetIdsRef.current = [];
      annotationTargetRef.current = null;
    }

    function toggleAnnotationVertical(goingDown: boolean, objectId: string, lineId: string, id: string) {
      const obj = useObjectsStore.getState().objects[objectId] as TextObject | undefined;
      const line = obj?.type === 'text' ? obj.lines.find((l) => l.id === lineId) : undefined;
      const annotation = line?.annotations?.find((a) => a.id === id);
      if (!annotation) return;
      const currentlyBelow = (annotation.offsetY ?? 0) > 0;
      if (goingDown === currentlyBelow) return; // 이미 그 방향 끝에 가 있음 — 더 갈 곳 없음
      const nextOffsetY = goingDown ? ANNOTATION_OFFSET_Y_BELOW_SENTINEL : 0;
      useObjectsStore.getState().updateAnnotationOffset(objectId, lineId, id, annotation.offsetX ?? 0, nextOffsetY);
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isArrowKey(e.key)) return;

      // 사이드바 입력창(프레임 이름 등)에 포커스가 있으면 일반 텍스트 커서 이동으로
      // 취급한다 — useObjectDeleteShortcut.ts의 동일한 가드와 같은 이유.
      const active = document.activeElement;
      const isEditableTarget =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable);
      if (isEditableTarget) return;

      const { mode, selectedIds, fineSelection } = useInteractionStore.getState();
      if (mode === 'text-edit') return; // 본문/주석 타이핑 중엔 캐럿 이동이어야 한다.
      if (mode !== 'select') return; // drag/resize/pan 도중엔 개입하지 않는다.

      const isAnnotationTarget = fineSelection?.kind === 'annotation';
      if (!isAnnotationTarget && selectedIds.length === 0) return; // 옮길 대상이 없음.

      // 주석의 세로(Up/Down)는 이진 토글 — 반복(e.repeat)은 무시해서 꾹 눌러도 한 번만
      // 넘어가게 한다. 이동/트랜잭션 상태를 전혀 건드리지 않는 별개의 즉시 동작이라
      // 아래 "누르고 있는 동안" 로직과 섞이지 않는다.
      if (isAnnotationTarget && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        if (e.repeat) return;
        toggleAnnotationVertical(e.key === 'ArrowDown', fineSelection.objectId, fineSelection.lineId, fineSelection.id);
        return;
      }

      e.preventDefault();
      if (e.repeat) return; // 우리 자신의 반복 타이머만 쓴다 — OS 자동반복 이벤트는 무시.

      const wasIdle = heldKeysRef.current.size === 0;
      heldKeysRef.current.add(e.key);
      shiftRef.current = e.shiftKey;

      if (wasIdle) {
        if (isAnnotationTarget) {
          annotationTargetRef.current = { objectId: fineSelection.objectId, lineId: fineSelection.lineId, id: fineSelection.id };
        } else {
          // useObjectDrag.ts/useObjectDeleteShortcut.ts와 동일: 그룹 멤버로 확장하고
          // 잠긴 객체는 이동 대상에서 제외한다(선택 자체는 유지).
          const objects = useObjectsStore.getState().objects;
          const expanded = new Set<string>();
          for (const id of selectedIds) {
            for (const memberId of useObjectsStore.getState().getGroupMemberIds(id)) expanded.add(memberId);
          }
          targetIdsRef.current = Array.from(expanded).filter((id) => objects[id] && !objects[id].locked);
        }
        useHistoryStore.getState().beginTransaction('nudge');
        tick(); // 짧게 한 번 눌렀다 떼면 이 한 스텝만 움직이고 끝난다(아래 지연 참고).
        // NUDGE_HOLD_DELAY_MS 동안 계속 눌려 있는 경우에만 연속 이동을 시작한다 — 그
        // 전에 keyup이 오면(대부분의 "한 번 클릭") handleKeyUp→stopHold가 이 타이머
        // 자체를 지워버려서 setInterval은 아예 시작되지 않는다.
        holdTimeoutRef.current = window.setTimeout(() => {
          holdTimeoutRef.current = null;
          intervalRef.current = window.setInterval(tick, NUDGE_REPEAT_INTERVAL_MS);
        }, NUDGE_HOLD_DELAY_MS);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!isArrowKey(e.key)) return;
      if (heldKeysRef.current.size === 0) return;
      heldKeysRef.current.delete(e.key);
      if (heldKeysRef.current.size === 0) stopHold();
    };

    // 창 밖으로 포커스가 빠져나가면(Alt+Tab 등) keyup을 놓칠 수 있으므로 안전하게 정리한다.
    const handleBlur = () => stopHold();

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
      stopHold();
    };
  }, []);
}
