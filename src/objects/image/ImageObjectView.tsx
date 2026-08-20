import { useEffect, useState } from 'react';
import type { ImageObject } from '../../types/object';
import { getCachedImageUrl, loadImageUrl } from './imageStore';
import { useImageLightboxStore } from '../../store/imageLightboxStore';
import { useImageHighlightDraftStore } from '../../store/imageHighlightDraftStore';
import { useToolStore } from '../../store/toolStore';
import { highlightBackgroundFor } from '../text/highlightColors';
import { resolveHighlightStrokeWidth } from './imageHighlightGeometry';

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
          background: '#f4f4f4',
          border: '1px dashed #c7c7c7',
          borderRadius: 4,
          color: '#8a8a8a',
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
      <ImageHighlightOverlay object={object} />
    </div>
  );
}

/**
 * 요구사항(이미지/PDF 전용 직선 형광펜): 확정된 하이라이트(object.highlights)와,
 * 지금 이 이미지 위에서 드래그 중인 draft(useImageHighlightDraftStore) 둘 다 이
 * 하나의 SVG 위에 그린다. ShapeView.tsx와 동일한 방식(width="100%" height="100%",
 * viewBox 없이 object.width/height로 직접 좌표를 계산)이라 부모 div(=object의 world
 * box)와 로컬 px 단위가 그대로 1:1로 맞는다 — 그래서 x1/y1/x2/y2(0~1 비율)에
 * object.width/height를 곱하기만 하면 된다.
 */
function ImageHighlightOverlay({ object }: { object: ImageObject }) {
  const draft = useImageHighlightDraftStore((s) => (s.draft?.objectId === object.id ? s.draft : null));
  // 지우개 모드 미리보기는 HighlightDragPreview.tsx(텍스트 형광펜 지우개)와 같은 색으로
  // 통일한다 — "칠해질 색"이 아니라 "지워질 자리"임을 구분하기 위한 회색.
  const highlightColor = useToolStore((s) => s.highlightColor);
  const eraserActive = useToolStore((s) => s.highlightEraserActive);
  // 요구사항(형광펜 굵기 조절): 아직 커밋 전인 draft는 "지금 이 이미지 크기 기준"의
  // 사이드바 설정값을 그대로 px로 쓴다 — 드래그 도중 이미지가 리사이즈되는 일은 없으니
  // thicknessRatio 변환 없이 바로 써도 실제 커밋될 굵기와 정확히 같다.
  const highlightThickness = useToolStore((s) => s.highlightThickness);
  const highlights = object.highlights ?? [];
  if (highlights.length === 0 && !draft) return null;

  const draftStroke = eraserActive ? 'rgba(120, 120, 120, 0.5)' : highlightBackgroundFor(highlightColor);

  return (
    <svg
      width="100%"
      height="100%"
      style={{ position: 'absolute', inset: 0, overflow: 'visible', display: 'block', pointerEvents: 'none' }}
    >
      {highlights.map((h) => (
        <line
          key={h.id}
          x1={h.x1 * object.width}
          y1={h.y1 * object.height}
          x2={h.x2 * object.width}
          y2={h.y2 * object.height}
          stroke={highlightBackgroundFor(h.color)}
          // 요구사항(이미지 리사이즈 시 형광펜 굵기 스케일링): 저장된 비율에 현재
          // width/height를 곱해 다시 계산 — 이미지가 리사이즈된 뒤라면 그 변화 비율만큼
          // 자동으로 굵어지거나 얇아진다.
          strokeWidth={resolveHighlightStrokeWidth(h.thicknessRatio, object.width, object.height)}
          strokeLinecap="round"
        />
      ))}
      {draft && (
        // 미리보기는 항상 draft.start->draft.current 두 점만 잇는다 — 드래그 도중
        // 손이 아무리 떨려도 이 두 점 사이는 수학적으로 직선이라 저절로 요구사항
        // (손떨림/곡선 무시하고 강제 직선화)을 만족한다.
        <line
          x1={draft.start.x}
          y1={draft.start.y}
          x2={draft.current.x}
          y2={draft.current.y}
          stroke={draftStroke}
          strokeWidth={highlightThickness}
          strokeLinecap="round"
          strokeDasharray={eraserActive ? `${highlightThickness * 0.6} ${highlightThickness * 0.5}` : undefined}
        />
      )}
    </svg>
  );
}
