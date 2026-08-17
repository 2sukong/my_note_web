import { describe, expect, it } from 'vitest';
import { computeFreeCornerSnap, computeResizeSnap, computeSmartGuides } from './smartGuides';
import type { GuideTarget } from './smartGuides';

const anchor = { id: 'anchor', x: 100, y: 100, width: 200, height: 100 };

describe('computeSmartGuides', () => {
  it('snaps to a matching left edge and reports a vertical guide line', () => {
    const box = { x: 103, y: 400, width: 50, height: 50 }; // anchor.x=100, 3px off
    const others: GuideTarget[] = [anchor];
    const result = computeSmartGuides(box, others, 6);
    expect(result.dx).toBeCloseTo(-3);
    expect(result.lines.some((l) => l.x1 === l.x2 && Math.abs(l.x1 - 100) < 0.01)).toBe(true);
  });

  it('snaps to a matching center when closer than any edge', () => {
    // anchor centerX = 100+100=200. box centerX should end up there.
    const box = { x: 148, y: 400, width: 100, height: 50 }; // centerX=198, 2px off center
    const others: GuideTarget[] = [anchor];
    const result = computeSmartGuides(box, others, 6);
    expect(result.dx).toBeCloseTo(2);
  });

  it('does not snap beyond the threshold', () => {
    const box = { x: 130, y: 400, width: 50, height: 50 }; // 30px from anchor.x=100
    const others: GuideTarget[] = [anchor];
    const result = computeSmartGuides(box, others, 6);
    expect(result.dx).toBe(0);
    expect(result.dy).toBe(0);
    expect(result.lines).toHaveLength(0);
  });

  it('detects equal spacing between two neighbors and centers the gap', () => {
    const left: GuideTarget = { id: 'left', x: 0, y: 0, width: 100, height: 100 }; // right edge at 100
    const right: GuideTarget = { id: 'right', x: 370, y: 0, width: 100, height: 100 }; // left edge at 370
    // moving box at x=180 (gapLeft=80, far from any edge), width=100 -> right edge 280 (gapRight=90, also far)
    const box = { x: 180, y: 0, width: 100, height: 100 };
    const result = computeSmartGuides(box, [left, right], 12);
    // neither edge is within the threshold, so this falls through to equal-spacing:
    // equal gap should be (80+90)/2=85 each; dx makes gapLeft go from 80 to 85 => dx=5
    expect(result.dx).toBeCloseTo(5);
    expect(result.lines.length).toBeGreaterThan(0);
  });

  it('matches a single-side gap to an established gap elsewhere, even when not sandwiched', () => {
    const a: GuideTarget = { id: 'a', x: 0, y: 0, width: 100, height: 100 };
    const b: GuideTarget = { id: 'b', x: 150, y: 0, width: 100, height: 100 }; // established gap(a,b) = 50
    // box only has a left neighbor (b) — nothing to its right — yet its gap to b (52)
    // should still snap to match the established 50 gap.
    const box = { x: 302, y: 0, width: 80, height: 100 };
    const result = computeSmartGuides(box, [a, b], 5);
    expect(result.dx).toBeCloseTo(-2);
    expect(result.dy).toBe(0);
    expect(result.lines.length).toBeGreaterThan(0);
  });
});

describe('computeFreeCornerSnap', () => {
  it('snaps the free corner to another object edge', () => {
    // dragging a box whose right edge (free.x) is 3px away from other's left edge (300)
    const other: GuideTarget = { id: 'other', x: 300, y: 0, width: 50, height: 50 };
    const result = computeFreeCornerSnap({ x: 100, y: 100 }, { x: 297, y: 150 }, [other], 6, false);
    expect(result.x).toBeCloseTo(300);
  });

  it('matches size against another object when no position snap is found', () => {
    const other: GuideTarget = { id: 'other', x: 500, y: 500, width: 80, height: 40 };
    // anchor at (0,0), free at (78, 40) -> current width 78 (2px off other's width 80), far from any edge
    const result = computeFreeCornerSnap({ x: 0, y: 0 }, { x: 78, y: 40 }, [other], 5, true);
    expect(result.width).toBe(80);
    expect(result.x).toBeCloseTo(80);
  });

  it('prefers position snap over size match when both are available', () => {
    const other: GuideTarget = { id: 'other', x: 100, y: 0, width: 30, height: 40 };
    // free.x=101 is 1px from other's left edge (100) -> position snap should win over any size match
    const result = computeFreeCornerSnap({ x: 0, y: 0 }, { x: 101, y: 40 }, [other], 6, true);
    expect(result.x).toBeCloseTo(100);
    expect(result.width).toBeUndefined();
  });

  it('leaves the free corner untouched when nothing is within threshold', () => {
    const other: GuideTarget = { id: 'other', x: 900, y: 900, width: 10, height: 10 };
    const result = computeFreeCornerSnap({ x: 0, y: 0 }, { x: 50, y: 50 }, [other], 5, true);
    expect(result.x).toBe(50);
    expect(result.y).toBe(50);
    expect(result.width).toBeUndefined();
    expect(result.lines).toHaveLength(0);
  });

  it('applies an equal-spacing snap on the growing edge when no position/size match exists', () => {
    const a: GuideTarget = { id: 'a', x: 0, y: 0, width: 100, height: 100 };
    const b: GuideTarget = { id: 'b', x: 150, y: 0, width: 100, height: 100 }; // established gap(a,b) = 50
    const c: GuideTarget = { id: 'c', x: 500, y: 0, width: 100, height: 100 }; // ahead of the growing box
    // anchor/free chosen so the box's right edge lands 52 away from c (not within threshold of
    // any edge or width match) — should snap to match the established 50 gap instead.
    const result = computeFreeCornerSnap({ x: 300, y: 0 }, { x: 448, y: 100 }, [a, b, c], 5, true);
    expect(result.x).toBeCloseTo(450);
    expect(result.width).toBeUndefined();
  });

  it('snaps to a square when matchSquare is on and nothing else snapped', () => {
    // anchor (0,0) -> free (98, 103): far from any other object, width/height close (98 vs 103, diff=5)
    const other: GuideTarget = { id: 'other', x: 900, y: 900, width: 10, height: 10 };
    const result = computeFreeCornerSnap({ x: 0, y: 0 }, { x: 98, y: 103 }, [other], 6, true, true);
    const side = (98 + 103) / 2; // 100.5
    expect(result.x).toBeCloseTo(side);
    expect(result.y).toBeCloseTo(side);
    expect(result.lines.some((l) => l.x1 !== l.x2 && l.y1 !== l.y2)).toBe(true); // diagonal present
  });

  it('does not force a square when an axis already snapped to something else', () => {
    const other: GuideTarget = { id: 'other', x: 100, y: 0, width: 30, height: 40 };
    // free.x snaps to other's left edge (100); free.y (103) is close to the resulting width (100)
    // but matchSquare must not override the already-resolved position snap.
    const result = computeFreeCornerSnap({ x: 0, y: 0 }, { x: 101, y: 103 }, [other], 6, false, true);
    expect(result.x).toBeCloseTo(100);
    expect(result.y).toBeCloseTo(103); // untouched — y axis just never got a chance to be evaluated for square
  });
});

