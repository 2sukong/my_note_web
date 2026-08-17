import { describe, expect, it } from 'vitest';
import { clampZoom, panBy, screenToWorld, worldToScreen, zoomAtPoint } from './coords';

describe('screenToWorld / worldToScreen', () => {
  it('is a round trip', () => {
    const viewport = { zoom: 2, panX: 50, panY: -30 };
    const world = { x: 123, y: 45 };
    const screen = worldToScreen(world, viewport);
    const back = screenToWorld(screen, viewport);
    expect(back.x).toBeCloseTo(world.x);
    expect(back.y).toBeCloseTo(world.y);
  });

  it('applies zoom and pan correctly', () => {
    const viewport = { zoom: 2, panX: 100, panY: 100 };
    // world (0,0) should map to screen (panX, panY)
    expect(worldToScreen({ x: 0, y: 0 }, viewport)).toEqual({ x: 100, y: 100 });
    // world (10, 10) at zoom 2 -> screen (120, 120)
    expect(worldToScreen({ x: 10, y: 10 }, viewport)).toEqual({ x: 120, y: 120 });
  });
});

describe('zoomAtPoint', () => {
  it('keeps the world point under the cursor fixed on screen', () => {
    const viewport = { zoom: 1, panX: 0, panY: 0 };
    const screenPoint = { x: 300, y: 200 };
    const worldBefore = screenToWorld(screenPoint, viewport);

    const next = zoomAtPoint(viewport, screenPoint, 2);
    const worldAfter = screenToWorld(screenPoint, next);

    expect(worldAfter.x).toBeCloseTo(worldBefore.x);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y);
    expect(next.zoom).toBe(2);
  });

  it('clamps to MIN/MAX zoom', () => {
    const viewport = { zoom: 1, panX: 0, panY: 0 };
    expect(zoomAtPoint(viewport, { x: 0, y: 0 }, 100).zoom).toBe(clampZoom(100));
    expect(zoomAtPoint(viewport, { x: 0, y: 0 }, 0.0001).zoom).toBe(clampZoom(0.0001));
  });
});

describe('panBy', () => {
  it('shifts panX/panY without touching zoom', () => {
    const viewport = { zoom: 1.5, panX: 10, panY: 10 };
    const next = panBy(viewport, 5, -5);
    expect(next).toEqual({ zoom: 1.5, panX: 15, panY: 5 });
  });
});
