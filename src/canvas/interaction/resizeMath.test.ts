import { describe, expect, it } from 'vitest';
import { computeResizedBox } from './resizeMath';
import type { Box } from './resizeMath';

const box: Box = { x: 100, y: 100, width: 200, height: 100 };

describe('computeResizedBox', () => {
  it('se handle grows width/height without moving x/y', () => {
    const next = computeResizedBox(box, 'se', 50, 30);
    expect(next).toEqual({ x: 100, y: 100, width: 250, height: 130 });
  });

  it('nw handle moves x/y and shrinks width/height in the opposite direction', () => {
    const next = computeResizedBox(box, 'nw', 20, 10);
    expect(next).toEqual({ x: 120, y: 110, width: 180, height: 90 });
  });

  it('e handle only changes width', () => {
    const next = computeResizedBox(box, 'e', 40, 999);
    expect(next).toEqual({ x: 100, y: 100, width: 240, height: 100 });
  });

  it('n handle only changes y/height', () => {
    const next = computeResizedBox(box, 'n', 999, 20);
    expect(next).toEqual({ x: 100, y: 120, width: 200, height: 80 });
  });

  it('does not shrink below MIN_SIZE(20)', () => {
    const next = computeResizedBox(box, 'se', -1000, -1000);
    expect(next.width).toBe(20);
    expect(next.height).toBe(20);
  });

  it('west handle clamped at MIN_SIZE keeps the right edge fixed', () => {
    // width 200 -> 오른쪽 끝(x+width=300)이 고정된 채 왼쪽으로 아무리 밀어도 width는 20 밑으로 안 내려감
    const next = computeResizedBox(box, 'w', 5000, 0);
    expect(next.width).toBe(20);
    expect(next.x + next.width).toBe(box.x + box.width); // 오른쪽 끝 고정 확인
  });

  describe('aspectRatio locked (Phase 5, image resize)', () => {
    const squareBox: Box = { x: 100, y: 100, width: 200, height: 200 }; // aspectRatio = 1

    it('corner handle: diagonal-projected distance drives both axes (dx-heavy drag)', () => {
      // dx(100)/dy(10)를 (width,height) 대각선에 투영한 거리만큼만 커진다 —
      // 예전엔 dx(더 큰 축)의 원본 픽셀값(100)을 두 축에 그대로 적용해 300/300이 나왔지만,
      // 그러면 실제로 10px밖에 안 움직인 세로축이 마우스보다 훨씬 빠르게 커지는 버그였다.
      const next = computeResizedBox(squareBox, 'se', 100, 10, 1);
      expect(next.width).toBeCloseTo(255);
      expect(next.height).toBeCloseTo(255);
      expect(next.x).toBe(100);
      expect(next.y).toBe(100);
    });

    it('corner handle: diagonal-projected distance drives both axes (dy-heavy drag)', () => {
      const next = computeResizedBox(squareBox, 'se', 10, 100, 1);
      expect(next.width).toBeCloseTo(255);
      expect(next.height).toBeCloseTo(255);
    });

    it('nw handle keeps the bottom-right corner fixed while locked', () => {
      const next = computeResizedBox(squareBox, 'nw', 50, 5, 1);
      expect(next.width).toBe(172.5);
      expect(next.height).toBe(172.5);
      expect(next.x + next.width).toBe(squareBox.x + squareBox.width);
      expect(next.y + next.height).toBe(squareBox.y + squareBox.height);
    });

    it('edge handle (e only) derives height from width using the ratio', () => {
      const wideBox: Box = { x: 0, y: 0, width: 200, height: 100 }; // ratio 2
      const next = computeResizedBox(wideBox, 'e', 100, 0, 2);
      expect(next.width).toBe(300);
      expect(next.height).toBe(150);
    });

    it('edge handle (n only) derives width from height using the ratio', () => {
      const wideBox: Box = { x: 0, y: 0, width: 200, height: 100 }; // ratio 2
      const next = computeResizedBox(wideBox, 'n', 0, 40); // height 100 -> 60
      const locked = computeResizedBox(wideBox, 'n', 0, 40, 2);
      expect(next.height).toBe(60); // unlocked sanity check
      expect(locked.height).toBe(60);
      expect(locked.width).toBe(120); // 60 * ratio(2)
    });

    it('does not shrink below MIN_SIZE(20) even when locked', () => {
      const next = computeResizedBox(squareBox, 'se', -1000, -1000, 1);
      expect(next.width).toBe(20);
      expect(next.height).toBe(20);
    });
  });
});