describe('computeResizeSnap', () => {
  it('snaps the east edge to another object edge, leaving the west edge fixed', () => {
    const other: GuideTarget = { id: 'o', x: 100, y: 0, width: 50, height: 50 };
    const box = { x: 0, y: 0, width: 97, height: 50 }; // right edge = 97, 3px from other's left (100)
    const result = computeResizeSnap(box, { east: true }, [other], 6, 20);
    expect(result.box.x).toBe(0);
    expect(result.box.width).toBeCloseTo(100);
  });

  it('snaps the west edge to another object edge, leaving the east edge fixed', () => {
    const other: GuideTarget = { id: 'o', x: 0, y: 0, width: 47, height: 50 }; // right edge = 47
    const box = { x: 50, y: 0, width: 100, height: 50 }; // left edge = 50 (right stays at 150)
    const result = computeResizeSnap(box, { west: true }, [other], 6, 20);
    expect(result.box.x).toBeCloseTo(47);
    expect(result.box.width).toBeCloseTo(103);
  });

  it('ignores edges the handle is not moving', () => {
    const other: GuideTarget = { id: 'o', x: 100, y: 0, width: 50, height: 50 };
    const box = { x: 0, y: 0, width: 97, height: 50 };
    const result = computeResizeSnap(box, { south: true }, [other], 6, 20);
    expect(result.box.width).toBe(97); // east not requested, so no X snap happens
  });

  it('clamps the snapped size to minSize instead of collapsing', () => {
    const other: GuideTarget = { id: 'o', x: 102, y: 0, width: 1, height: 50 }; // edges at 102/102.5/103
    const box = { x: 100, y: 0, width: 5, height: 50 }; // right edge = 105, 2px from other's right (103)
    const result = computeResizeSnap(box, { east: true }, [other], 6, 20);
    expect(result.box.width).toBe(20);
  });

  it('snaps a single changing edge to match the fixed opposite dimension (square)', () => {
    // only the east handle moves (width), height (50) stays fixed. width ends up at 47,
    // close enough to 50 to snap into a square — no other object involved.
    const box = { x: 0, y: 0, width: 47, height: 50 };
    const result = computeResizeSnap(box, { east: true }, [], 6, 20, true);
    expect(result.box.width).toBe(50);
    expect(result.box.height).toBe(50);
    expect(result.lines.length).toBeGreaterThan(0);
  });

  it('keeps the west edge as the fixed anchor when snapping to a square', () => {
    const box = { x: 50, y: 0, width: 47, height: 50 }; // right edge fixed at 97
    const result = computeResizeSnap(box, { west: true }, [], 6, 20, true);
    expect(result.box.width).toBe(50);
    expect(result.box.x).toBe(47); // 97 - 50
  });

  it('averages both dimensions into a square on a corner handle', () => {
    const box = { x: 0, y: 0, width: 97, height: 103 }; // diff=6 (within threshold), avg = 100
    const result = computeResizeSnap(box, { east: true, south: true }, [], 6, 20, true);
    expect(result.box.width).toBe(100);
    expect(result.box.height).toBe(100);
  });

  it('does not force a square when matchSquare is off', () => {
    const box = { x: 0, y: 0, width: 47, height: 50 };
    const result = computeResizeSnap(box, { east: true }, [], 6, 20, false);
    expect(result.box.width).toBe(47);
  });
});
