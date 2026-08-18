/**
 * 상단 툴바 + 파일 트리 사이드바에서 쓰는 공용 라인 아이콘 세트.
 * objects/style/StyleIcons.tsx와 같은 관례를 따른다: 정사각형 viewBox,
 * currentColor 선(stroke) 기반, 배경/그림자 없이 아이콘 자체만 그린다 —
 * 색은 버튼의 color로, 크기는 width/height prop으로 호출부가 정한다.
 */

const STROKE_WIDTH = 1.6;

interface IconProps {
  size?: number;
}

export function SelectIcon({ size = 18 }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none">
      <path
        d="M4.5 3.2 15.4 9.9l-4.6 1.1-1 4.6z"
        stroke="currentColor"
        strokeWidth={STROKE_WIDTH}
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function HighlighterIcon({ size = 18 }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none">
      <g transform="rotate(45 10 10)">
        <rect x="7.4" y="2.5" width="5.2" height="8" rx="1.2" stroke="currentColor" strokeWidth={STROKE_WIDTH} />
        <path d="M7.4 10.5h5.2l-1 4.4a1.6 1.6 0 0 1-3.2 0z" stroke="currentColor" strokeWidth={STROKE_WIDTH} strokeLinejoin="round" />
        <line x1="7.7" y1="6.3" x2="12.3" y2="6.3" stroke="currentColor" strokeWidth={STROKE_WIDTH} />
      </g>
    </svg>
  );
}

export function AnnotationIcon({ size = 18 }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none">
      <path
        d="M3 4.8c0-.9.7-1.6 1.6-1.6h10.8c.9 0 1.6.7 1.6 1.6v6.4c0 .9-.7 1.6-1.6 1.6H8.4L5 15.6v-2.8H4.6A1.6 1.6 0 0 1 3 11.2z"
        stroke="currentColor"
        strokeWidth={STROKE_WIDTH}
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TextToolIcon({ size = 18 }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none">
      <path d="M4 4.2h12M10 4.2v11.6" stroke="currentColor" strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
    </svg>
  );
}

export function FrameToolIcon({ size = 18 }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none">
      <path d="M6.5 2.5v15M13.5 2.5v15M2.5 6.5h15M2.5 13.5h15" stroke="currentColor" strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
    </svg>
  );
}

export function ImageToolIcon({ size = 18 }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none">
      <rect x="2.6" y="3.6" width="14.8" height="12.8" rx="1.6" stroke="currentColor" strokeWidth={STROKE_WIDTH} />
      <circle cx="7" cy="7.6" r="1.3" stroke="currentColor" strokeWidth={STROKE_WIDTH} />
      <path
        d="m3.6 14.4 4-4.2a1.4 1.4 0 0 1 2 0l1.3 1.3 2.6-2.8a1.4 1.4 0 0 1 2.1.1l1.8 2.1"
        stroke="currentColor"
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ArrowToolIcon({ size = 18 }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none">
      <path d="M4 16 16 4M9 4h7v7" stroke="currentColor" strokeWidth={STROKE_WIDTH} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function RectangleToolIcon({ size = 18 }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none">
      <rect x="3.2" y="4.8" width="13.6" height="10.4" rx="1.6" stroke="currentColor" strokeWidth={STROKE_WIDTH} />
    </svg>
  );
}

export function FolderIcon({ size = 15 }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none">
      <path
        d="M2.6 5.4c0-.7.6-1.3 1.3-1.3h3.4c.4 0 .8.2 1 .5l.8 1h6.4c.7 0 1.3.6 1.3 1.3v6.7c0 .7-.6 1.3-1.3 1.3H3.9c-.7 0-1.3-.6-1.3-1.3z"
        stroke="currentColor"
        strokeWidth={STROKE_WIDTH}
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PageIcon({ size = 15 }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none">
      <path
        d="M5.6 2.6h6l3 3v10.4c0 .7-.6 1.4-1.4 1.4H5.6c-.8 0-1.4-.7-1.4-1.4V4c0-.8.6-1.4 1.4-1.4z"
        stroke="currentColor"
        strokeWidth={STROKE_WIDTH}
        strokeLinejoin="round"
      />
      <path d="M11.6 2.6V5c0 .6.4 1 1 1h2.4" stroke="currentColor" strokeWidth={STROKE_WIDTH} strokeLinejoin="round" />
      <line x1="6.6" y1="10.4" x2="13" y2="10.4" stroke="currentColor" strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
      <line x1="6.6" y1="13" x2="13" y2="13" stroke="currentColor" strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
    </svg>
  );
}

export function SearchIcon({ size = 14 }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none">
      <circle cx="8.8" cy="8.8" r="5.4" stroke="currentColor" strokeWidth={STROKE_WIDTH} />
      <line x1="12.8" y1="12.8" x2="17" y2="17" stroke="currentColor" strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
    </svg>
  );
}

