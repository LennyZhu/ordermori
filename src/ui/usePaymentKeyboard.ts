import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import { Keyboard, Platform, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { visibleInputScrollOffset } from './focusScroll';

// New settings forms reuse the P1 visibility calculation without altering OrderEditor.
export function usePaymentKeyboard() {
  const insets = useSafeAreaInsets();
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const frame = useRef<ComponentRef<typeof View>>(null);
  const inputs = useRef<Record<string, ComponentRef<typeof TextInput> | null>>({});
  const focused = useRef<string | null>(null);
  const offset = useRef(0); const ticket = useRef(0); const dragging = useRef(false);
  const active = useRef(true); const closing = useRef(false); const shown = useRef(Keyboard.isVisible());
  const [keyboardVisible, setKeyboardVisible] = useState(Keyboard.isVisible());
  const [keyboardOffset, setKeyboardOffset] = useState(insets.top + 48);
  const reveal = useCallback((force = false) => {
    if (!active.current || dragging.current || closing.current || (!force && !shown.current)) return;
    const key = focused.current; const input = key ? inputs.current[key] : null; const scroller = scroll.current;
    if (!key || !input || !scroller) return;
    const current = ++ticket.current; const start = offset.current;
    scroller.getNativeScrollRef()?.measureInWindow((_x: number, top: number, _w: number, height: number) => {
      input.measureInWindow((_ix, inputTop, _iw, inputHeight) => {
        if (!active.current || dragging.current || closing.current || ticket.current !== current || focused.current !== key || inputs.current[key] !== input || Math.abs(offset.current - start) > 1) return;
        const y = visibleInputScrollOffset(start, { top: inputTop, height: inputHeight }, { top, height });
        if (y !== null) scroller.scrollTo({ y, animated: true });
      });
    });
  }, []);
  useEffect(() => {
    active.current = true;
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => { shown.current = true; closing.current = false; setKeyboardVisible(true); });
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => { shown.current = false; closing.current = true; ticket.current++; setKeyboardVisible(false); });
    const done = Keyboard.addListener('keyboardDidShow', () => reveal());
    const changed = Platform.OS === 'ios' ? Keyboard.addListener('keyboardDidChangeFrame', () => reveal()) : null;
    return () => { active.current = false; show.remove(); hide.remove(); done.remove(); changed?.remove(); };
  }, [reveal]);
  return { scroll, frame, insets, keyboardVisible, keyboardOffset,
    measureFrame: () => frame.current?.measureInWindow((_x, y) => { if (active.current) setKeyboardOffset(y); }),
    field: (key: string) => ({ ref: (input: ComponentRef<typeof TextInput> | null) => { inputs.current[key] = input; },
      onFocus: () => { focused.current = key; closing.current = false; reveal(true); },
      onBlur: () => { if (focused.current === key) { focused.current = null; ticket.current++; } } }),
    scrollProps: { automaticallyAdjustKeyboardInsets: false, automaticallyAdjustContentInsets: false, contentInsetAdjustmentBehavior: 'never' as const,
      keyboardShouldPersistTaps: 'handled' as const, keyboardDismissMode: 'interactive' as const, scrollEventThrottle: 16,
      onScroll: (event: { nativeEvent: { contentOffset: { y: number } } }) => { offset.current = event.nativeEvent.contentOffset.y; },
      onScrollBeginDrag: () => { dragging.current = true; ticket.current++; }, onScrollEndDrag: () => { dragging.current = false; },
      onLayout: () => reveal(), onContentSizeChange: () => reveal() },
  };
}
