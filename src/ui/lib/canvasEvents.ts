import type { Size, View } from './view';

/** A pointer event on the canvas, in both screen (px) and world coordinates. */
export interface CanvasPointer {
  type: 'down' | 'move' | 'up' | 'tap' | 'dblclick' | 'leave';
  sx: number;
  sy: number;
  wx: number;
  wy: number;
  view: View;
  size: Size;
  button: number;
  shift: boolean;
  alt: boolean;
  mod: boolean;
}

/**
 * What the canvas should do with a 'down' event: 'handled' captures the
 * pointer for the handler; 'pan' lets the canvas pan (a 'tap' follows if the
 * pointer didn't move); undefined means not interested.
 */
export type PointerResult = 'handled' | 'pan' | undefined;
