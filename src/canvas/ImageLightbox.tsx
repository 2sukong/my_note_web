import { useEffect } from 'react';
import { useImageLightboxStore } from '../store/imageLightboxStore';

/**
 * 요구사항(이미지 더블클릭 시 확대): objects/image/ImageObjectView.tsx를 더블클릭하면
 * 이 오버레이가 뜬다. Canvas.tsx의 canvas-world(pan/zoom transform 적용 대상) 바깥,
 * ObjectContextMenu와 같은 자리에 둔다 — 화면 전체를 덮어야 하고 캔버스 확대/축소와
 * 무관하게 항상 같은 크기로 보여야 하기 때문이다.
 */
export function ImageLightbox() {
  const url = useImageLightboxStore((s) => s.url);
  const close = useImageLightboxStore((s) => s.close);

  // 열려있는 동안에만 Escape를 감시한다 — 안 그러면 이미지가 안 떠 있을 때도
  // 전역 keydown 리스너가 계속 붙어 있어서 다른 단축키(예: Backspace 삭제)와
  // 겹쳐 처리될 여지가 생긴다.
  useEffect(() => {
    if (!url) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [url, close]);

  if (!url) return null;

  return (
    <div
      onClick={close}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(20, 18, 12, 0.82)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // ObjectContextMenu/PropertiesPanel보다도 위, 캔버스 전체를 덮어야 한다.
        zIndex: 20000,
        cursor: 'zoom-out',
      }}
    >
      <img
        src={url}
        alt=""
        // 배경(오버레이) 클릭만 닫혀야 하므로, 이미지 자체 클릭은 바깥으로
        // 전파되지 않게 막는다.
        onClick={(e) => e.stopPropagation()}
        style={{
          // 요구사항: 크기는 화면 전체의 70%를 덮는 사이즈로 고정한다(원본 이미지가
          // 그보다 작아도 이 박스 크기를 그대로 쓰고, objectFit:contain으로 그 안에
          // 비율을 유지한 채 레터박스로 담는다) — maxWidth/maxHeight(90vw/90vh)였던
          // 예전엔 이미지 원본 크기에 따라 실제 표시 크기가 들쭉날쭉했다.
          width: '70vw',
          height: '70vh',
          objectFit: 'contain',
          boxShadow: '0 8px 40px rgba(0, 0, 0, 0.5)',
          borderRadius: 4,
          cursor: 'default',
        }}
      />
      <button
        type="button"
        onClick={close}
        aria-label="닫기"
        style={{
          position: 'fixed',
          top: 20,
          right: 24,
          width: 36,
          height: 36,
          borderRadius: '50%',
          border: 'none',
          background: 'rgba(255, 255, 255, 0.15)',
          color: '#fff',
          fontSize: 20,
          lineHeight: '36px',
          textAlign: 'center',
          cursor: 'pointer',
        }}
      >
        ×
      </button>
    </div>
  );
}