export function TrashIcon({ size = 15 }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none">
      <path d="M3.6 5.8h12.8" stroke="currentColor" strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
      <path
        d="M8 2.8h4c.5 0 .9.4.9.9v2.1h-5.8V3.7c0-.5.4-.9.9-.9z"
        stroke="currentColor"
        strokeWidth={STROKE_WIDTH}
        strokeLinejoin="round"
      />
      <path
        d="M5.2 5.8h9.6l-.7 9.6c-.1.9-.8 1.6-1.7 1.6H7.6c-.9 0-1.6-.7-1.7-1.6z"
        stroke="currentColor"
        strokeWidth={STROKE_WIDTH}
        strokeLinejoin="round"
      />
      <line x1="8.2" y1="8.6" x2="8.4" y2="14" stroke="currentColor" strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
      <line x1="11.8" y1="8.6" x2="11.6" y2="14" stroke="currentColor" strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
    </svg>
  );
}

export function PlusIcon({ size = 13 }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none">
      <path d="M10 3.5v13M3.5 10h13" stroke="currentColor" strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
    </svg>
  );
}

export function CloseIcon({ size = 13 }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none">
      <path d="m4.5 4.5 11 11M15.5 4.5l-11 11" stroke="currentColor" strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
    </svg>
  );
}

/** 파일 트리 확장/접기 화살촉. 오른쪽을 가리키는 하나로 두고, 펼친 상태에서는
 * CSS로 90도 회전시켜 아래를 가리키게 한다(별도 아이콘 두 벌을 만들 필요 없음). */
export function CaretIcon({ size = 10 }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none">
      <path d="M7 4.5 13 10l-6 5.5" stroke="currentColor" strokeWidth={STROKE_WIDTH} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChevronLeftIcon({ size = 13 }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none">
      <path d="M12.75 4.5 7.25 10l5.5 5.5" stroke="currentColor" strokeWidth={STROKE_WIDTH} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChevronRightIcon({ size = 13 }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none">
      <path d="M7.5 4.5 13 10l-5.5 5.5" stroke="currentColor" strokeWidth={STROKE_WIDTH} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChevronDownIcon({ size = 11 }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none">
      <path d="M4.5 7.5 10 13l5.5-5.5" stroke="currentColor" strokeWidth={STROKE_WIDTH} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 내보내기(백업 JSON 다운로드). 아래로 향하는 화살표 + 트레이 선. */
export function DownloadIcon({ size = 13 }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none">
      <path d="M10 3v9.3M6.2 9 10 12.8 13.8 9" stroke="currentColor" strokeWidth={STROKE_WIDTH} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 15.8h12" stroke="currentColor" strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
    </svg>
  );
}

/** 가져오기(백업 JSON 업로드). 위로 향하는 화살표 + 트레이 선. */
export function UploadIcon({ size = 13 }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} fill="none">
      <path d="M10 12.8V3.5M6.2 7.3 10 3.5l3.8 3.8" stroke="currentColor" strokeWidth={STROKE_WIDTH} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 15.8h12" stroke="currentColor" strokeWidth={STROKE_WIDTH} strokeLinecap="round" />
    </svg>
  );
}
