export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GuideTarget extends Box {
  id: string;
}

export interface Point {
  x: number;
  y: number;
}

/** world 좌표계의 선분 하나(직선/파선으로 그려질 가이드 하나). 세로선은 x1===x2,
 * 가로선은 y1===y2, 정사각형 표시용 대각선은 둘 다 다르다 — AlignmentGuideOverlay.tsx가
 * 셋을 구분하지 않고 그냥 <line>으로 그린다. */
export interface GuideLine {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface SmartGuideResult {
  dx: number;
  dy: number;
  lines: GuideLine[];
}

export interface FreeCornerSnapResult {
  x: number;
  y: number;
  width?: number;
  height?: number;
  lines: GuideLine[];
}

export interface ResizeEdgeFlags {
  east?: boolean;
  west?: boolean;
  north?: boolean;
  south?: boolean;
}

export interface ResizeSnapResult {
  box: Box;
  lines: GuideLine[];
}

/**
 * PowerPoint의 Smart Guides처럼, 객체를 옮기거나(computeSmartGuides) 리사이즈하거나
 * (computeResizeSnap) 드래그로 새로 그릴 때(computeFreeCornerSnap) 다른 객체와
 * 좌우/상하/가운데가 맞아떨어지거나, 같은 크기가 되거나, 양옆(위아래) 간격이
 * 같아지거나, 정사각형(가로=세로)이 되는 순간을 감지해 스냅 좌표 + 가이드선을
 * 계산하는 순수 함수 모음이다. DOM/스토어를 전혀 모른다 — 호출부(useObjectDrag.ts,
 * useObjectResize.ts, useDrawShapeTool.ts, useDrawTextTool.ts)가 world 좌표 box와
 * 화면 px 기준 threshold(스냅 민감도, 이미 /zoom해서 world 단위로 변환한 값)를
 * 넘겨준다. "같은 프레임 안에서만 비교" 규칙은 이 모듈이 알 필요가 없다 — 호출부가
 * others를 넘기기 전에 objects/align/frameScope.ts로 이미 걸러서 넘긴다.
 */
const EPSILON = 0.01;

function edgeValuesX(box: Box): number[] {
  return [box.x, box.x + box.width, box.x + box.width / 2];
}
function edgeValuesY(box: Box): number[] {
  return [box.y, box.y + box.height, box.y + box.height / 2];
}

function findClosest(candidates: number[], target: number, threshold: number): number | null {
  let best: number | null = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = Math.abs(c - target);
    if (d <= threshold && d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

/** box보다 axis 방향으로 뒤(아래/오른쪽)에 있는 후보 중 가장 가까운 것. */
function nearestAfter(box: Box, candidates: GuideTarget[], axis: 'x' | 'y'): GuideTarget | null {
  const boxEnd = axis === 'x' ? box.x + box.width : box.y + box.height;
  let nearest: GuideTarget | null = null;
  let nearestStart = Infinity;
  for (const o of candidates) {
    const start = axis === 'x' ? o.x : o.y;
    if (start < boxEnd) continue;
    if (start < nearestStart) {
      nearest = o;
      nearestStart = start;
    }
  }
  return nearest;
}

/** box보다 axis 방향으로 앞(위/왼쪽)에 있는 후보 중 가장 가까운 것. */
function nearestBefore(box: Box, candidates: GuideTarget[], axis: 'x' | 'y'): GuideTarget | null {
  const boxStart = axis === 'x' ? box.x : box.y;
  let nearest: GuideTarget | null = null;
  let nearestEnd = -Infinity;
  for (const o of candidates) {
    const end = axis === 'x' ? o.x + o.width : o.y + o.height;
    if (end > boxStart) continue;
    if (end > nearestEnd) {
      nearest = o;
      nearestEnd = end;
    }
  }
  return nearest;
}

/** box와 axis의 반대축 범위가 겹치는(대략 "같은 행/열"에 있는) 후보만 남긴다. */
function overlappingOn(box: Box, others: GuideTarget[], axis: 'x' | 'y'): GuideTarget[] {
  if (axis === 'x') return others.filter((o) => o.y < box.y + box.height && o.y + o.height > box.y);
  return others.filter((o) => o.x < box.x + box.width && o.x + o.width > box.x);
}

function vLine(id: string, x: number, y1: number, y2: number): GuideLine {
  return { id, x1: x, y1, x2: x, y2 };
}
function hLine(id: string, y: number, x1: number, x2: number): GuideLine {
  return { id, x1, y1: y, x2, y2: y };
}

/**
 * box를 dx만큼(혹은 dy만큼) 옮긴 뒤, 그 좌/우/가운데(세로선) 또는 위/아래/가운데(가로선)
 * 중 하나라도 다른 객체의 같은 종류 좌표와 정확히(EPSILON 이내) 일치하는 지점마다
 * 가이드선을 만든다. 같은 위치에 여러 대상이 겹치면(3개 이상 나란히 정렬된 경우) 그
 * 전부와 box 자신을 아우르는 범위로 선 하나에 합친다 — 그래야 "여러 객체가 한 줄로
 * 정렬됐다"는 게 끊긴 여러 선이 아니라 하나의 연속된 선으로 보인다.
 */
function collectVerticalLines(box: Box, others: GuideTarget[]): GuideLine[] {
  const mine = edgeValuesX(box);
  const groups = new Map<string, { position: number; minY: number; maxY: number }>();
  for (const other of others) {
    for (const ov of edgeValuesX(other)) {
      if (!mine.some((mv) => Math.abs(mv - ov) <= EPSILON)) continue;
      const key = ov.toFixed(2);
      const minY = Math.min(box.y, other.y);
      const maxY = Math.max(box.y + box.height, other.y + other.height);
      const g = groups.get(key);
      if (g) {
        g.minY = Math.min(g.minY, minY);
        g.maxY = Math.max(g.maxY, maxY);
      } else {
        groups.set(key, { position: ov, minY, maxY });
      }
    }
  }
  return Array.from(groups.values()).map((g, i) => vLine(`v-${g.position.toFixed(2)}-${i}`, g.position, g.minY, g.maxY));
}

function collectHorizontalLines(box: Box, others: GuideTarget[]): GuideLine[] {
  const mine = edgeValuesY(box);
  const groups = new Map<string, { position: number; minX: number; maxX: number }>();
  for (const other of others) {
    for (const ov of edgeValuesY(other)) {
      if (!mine.some((mv) => Math.abs(mv - ov) <= EPSILON)) continue;
      const key = ov.toFixed(2);
      const minX = Math.min(box.x, other.x);
      const maxX = Math.max(box.x + box.width, other.x + other.width);
      const g = groups.get(key);
      if (g) {
        g.minX = Math.min(g.minX, minX);
        g.maxX = Math.max(g.maxX, maxX);
      } else {
        groups.set(key, { position: ov, minX, maxX });
      }
    }
  }
  return Array.from(groups.values()).map((g, i) => hLine(`h-${g.position.toFixed(2)}-${i}`, g.position, g.minX, g.maxX));
}

/** box의 좌/우/가운데 중 하나를 다른 객체의 좌/우/가운데 중 하나에 맞추는 데 필요한
 * dx 후보들 중, 이동량(|dx|)이 가장 작은 것을 고른다. threshold 밖이면 무시. */
function bestAlignDx(box: Box, others: GuideTarget[], threshold: number): number | null {
  const mine = edgeValuesX(box);
  let best: number | null = null;
  let bestDist = Infinity;
  for (const other of others) {
    for (const ov of edgeValuesX(other)) {
      for (const mv of mine) {
        const dist = Math.abs(ov - mv);
        if (dist <= threshold && dist < bestDist) {
          best = ov - mv;
          bestDist = dist;
        }
      }
    }
  }
  return best;
}

function bestAlignDy(box: Box, others: GuideTarget[], threshold: number): number | null {
  const mine = edgeValuesY(box);
  let best: number | null = null;
  let bestDist = Infinity;
  for (const other of others) {
    for (const ov of edgeValuesY(other)) {
      for (const mv of mine) {
        const dist = Math.abs(ov - mv);
        if (dist <= threshold && dist < bestDist) {
          best = ov - mv;
          bestDist = dist;
        }
      }
    }
  }
  return best;
}

/** others 중 서로 "같은 행/열"에서 바로 인접한 쌍들의 간격을 전부 모은다 — 캔버스
 * 어딘가에 이미 자리 잡은 "간격 리듬"을 파악하기 위함. 무빙 박스가 이웃 하나(왼쪽
 * 또는 위쪽)만 있어도, 그 간격을 이 리듬 중 하나에 맞출 수 있다(가운데 낀 경우가
 * 아니어도 등간격 가이드가 뜨는 이유). */
function establishedGapsX(others: GuideTarget[]): number[] {
  const gaps: number[] = [];
  for (const a of others) {
    const rowMates = overlappingOn(a, others, 'x').filter((o) => o.id !== a.id);
    const next = nearestAfter(a, rowMates, 'x');
    if (next) gaps.push(next.x - (a.x + a.width));
  }
  return gaps;
}

function establishedGapsY(others: GuideTarget[]): number[] {
  const gaps: number[] = [];
  for (const a of others) {
    const colMates = overlappingOn(a, others, 'y').filter((o) => o.id !== a.id);
    const next = nearestAfter(a, colMates, 'y');
    if (next) gaps.push(next.y - (a.y + a.height));
  }
  return gaps;
}

interface SpacingSnap {
  dx: number;
  lines: GuideLine[];
}

/**
 * box와 "같은 행"에 있는 이웃들을 기준으로 등간격 스냅을 찾는다. 두 가지 방식을 모두
 * 시도해서 이동량이 가장 작은 것을 쓴다:
 *  (a) 가운데 낀 경우 — 왼쪽 이웃과의 간격 = 오른쪽 이웃과의 간격이 되도록.
 *  (b) 가장자리인 경우 — 이웃이 한쪽에만 있어도, 그 간격을 캔버스 어딘가에 이미
 *      자리 잡은 다른 간격(establishedGapsX)에 맞춘다.
 */
function equalSpacingX(box: Box, others: GuideTarget[], threshold: number): SpacingSnap | null {
  const overlapping = overlappingOn(box, others, 'x');
  const left = nearestBefore(box, overlapping, 'x');
  const right = nearestAfter(box, overlapping, 'x');
  const centerY = box.y + box.height / 2;
  const tick = Math.max(threshold, 4);
  const candidates: SpacingSnap[] = [];

  if (left && right) {
    const gapLeft = box.x - (left.x + left.width);
    const gapRight = right.x - (box.x + box.width);
    if (gapLeft >= 0 && gapRight >= 0 && Math.abs(gapLeft - gapRight) <= threshold) {
      const dx = (gapRight - gapLeft) / 2;
      const midLeftX = (left.x + left.width + (box.x + dx)) / 2;
      const midRightX = (box.x + dx + box.width + right.x) / 2;
      candidates.push({
        dx,
        lines: [
          vLine(`space-l-${left.id}`, midLeftX, centerY - tick, centerY + tick),
          vLine(`space-r-${right.id}`, midRightX, centerY - tick, centerY + tick),
        ],
      });
    }
  }

  const established = establishedGapsX(others);
  if (left) {
    const gapLeft = box.x - (left.x + left.width);
    const g = findClosest(established, gapLeft, threshold);
    if (g !== null) {
      const dx = g - gapLeft;
      const midX = (left.x + left.width + (box.x + dx)) / 2;
      candidates.push({ dx, lines: [vLine(`space-l-${left.id}-ref`, midX, centerY - tick, centerY + tick)] });
    }
  }
  if (right) {
    const gapRight = right.x - (box.x + box.width);
    const g = findClosest(established, gapRight, threshold);
    if (g !== null) {
      const dx = gapRight - g;
      const midX = (box.x + dx + box.width + right.x) / 2;
      candidates.push({ dx, lines: [vLine(`space-r-${right.id}-ref`, midX, centerY - tick, centerY + tick)] });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => Math.abs(a.dx) - Math.abs(b.dx));
  return candidates[0];
}

function equalSpacingY(box: Box, others: GuideTarget[], threshold: number): { dy: number; lines: GuideLine[] } | null {
  const overlapping = overlappingOn(box, others, 'y');
  const top = nearestBefore(box, overlapping, 'y');
  const bottom = nearestAfter(box, overlapping, 'y');
  const centerX = box.x + box.width / 2;
  const tick = Math.max(threshold, 4);
  const candidates: Array<{ dy: number; lines: GuideLine[] }> = [];

  if (top && bottom) {
    const gapTop = box.y - (top.y + top.height);
    const gapBottom = bottom.y - (box.y + box.height);
    if (gapTop >= 0 && gapBottom >= 0 && Math.abs(gapTop - gapBottom) <= threshold) {
      const dy = (gapBottom - gapTop) / 2;
      const midTopY = (top.y + top.height + (box.y + dy)) / 2;
      const midBottomY = (box.y + dy + box.height + bottom.y) / 2;
      candidates.push({
        dy,
        lines: [
          hLine(`space-t-${top.id}`, midTopY, centerX - tick, centerX + tick),
          hLine(`space-b-${bottom.id}`, midBottomY, centerX - tick, centerX + tick),
        ],
      });
    }
  }

  const established = establishedGapsY(others);
  if (top) {
    const gapTop = box.y - (top.y + top.height);
    const g = findClosest(established, gapTop, threshold);
    if (g !== null) {
      const dy = g - gapTop;
      const midY = (top.y + top.height + (box.y + dy)) / 2;
      candidates.push({ dy, lines: [hLine(`space-t-${top.id}-ref`, midY, centerX - tick, centerX + tick)] });
    }
  }
  if (bottom) {
    const gapBottom = bottom.y - (box.y + box.height);
    const g = findClosest(established, gapBottom, threshold);
    if (g !== null) {
      const dy = gapBottom - g;
      const midY = (box.y + dy + box.height + bottom.y) / 2;
      candidates.push({ dy, lines: [hLine(`space-b-${bottom.id}-ref`, midY, centerX - tick, centerX + tick)] });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => Math.abs(a.dy) - Math.abs(b.dy));
  return candidates[0];
}

/** box가 정사각형(가로=세로)에 가까우면 그 대각선 X자 가이드선 2개를 만든다. */
function squareGuideLines(box: Box): GuideLine[] {
  return [
    { id: 'square-1', x1: box.x, y1: box.y, x2: box.x + box.width, y2: box.y + box.height },
    { id: 'square-2', x1: box.x + box.width, y1: box.y, x2: box.x, y2: box.y + box.height },
  ];
}

/**
 * 요구사항(정렬 가이드): 기존 객체를 옮길 때 쓴다 — 크기(width/height)는 고정이고
 * 위치(dx, dy)만 스냅 대상이다. X/Y 각 축을 독립적으로 처리한다: 먼저 다른 객체의
 * 좌/우/가운데(X) 또는 위/아래/가운데(Y)에 맞춰지는 가장 가까운 정렬을 찾고, 그게
 * 없으면 등간격 스냅(equalSpacingX/Y — 가운데 낀 경우와 가장자리인 경우 둘 다)을
 * 시도한다. 호출부는 이 box를 최종 위치가 아니라 "현재 드래그 중인 커서 기준 잠정
 * 위치"로 넘기고, 반환된 dx/dy를 그 위에 추가로 더해서 실제 좌표를 정한다.
 */
export function computeSmartGuides(box: Box, others: GuideTarget[], threshold: number): SmartGuideResult {
  const dx = bestAlignDx(box, others, threshold);
  const dy = bestAlignDy(box, others, threshold);

  const lines: GuideLine[] = [];
  let finalDx = 0;
  let finalDy = 0;

  if (dx !== null) {
    finalDx = dx;
    lines.push(...collectVerticalLines({ ...box, x: box.x + dx }, others));
  } else {
    const spacing = equalSpacingX(box, others, threshold);
    if (spacing) {
      finalDx = spacing.dx;
      lines.push(...spacing.lines);
    }
  }

  if (dy !== null) {
    finalDy = dy;
    lines.push(...collectHorizontalLines({ ...box, y: box.y + dy }, others));
  } else {
    const spacing = equalSpacingY(box, others, threshold);
    if (spacing) {
      finalDy = spacing.dy;
      lines.push(...spacing.lines);
    }
  }

  return { dx: finalDx, dy: finalDy, lines };
}

function bestFreeAxisSnap(anchorV: number, freeV: number, targets: number[], threshold: number): number | null {
  let best: number | null = null;
  let bestDist = Infinity;
  for (const t of targets) {
    // 후보1: 자유 코너 좌표 자체가 타깃과 같아진다. 후보2: anchor와 자유 코너의
    // 가운데(centerX/Y)가 타깃과 같아진다(free = 2*target - anchor로 역산).
    for (const cand of [t, 2 * t - anchorV]) {
      const dist = Math.abs(cand - freeV);
      if (dist <= threshold && dist < bestDist) {
        best = cand;
        bestDist = dist;
      }
    }
  }
  return best;
}

/**
 * 요구사항(정렬 가이드): 드래그로 새 객체(화살표/사각형/텍스트 상자)를 그릴 때 쓴다.
 * anchor(드래그 시작점)는 고정, free(현재 커서, world 좌표)만 움직인다. 각 축(X/Y)은
 * 독립적으로 우선순위대로 시도한다: (1) 다른 객체와의 위치 정렬(좌/우/가운데),
 * (2) matchSize가 true일 때만(생성 중에만 의미가 있다 — 이동은 크기가 안 바뀐다)
 * 다른 객체와 같은 폭/높이가 되는 스냅, (3) 자유 변 쪽 이웃과의 간격을 캔버스
 * 어딘가에 이미 자리 잡은 간격에 맞추는 등간격 스냅. 셋 다 못 찾으면 커서를 그대로 쓴다.
 *
 * matchSquare가 true면(사각형/텍스트 도구 전용 — 화살표에는 의미가 없다), 위 세 단계
 * 어느 축도 스냅되지 않았을 때만 마지막으로 "지금 그리는 크기가 정사각형에 가까운가"를
 * 검사해서, 가까우면 가로=세로로 딱 맞춘다(다른 스냅이 이미 하나라도 걸렸으면 그
 * 결과를 정사각형 때문에 뒤틀지 않는다 — 우선순위 낮음).
 */
export function computeFreeCornerSnap(
  anchor: Point,
  free: Point,
  others: GuideTarget[],
  threshold: number,
  matchSize: boolean,
  matchSquare = false,
): FreeCornerSnapResult {
  let freeX = free.x;
  let freeY = free.y;
  let width: number | undefined;
  let height: number | undefined;
  let xSnapped = false;
  let ySnapped = false;

  const targetsX = others.flatMap((o) => edgeValuesX(o));
  const posSnapX = bestFreeAxisSnap(anchor.x, free.x, targetsX, threshold);
  if (posSnapX !== null) {
    freeX = posSnapX;
    xSnapped = true;
  } else if (matchSize) {
    const curWidth = Math.abs(free.x - anchor.x);
    const wMatch = findClosest(others.map((o) => o.width), curWidth, threshold);
    if (wMatch !== null) {
      width = wMatch;
      freeX = anchor.x + (free.x >= anchor.x ? wMatch : -wMatch);
      xSnapped = true;
    }
  }

  const targetsY = others.flatMap((o) => edgeValuesY(o));
  const posSnapY = bestFreeAxisSnap(anchor.y, free.y, targetsY, threshold);
  if (posSnapY !== null) {
    freeY = posSnapY;
    ySnapped = true;
  } else if (matchSize) {
    const curHeight = Math.abs(free.y - anchor.y);
    const hMatch = findClosest(others.map((o) => o.height), curHeight, threshold);
    if (hMatch !== null) {
      height = hMatch;
      freeY = anchor.y + (free.y >= anchor.y ? hMatch : -hMatch);
      ySnapped = true;
    }
  }

  let box: Box = {
    x: Math.min(anchor.x, freeX),
    y: Math.min(anchor.y, freeY),
    width: Math.abs(freeX - anchor.x),
    height: Math.abs(freeY - anchor.y),
  };

  const spacingLines: GuideLine[] = [];
  const tick = Math.max(threshold, 4);

  if (!xSnapped) {
    const freeIsRight = freeX >= anchor.x;
    const overlapping = overlappingOn(box, others, 'x');
    const neighbor = freeIsRight ? nearestAfter(box, overlapping, 'x') : nearestBefore(box, overlapping, 'x');
    if (neighbor) {
      const currentGap = freeIsRight ? neighbor.x - (box.x + box.width) : box.x - (neighbor.x + neighbor.width);
      const g = findClosest(establishedGapsX(others), currentGap, threshold);
      if (g !== null) {
        freeX = freeIsRight ? neighbor.x - g : neighbor.x + neighbor.width + g;
        box = { x: Math.min(anchor.x, freeX), y: box.y, width: Math.abs(freeX - anchor.x), height: box.height };
        const centerY = box.y + box.height / 2;
        const midX = freeIsRight ? (box.x + box.width + neighbor.x) / 2 : (neighbor.x + neighbor.width + box.x) / 2;
        spacingLines.push(vLine(`space-x-${neighbor.id}`, midX, centerY - tick, centerY + tick));
        xSnapped = true;
      }
    }
  }

  if (!ySnapped) {
    const freeIsBottom = freeY >= anchor.y;
    const overlapping = overlappingOn(box, others, 'y');
    const neighbor = freeIsBottom ? nearestAfter(box, overlapping, 'y') : nearestBefore(box, overlapping, 'y');
    if (neighbor) {
      const currentGap = freeIsBottom ? neighbor.y - (box.y + box.height) : box.y - (neighbor.y + neighbor.height);
      const g = findClosest(establishedGapsY(others), currentGap, threshold);
      if (g !== null) {
        freeY = freeIsBottom ? neighbor.y - g : neighbor.y + neighbor.height + g;
        box = { x: box.x, y: Math.min(anchor.y, freeY), width: box.width, height: Math.abs(freeY - anchor.y) };
        const centerX = box.x + box.width / 2;
        const midY = freeIsBottom ? (box.y + box.height + neighbor.y) / 2 : (neighbor.y + neighbor.height + box.y) / 2;
        spacingLines.push(hLine(`space-y-${neighbor.id}`, midY, centerX - tick, centerX + tick));
        ySnapped = true;
      }
    }
  }

  let squareLines: GuideLine[] = [];
  if (matchSquare && !xSnapped && !ySnapped && Math.abs(box.width - box.height) <= threshold) {
    const side = (box.width + box.height) / 2;
    freeX = anchor.x + (freeX >= anchor.x ? side : -side);
    freeY = anchor.y + (freeY >= anchor.y ? side : -side);
    box = { x: Math.min(anchor.x, freeX), y: Math.min(anchor.y, freeY), width: side, height: side };
    squareLines = squareGuideLines(box);
  }

  return {
    x: freeX,
    y: freeY,
    width,
    height,
    lines: [...collectVerticalLines(box, others), ...collectHorizontalLines(box, others), ...spacingLines, ...squareLines],
  };
}

/**
 * 요구사항(정렬 가이드): 리사이즈 핸들을 끌 때 쓴다. handle이 실제로 움직이는 변만
 * (east/west 중 최대 하나, north/south 중 최대 하나) 다른 객체의 좌/우/가운데
 * (또는 위/아래/가운데)에 맞춘다. 종횡비가 잠긴 상태(예: 이미지)에서는 호출부가 아예
 * 이 함수를 부르지 않는다 — 한 변만 스냅해버리면 다른 변과의 비율이 깨지기 때문
 * (useObjectResize.ts 참고). MIN_SIZE보다 작아지지 않도록 다시 한 번 clamp한다.
 *
 * matchSquare가 true면(사각형/텍스트 전용), 위치 정렬로 폭/높이 어느 쪽도 안 바뀌었고
 * 실제로 변하는 크기가 반대쪽과 비슷해지면 정확히 정사각형으로 맞춘다.
 */
export function computeResizeSnap(
  box: Box,
  edges: ResizeEdgeFlags,
  others: GuideTarget[],
  threshold: number,
  minSize: number,
  matchSquare = false,
): ResizeSnapResult {
  let { x, y, width, height } = box;
  let widthSnapped = false;
  let heightSnapped = false;

  if (edges.east) {
    const targets = others.flatMap((o) => edgeValuesX(o));
    const snapped = findClosest(targets, x + width, threshold);
    if (snapped !== null) {
      width = Math.max(minSize, snapped - x);
      widthSnapped = true;
    }
  } else if (edges.west) {
    const right = x + width;
    const targets = others.flatMap((o) => edgeValuesX(o));
    const snapped = findClosest(targets, x, threshold);
    if (snapped !== null) {
      x = snapped;
      width = Math.max(minSize, right - snapped);
      widthSnapped = true;
    }
  }

  if (edges.south) {
    const targets = others.flatMap((o) => edgeValuesY(o));
    const snapped = findClosest(targets, y + height, threshold);
    if (snapped !== null) {
      height = Math.max(minSize, snapped - y);
      heightSnapped = true;
    }
  } else if (edges.north) {
    const bottom = y + height;
    const targets = others.flatMap((o) => edgeValuesY(o));
    const snapped = findClosest(targets, y, threshold);
    if (snapped !== null) {
      y = snapped;
      height = Math.max(minSize, bottom - y);
      heightSnapped = true;
    }
  }

  const changesWidth = !!(edges.east || edges.west);
  const changesHeight = !!(edges.north || edges.south);
  let squareLines: GuideLine[] = [];

  if (matchSquare && Math.abs(width - height) <= threshold) {
    if (changesWidth && !widthSnapped && !changesHeight) {
      // 폭만 바뀌는 핸들(e/w) — 고정된 높이에 맞춰 폭을 스냅.
      if (edges.west) x -= height - width;
      width = height;
      squareLines = squareGuideLines({ x, y, width, height });
    } else if (changesHeight && !heightSnapped && !changesWidth) {
      // 높이만 바뀌는 핸들(n/s) — 고정된 폭에 맞춰 높이를 스냅.
      if (edges.north) y -= width - height;
      height = width;
      squareLines = squareGuideLines({ x, y, width, height });
    } else if (changesWidth && changesHeight && !widthSnapped && !heightSnapped) {
      // 모서리 핸들 — 두 변 다 아직 안 정해졌으면 평균으로 정사각형을 만든다.
      const side = (width + height) / 2;
      if (edges.west) x -= side - width;
      if (edges.north) y -= side - height;
      width = side;
      height = side;
      squareLines = squareGuideLines({ x, y, width, height });
    }
  }

  const finalBox: Box = { x, y, width, height };
  return {
    box: finalBox,
    lines: [...collectVerticalLines(finalBox, others), ...collectHorizontalLines(finalBox, others), ...squareLines],
  };
}
