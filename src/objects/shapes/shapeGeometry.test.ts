import { describe, expect, it } from 'vitest';
import { computeDiagonal, localEndpoints } from './shapeGeometry';

describe('computeDiagonal + localEndpoints round-trip', () => {
  it('NW -> SE (both dx, dy positive)', () => {
    const { box, flipY, reverseDirection } = computeDiagonal({ x: 10, y: 10 }, { x: 50, y: 50 });
    expect(box).toEqual({ x: 10, y: 10, width: 40, height: 40 });
    expect(flipY).toBe(false);
    expect(reverseDirection).toBe(false);

    const { p1, p2 } = localEndpoints(box.width, box.height, flipY, reverseDirection);
    expect(worldOf(box, p1)).toEqual({ x: 10, y: 10 }); // tail = start
    expect(worldOf(box, p2)).toEqual({ x: 50, y: 50 }); // head = end
  });

  it('SE -> NW (both dx, dy negative)', () => {
    const { box, flipY, reverseDirection } = computeDiagonal({ x: 50, y: 50 }, { x: 10, y: 10 });
    expect(box).toEqual({ x: 10, y: 10, width: 40, height: 40 });
    expect(flipY).toBe(false);
    expect(reverseDirection).toBe(true);

    const { p1, p2 } = localEndpoints(box.width, box.height, flipY, reverseDirection);
    expect(worldOf(box, p1)).toEqual({ x: 50, y: 50 }); // tail = start
    expect(worldOf(box, p2)).toEqual({ x: 10, y: 10 }); // head = end
  });

  it('SW -> NE (dx positive, dy negative)', () => {
    const { box, flipY, reverseDirection } = computeDiagonal({ x: 10, y: 50 }, { x: 50, y: 10 });
    expect(box).toEqual({ x: 10, y: 10, width: 40, height: 40 });
    expect(flipY).toBe(true);
    expect(reverseDirection).toBe(true);

    const { p1, p2 } = localEndpoints(box.width, box.height, flipY, reverseDirection);
    expect(worldOf(box, p1)).toEqual({ x: 10, y: 50 }); // tail = start
    expect(worldOf(box, p2)).toEqual({ x: 50, y: 10 }); // head = end
  });

  it('NE -> SW (dx negative, dy positive)', () => {
    const { box, flipY, reverseDirection } = computeDiagonal({ x: 50, y: 10 }, { x: 10, y: 50 });
    expect(box).toEqual({ x: 10, y: 10, width: 40, height: 40 });
    expect(flipY).toBe(true);
    expect(reverseDirection).toBe(false);

    const { p1, p2 } = localEndpoints(box.width, box.height, flipY, reverseDirection);
    expect(worldOf(box, p1)).toEqual({ x: 50, y: 10 }); // tail = start
    expect(worldOf(box, p2)).toEqual({ x: 10, y: 50 }); // head = end
  });

  it('degenerate (start === end) collapses to a zero-size box without throwing', () => {
    const { box, flipY, reverseDirection } = computeDiagonal({ x: 5, y: 5 }, { x: 5, y: 5 });
    expect(box).toEqual({ x: 5, y: 5, width: 0, height: 0 });
    expect(() => localEndpoints(box.width, box.height, flipY, reverseDirection)).not.toThrow();
  });
});

function worldOf(box: { x: number; y: number }, local: { x: number; y: number }) {
  return { x: box.x + local.x, y: box.y + local.y };
}
