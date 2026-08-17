import { getDB } from '../../storage/db';

/**
 * Phase 8: 이미지 바이너리를 IndexedDB `images` store(Blob)에 영구 저장한다.
 * Blob 자체를 매 렌더링마다 읽지 않고, 실제로 화면에 필요할 때만(ImageObjectView가
 * 마운트될 때) 한 번 읽어서 `URL.createObjectURL`로 만든 object URL을 메모리 캐시에
 * 담아 재사용한다 — object URL 생성 자체가 페이지 전환마다 반복되면 낭비이기 때문이다.
 *
 * refCount는 여전히 메모리에만 있다(Phase 5/7과 동일한 설계 유지). 이게 세션을 넘어
 * 정확할 필요는 없다 — refCount가 하는 일은 "지금 이 세션에서 이 imageId를 참조하는
 * 객체가 하나도 안 남았을 때 캐시된 object URL을 해제"하는 것뿐이고, Blob 원본은
 * IndexedDB에 그대로 남아있으므로 나중에 다시 필요해지면(다른 Page를 열어서 등)
 * loadImageUrl이 새로 object URL을 만들어주면 그만이다. 즉 Blob 삭제와 object URL
 * 해제는 완전히 분리되어 있고, 이 파일은 Blob을 절대 스스로 지우지 않는다 — 여러
 * Page/File이 같은 imageId를 공유할 수 있어서(복제 시 Blob을 복사하지 않고 참조만
 * 공유하는 설계, storage/fileTreeStore.ts 참고) 안전한 삭제 시점을 이 파일만 보고는
 * 판단할 수 없기 때문이다.
 */

interface CacheEntry {
  url: string;
}

const urlCache = new Map<string, CacheEntry>();
const refCounts = new Map<string, number>();
const inFlightLoads = new Map<string, Promise<string | undefined>>();

/**
 * File/Blob(드래그앤드롭, 붙여넣기, 파일선택 대화상자 공통)로부터 새 이미지를 등록한다.
 * 크기 측정을 위해 실제로 한 번 디코딩하고(naturalWidth/naturalHeight는 파일 메타데이터로
 * 안전하게 알 수 없음), Blob 자체는 IndexedDB에 저장한다. 실패해도(사파리 프라이빗
 * 모드 등 IndexedDB를 못 쓰는 환경) 이번 세션 안에서는 정상 동작하고, 새로고침 후에만
 * 사라진다(폰트 저장 로직과 동일한 관례).
 */
export function registerImageBlob(
  blob: Blob,
): Promise<{ imageId: string; url: string; naturalWidth: number; naturalHeight: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const imageId = crypto.randomUUID();
      urlCache.set(imageId, { url });
      refCounts.set(imageId, 1);
      void getDB()
        .then((db) => db.put('images', { id: imageId, blob, mimeType: blob.type }))
        .catch(() => {
          // 무시 — 위 파일 상단 주석 참고. 이번 세션 메모리 캐시(url)는 여전히 유효하다.
        });
      resolve({ imageId, url, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('이미지를 불러오지 못했습니다.'));
    };
    img.src = url;
  });
}

/** 이미 캐시에 object URL이 있으면 동기로 즉시 반환(없으면 undefined) — 렌더링 첫 프레임에 쓴다. */
export function getCachedImageUrl(imageId: string): string | undefined {
  return urlCache.get(imageId)?.url;
}

/**
 * IndexedDB에서 Blob을 읽어 object URL을 만들고 캐시에 채운다. 이미 캐시에 있으면
 * 그 값을 바로 resolve하고, 동시에 여러 곳에서 같은 imageId를 요청해도(같은 Page에
 * 같은 이미지가 여러 객체로 붙어있는 경우) 실제 DB 읽기는 한 번만 일어난다.
 */
export function loadImageUrl(imageId: string): Promise<string | undefined> {
  const cached = urlCache.get(imageId);
  if (cached) return Promise.resolve(cached.url);

  const inFlight = inFlightLoads.get(imageId);
  if (inFlight) return inFlight;

  const promise = (async () => {
    try {
      const db = await getDB();
      const record = await db.get('images', imageId);
      if (!record) return undefined;
      const url = URL.createObjectURL(record.blob);
      urlCache.set(imageId, { url });
      return url;
    } catch {
      return undefined;
    } finally {
      inFlightLoads.delete(imageId);
    }
  })();

  inFlightLoads.set(imageId, promise);
  return promise;
}

/**
 * 같은 imageId를 참조하는 객체가 하나 더 생길 때(복사/붙여넣기, 또는 Page 진입 시
 * 그 Page의 objects를 훑으며 참조 수를 세팅할 때) 호출한다. 아직 캐시/카운트가 없어도
 * 안전하게 동작한다(0에서 시작해 1로).
 */
export function retainImage(imageId: string): void {
  refCounts.set(imageId, (refCounts.get(imageId) ?? 0) + 1);
}

/**
 * 참조가 하나 줄어들 때(객체 삭제, 또는 Page를 떠날 때 그 Page의 objects만큼 카운트를
 * 되돌릴 때) 호출한다. 0이 되면 캐시된 object URL만 해제한다 — IndexedDB의 Blob은
 * 그대로 남는다(위 파일 상단 주석 참고).
 */
export function releaseImage(imageId: string): void {
  const next = (refCounts.get(imageId) ?? 0) - 1;
  if (next > 0) {
    refCounts.set(imageId, next);
    return;
  }
  refCounts.delete(imageId);
  const entry = urlCache.get(imageId);
  if (entry) {
    URL.revokeObjectURL(entry.url);
    urlCache.delete(imageId);
  }
}
