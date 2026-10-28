interface WindowRect { top: number; height: number }

// Both rectangles use window coordinates. Return null when no scrolling is needed.
export function visibleInputScrollOffset(offset: number, input: WindowRect, viewport: WindowRect): number | null {
  if (![offset, input.top, input.height, viewport.top, viewport.height].every(Number.isFinite) || input.height <= 0 || viewport.height <= 24) return null;
  const top = viewport.top + 12;
  const bottom = viewport.top + viewport.height - 12;
  const inputBottom = input.top + input.height;
  // A multiline field taller than the viewport cannot fit completely. Preserve its
  // visible portion instead of alternating between top and bottom alignment.
  if (input.height > bottom - top && input.top < bottom && inputBottom > top) return null;
  const delta = input.top < top ? input.top - top : inputBottom > bottom ? inputBottom - bottom : 0;
  const target = Math.max(0, offset + delta);
  return Math.abs(delta) <= 1 || Math.abs(target - offset) <= 1 ? null : target;
}
