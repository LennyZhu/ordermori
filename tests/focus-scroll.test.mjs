import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleInputScrollOffset } from '../src/ui/focusScroll.ts';

const viewport = { top: 110, height: 300 };

test('a visible field preserves a nonzero scroll offset, including focus switches', () => {
  for (const input of [{ top: 150, height: 44 }, { top: 250, height: 72 }, { top: 330, height: 44 }]) {
    assert.equal(visibleInputScrollOffset(320, input, viewport), null);
  }
});

test('keyboard resizing scrolls only the obscured portion above the fixed footer', () => {
  const input = { top: 450, height: 44 };
  assert.equal(visibleInputScrollOffset(320, input, { top: 110, height: 650 }), null);
  assert.equal(visibleInputScrollOffset(320, input, viewport), 416);
  assert.equal(visibleInputScrollOffset(416, { top: 354, height: 44 }, viewport), null);
});

test('an upper field moves only enough to clear the navigation edge', () => {
  assert.equal(visibleInputScrollOffset(320, { top: 80, height: 44 }, viewport), 278);
  assert.equal(visibleInputScrollOffset(278, { top: 122, height: 44 }, viewport), null);
});

test('expanding the viewport after keyboard dismissal does not request a scroll reset', () => {
  assert.equal(visibleInputScrollOffset(416, { top: 354, height: 44 }, { top: 110, height: 650 }), null);
});

test('large multiline fields do not oscillate between top and bottom alignment', () => {
  assert.equal(visibleInputScrollOffset(320, { top: 150, height: 500 }, viewport), null);
  assert.equal(visibleInputScrollOffset(320, { top: 70, height: 500 }, viewport), null);
});

test('invalid measurements are ignored and upward corrections never overscroll negative', () => {
  assert.equal(visibleInputScrollOffset(10, { top: 80, height: 44 }, viewport), 0);
  for (const invalid of [{ top: NaN, height: 44 }, { top: 120, height: 0 }]) {
    assert.equal(visibleInputScrollOffset(320, invalid, viewport), null);
  }
  assert.equal(visibleInputScrollOffset(320, { top: 150, height: 44 }, { top: 110, height: 0 }), null);
});
