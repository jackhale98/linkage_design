import { describe, expect, it } from 'vitest';
import {
  fitBox,
  formatCoord,
  gridSpacing,
  niceStep,
  panBy,
  screenToWorld,
  worldToScreen,
  zoomAt,
} from '../../../src/ui/lib/view';

const size = { width: 800, height: 600 };

describe('view transform', () => {
  it('maps world to screen with y up and back', () => {
    const v = { cx: 10, cy: 20, scale: 2 };
    expect(worldToScreen(v, size, 10, 20)).toEqual([400, 300]);
    expect(worldToScreen(v, size, 11, 21)).toEqual([402, 298]);
    const [x, y] = screenToWorld(v, size, 123, 456);
    const [sx, sy] = worldToScreen(v, size, x, y);
    expect(sx).toBeCloseTo(123);
    expect(sy).toBeCloseTo(456);
  });

  it('zooms about the cursor', () => {
    const v = { cx: 0, cy: 0, scale: 1 };
    const before = screenToWorld(v, size, 600, 100);
    const z = zoomAt(v, size, 600, 100, 2.5);
    const after = screenToWorld(z, size, 600, 100);
    expect(z.scale).toBe(2.5);
    expect(after[0]).toBeCloseTo(before[0]);
    expect(after[1]).toBeCloseTo(before[1]);
  });

  it('pans so content follows the pointer', () => {
    const v = panBy({ cx: 0, cy: 0, scale: 2 }, 20, 10);
    expect(worldToScreen(v, size, 0, 0)).toEqual([420, 310]);
  });

  it('fits a box', () => {
    const v = fitBox(size, { minX: 0, minY: 0, maxX: 200, maxY: 100 }, 50);
    expect(v).toEqual({ cx: 100, cy: 50, scale: 3.5 });
  });
});

describe('grid', () => {
  it('chooses 1-2-5 steps', () => {
    expect(niceStep(1, 10)).toBe(10);
    expect(niceStep(1, 12)).toBe(20);
    expect(niceStep(4, 10)).toBe(5);
    expect(niceStep(100, 10)).toBe(0.1);
  });

  it('uses major lines at round multiples', () => {
    expect(gridSpacing(1)).toEqual({ minor: 10, major: 100 });
    expect(gridSpacing(0.5)).toEqual({ minor: 20, major: 100 });
    expect(gridSpacing(2)).toEqual({ minor: 5, major: 50 });
  });

  it('formats coordinates with zoom-appropriate precision', () => {
    expect(formatCoord(12.3456, 1)).toBe('12.3');
    expect(formatCoord(12.3456, 50)).toBe('12.346');
    expect(formatCoord(-0.0001, 1)).toBe('0.0');
  });
});
