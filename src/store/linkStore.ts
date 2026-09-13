import { create } from 'zustand';
import { loadAllLinks, saveLink, deleteLink } from '../storage/linkPersistence';
import type { LinkAnchor, LinkRecord } from '../types/link';

/**
 * 내부 하이퍼링크(Phase 9) 전체 CRUD. fileTreeStore.pages/objectsStore.objects와 달리
 * Page 단위로 스코프하지 않고 앱이 뜰 때 전체를 한 번에 메모리에 올려둔다(App.tsx가
 * fileTreeStore.init()과 나란히 loadAll()을 호출) — 링크는 "이 Page/PDF에 있는 링크"뿐
 * 아니라 "이 Page/PDF를 가리키는 링크"도 관심사라서(예: 나중에 "이 페이지로 들어오는
 * 링크 보기" 같은 기능을 붙이더라도) Page를 열 때마다 다시 걸러 읽는 것보다 전체를
 * 들고 있는 편이 단순하다. 링크 개수는 실무적으로 objects만큼 많아지지 않는다고 보고
 * pageObjects 같은 지연 로딩/디바운스 저장은 두지 않았다 — CRUD 즉시 IndexedDB에 쓴다.
 */
interface LinkState {
  links: Record<string, LinkRecord>;
  loaded: boolean;

  loadAll: () => Promise<void>;
  /** 새 링크를 만들고 그 id를 반환한다. */
  addLink: (source: LinkAnchor, target: LinkAnchor) => Promise<string>;
  removeLink: (id: string) => Promise<void>;
  /** 마커를 드래그해서 재배치했을 때(2026-09-12 요구사항) source 또는 target anchor
   * 전체를 새 anchor로 갈아끼운다 — 호출부(canvas/LinkMarkersLayer.tsx,
   * canvas/pdf/PdfOverlayLinkMarkersLayer.tsx)가 useLinkTool.ts/useOverlayLinkTool.ts와
   * 같은 히트테스트 규칙으로 이미 완성된 LinkAnchor를 만들어 넘겨준다. */
  updateAnchor: (linkId: string, side: 'source' | 'target', anchor: LinkAnchor) => Promise<void>;
  /** objectId를 가진 anchor가 가리키던 객체 자체가 삭제됐을 때, 그 객체를 참조하던
   * anchor를 "빈 공간 링크"로 강등한다(objectId만 지우고 x/y는 삭제 시점 좌표를
   * 그대로 남겨 위치 정보 자체는 잃지 않는다) — 링크 자체를 지우지는 않는다. 아직
   * 어디서도 호출하지 않는 v1 범위 밖 헬퍼지만, objectsStore.removeObject가 나중에
   * 이걸 불러 "링크가 가리키던 객체가 지워져도 링크는 마지막 위치에 남는다"를 채울 수
   * 있도록 자리만 마련해둔다.
   */
  detachObjectFromLinks: (objectId: string) => Promise<void>;
}

function keyBy<T extends { id: string }>(items: T[]): Record<string, T> {
  return Object.fromEntries(items.map((item) => [item.id, item]));
}

export const useLinkStore = create<LinkState>((set, get) => ({
  links: {},
  loaded: false,

  loadAll: async () => {
    const list = await loadAllLinks();
    set({ links: keyBy(list), loaded: true });
  },

  addLink: async (source, target) => {
    const link: LinkRecord = {
      id: crypto.randomUUID(),
      source,
      target,
      createdAt: Date.now(),
    };
    set((s) => ({ links: { ...s.links, [link.id]: link } }));
    await saveLink(link);
    return link.id;
  },

  removeLink: async (id) => {
    set((s) => {
      const links = { ...s.links };
      delete links[id];
      return { links };
    });
    await deleteLink(id);
  },

  updateAnchor: async (linkId, side, anchor) => {
    const existing = get().links[linkId];
    if (!existing) return;
    const updated: LinkRecord = { ...existing, [side]: anchor };
    set((s) => ({ links: { ...s.links, [linkId]: updated } }));
    await saveLink(updated);
  },

  detachObjectFromLinks: async (objectId) => {
    const affected = Object.values(get().links).filter(
      (l) => l.source.objectId === objectId || l.target.objectId === objectId,
    );
    if (affected.length === 0) return;
    const updates: LinkRecord[] = affected.map((l) => ({
      ...l,
      source: l.source.objectId === objectId ? { ...l.source, objectId: null } : l.source,
      target: l.target.objectId === objectId ? { ...l.target, objectId: null } : l.target,
    }));
    set((s) => {
      const links = { ...s.links };
      for (const u of updates) links[u.id] = u;
      return { links };
    });
    await Promise.all(updates.map((u) => saveLink(u)));
  },
}));
