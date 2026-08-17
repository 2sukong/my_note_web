import { useEffect, useState } from 'react';
import type { ImageObject } from '../../types/object';
import { getCachedImageUrl, loadImageUrl } from './imageStore';
import { useImageLightboxStore } from '../../store/imageLightboxStore';

/**
 * Phase 5: 실제 이미지를 렌더링한다. imageId가 비어있거나(Phase 2 시드 데이터),
 * 아직 로드되지 않았거나, 로드에 실패한 경우에는 placeholder를 보여준다.
 *
 * Phase 8: 이미지 Blob이 IndexedDB로 옮겨가면서 URL을 얻는 게 비동기가 됐다.
 * 캐시에 이미 있으면(getCachedImageUrl) 첫 렌더부터 바로 보여주고, 없으면
 * loadImageUrl로 비동기 로드한 뒤 채운다 — Page를 새로 열 때마다 매번 깜빡이지
 * 않도록 동기 캐시 우선 조회를 유지한다.
 */
export function ImageObjectView({ object }: { object: ImageObject }) {
  const [url, setUrl] = useState<string | undefined>(() =>
    object.imageId ? getCachedImageUrl(object.imageId) : undefined,
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    if (!object.imageId) {
      setUrl(undefined);
      return;
    }
    const cached = getCachedImageUrl(object.imageId);
    if (cached) {
      setUrl(cached);
      return;
    }
    let cancelled = false;
    void loadImageUrl(object.imageId).then((loaded) => {
      if (!cancelled) setUrl(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [object.imageId]);

  if (!url || failed) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#eceae0',
          border: '1px dashed #b6b3a3',
          borderRadius: 4,
          color: '#8a8a7a',
          fontSize: 13,
          fontFamily: 'system-ui, sans-serif',
          textAlign: 'center',
          whiteSpace: 'pre-line',
        }}
      >
        {failed ? '이미지를 불러오지 못했습니다' : 'Image\n(Phase 5 예정)'}
      </div>
    );
  }

  return (
    // 요구사항(이미지 더블클릭 시 확대): <img> 자신은 pointerEvents:'none'이라
    // 더블클릭을 직접 받을 수 없다(아래 주석 참고) — 그래서 이 wrapper div가
    // 대신 받는다. onDoubleClick은 ObjectView가 이미 처리한 pointerdown 이후에
    // 별개로 발생하는 이벤트라 기존 드래그/선택 로직과 충돌하지 않는다.
    <div style={{ width: '100%', height: '100%' }} onDoubleClick={() => useImageLightboxStore.getState().open(url)}>
      <img
        src={url}
        draggable={false}
        onError={() => setFailed(true)}
        alt=""
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          borderRadius: 4,
          display: 'block',
          // 객체 이동 드래그는 항상 ObjectView가 감싼 부모 div의 몫이다 — 이미지
          // 자신은 pointer 이벤트를 받지 않게 해서 네이티브 이미지 드래그/우클릭 저장
          // 메뉴 등과 우리 커스텀 드래그 로직이 충돌하지 않도록 한다.
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}
