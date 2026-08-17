import { useSaveStatusStore } from '../storage/saveStatusStore';

/**
 * Phase 8: "저장 중.../저장됨/오류" 최소 인디케이터. 필기 중 저장 걱정을 덜어주는
 * 용도라 아주 작고 눈에 덜 띄게 — idle일 때는(막 페이지를 연 직후, 아직 아무 변경도
 * 없었을 때) 아무것도 보여주지 않는다.
 */
export function SaveStatusIndicator() {
  const status = useSaveStatusStore((s) => s.status);
  if (status === 'idle') return null;

  const label = status === 'saving' ? '저장 중…' : status === 'saved' ? '저장됨' : '저장 실패';

  return (
    <span
      style={{
        fontSize: 12,
        color: status === 'error' ? '#c0392b' : '#8a8a7a',
        userSelect: 'none',
      }}
    >
      {label}
    </span>
  );
}
