import { useToolStore } from '../store/toolStore';
import { useLinkDraftStore } from '../store/linkDraftStore';
import './LinkCreationBanner.css';

/**
 * 요구사항(링크 생성 UX 개선, 2026-09-13): 🔗 도구를 켜면 상단 툴바 바로 아래에 지금
 * 몇 단계인지 알려주는 안내 배너를 띄운다. 실제 클릭 처리(canvas/interaction/
 * useLinkTool.ts, canvas/pdf/useOverlayLinkTool.ts)는 그대로 두고, 이 컴포넌트는
 * 순수하게 두 store를 읽어 문구만 보여준다 — activeTool이 'link'가 아니면 아예 안
 * 보이고, linkDraftStore.pending(첫 번째 클릭으로 잡힌 출발지, 두 store가 공유)의
 * 유무로 1단계/2단계 문구를 가른다. store/toolStore.ts의 setTool이 'link'를 벗어날
 * 때 pending을 함께 비우므로(그 파일 주석 참고), 도구를 바꾸면 이 배너도 자연히
 * 사라진다.
 *
 * 요구사항 변경(2026-09-15, 좌클릭→우클릭): useLinkTool.ts/useOverlayLinkTool.ts가
 * 이제 좌클릭이 아니라 우클릭으로 anchor를 찍는다(Space+좌클릭 드래그로 화면을 옮긴
 * 뒤에도 안전하게 링크를 놓을 수 있도록 — 그 파일들 주석 참고). 좌클릭보다 우클릭은
 * 사용자가 먼저 시도해보기 어려운 조작이라 발견성이 떨어지므로, 이 배너 문구에
 * "우클릭"을 명시해 안내한다.
 *
 * 두 번째 지점을 우클릭한 자리에 뜨는 강조 표시는 이 배너가 아니라
 * canvas/LinkMarkersLayer.tsx/canvas/pdf/PdfOverlayLinkMarkersLayer.tsx의 임시 마커
 * (LinkDraftMarker, Canvas.css의 .link-marker.is-draft)가 담당한다.
 */
export function LinkCreationBanner() {
  const activeTool = useToolStore((s) => s.activeTool);
  const pending = useLinkDraftStore((s) => s.pending);

  if (activeTool !== 'link') return null;

  return (
    <div className="link-creation-banner">
      {pending ? '2단계: 연결할 두 번째 지점을 우클릭해주세요.' : '1단계: 연결할 첫 번째 지점을 우클릭해주세요.'}
    </div>
  );
}
