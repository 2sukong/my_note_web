/**
 * TextObjectView가 마운트한 실제 줄(line) DOM 엘리먼트를 컴포넌트 트리 바깥에서도
 * 조회할 수 있게 해주는 작은 레지스트리.
 *
 * Highlight 오버레이(HighlightLayer)와 Annotation 화살표(AnnotationConnectorsLayer)는
 * TextObjectView와 형제 컴포넌트라서 ref를 직접 공유할 수 없다. 그렇다고 프로젝트의
 * "DOM+SVG 하이브리드, store가 단일 진실 원천" 원칙을 깨고 줄 텍스트 자체를 두 군데서
 * 관리하고 싶지는 않으므로, 위치 계산에만 필요한 실제 DOM 노드 참조를 이 모듈이
 * 중개한다. TextObjectView의 기존 ref 콜백(lineElsRef)에 등록/해제 호출을 얹기만 하면
 * 되므로 IME/캐럿 로직에는 영향이 없다.
 */

interface LineDomEntry {
  lineEl: HTMLElement;
  containerEl: HTMLElement;
}

const registry = new Map<string, LineDomEntry>();
const listeners = new Set<() => void>();

function key(objectId: string, lineId: string): string {
  return `${objectId}:${lineId}`;
}

export function registerLineEl(objectId: string, lineId: string, lineEl: HTMLElement, containerEl: HTMLElement): void {
  registry.set(key(objectId, lineId), { lineEl, containerEl });
  notify();
}

export function unregisterLineEl(objectId: string, lineId: string): void {
  registry.delete(key(objectId, lineId));
  notify();
}

export function getLineDomEntry(objectId: string, lineId: string): LineDomEntry | undefined {
  return registry.get(key(objectId, lineId));
}

/** HighlightLayer/AnnotationConnectorsLayer가 "레지스트리가 바뀌었으니 다시 재보 계산해라"를 구독할 수 있게 한다. */
export function subscribeLineDomRegistry(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const l of listeners) l();
}
