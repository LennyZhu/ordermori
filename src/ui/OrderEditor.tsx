import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import { Alert, AppState, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { randomUUID } from 'expo-crypto';
import { useApp } from '../AppProvider';
import { DomainError, SHIPPING, blankInput, countChars, editable, errorMessage, evaluate, money, toInput } from '../domain/model';
import type { FormItem, OrderInput, Shipping } from '../domain/model';
import { Button, ErrorNotice, Loading, color, s, shippingText } from './common';
import { ActionButton, CompactField, SectionHeading, TextAction, e } from './editorial';
import { visibleInputScrollOffset } from './focusScroll';
import { OrderPaymentSection } from './OrderPaymentSection';

function itemAmount(item: FormItem) {
  if (!item.price.trim()) return '待填單價';
  try { return money(evaluate({ ...blankInput(item.id), items: [item] }, false).subtotal); }
  catch { return '待完善金額'; }
}

export function OrderEditor({ orderId }: { orderId?: string }) {
  const { store } = useApp(); const router = useRouter(); const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  const expandedFields = width - insets.left - insets.right - 40 < 340 || fontScale > 1.2;
  const isNew = !orderId;
  const [form, setForm] = useState<OrderInput | null>(null);
  const current = useRef<OrderInput | null>(null);
  const request = useRef(''); const sequence = useRef(0); const revision = useRef(0);
  const closed = useRef(false); const alive = useRef(true); const saving = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const scrollOffset = useRef(0);
  const focusedInput = useRef<string | null>(null);
  const visibilityRequest = useRef(0);
  const dragging = useRef(false);
  const keyboardActive = useRef(Keyboard.isVisible());
  const keyboardClosing = useRef(false);
  const frame = useRef<ComponentRef<typeof View>>(null);
  const [keyboardOffset, setKeyboardOffset] = useState(insets.top + 48);
  const inputs = useRef<Record<string, ComponentRef<typeof TextInput> | null>>({});
  const sectionPositions = useRef<Record<string, number>>({});
  const itemPositions = useRef<Record<string, number>>({});
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState(''); const [draftError, setDraftError] = useState('');
  const [draftStatus, setDraftStatus] = useState('正在讀取草稿…');
  const [busy, setBusy] = useState(false); const [retry, setRetry] = useState(0);
  const [keyboardVisible, setKeyboardVisible] = useState(Keyboard.isVisible());
  const ensureFocusedInputVisible = useCallback((allowWithoutKeyboard = false) => {
    if (!alive.current || dragging.current || keyboardClosing.current || (!allowWithoutKeyboard && !keyboardActive.current)) return;
    const key = focusedInput.current;
    const input = key ? inputs.current[key] : null;
    const scroller = scroll.current;
    if (!key || !input || !scroller) return;
    const requestId = ++visibilityRequest.current;
    const measuredOffset = scrollOffset.current;
    scroller.getNativeScrollRef()?.measureInWindow((_x: number, top: number, _width: number, height: number) => {
      input.measureInWindow((_inputX, inputTop, _inputWidth, inputHeight) => {
        // Ignore a measurement completed after focus changed, keyboard dismissal,
        // user scrolling or unmount. Never replay an old focus request.
        if (!alive.current || dragging.current || keyboardClosing.current || focusedInput.current !== key ||
          inputs.current[key] !== input || visibilityRequest.current !== requestId || Math.abs(scrollOffset.current - measuredOffset) > 1) return;
        const y = visibleInputScrollOffset(measuredOffset, { top: inputTop, height: inputHeight }, { top, height });
        if (y !== null) scroller.scrollTo({ y, animated: true });
      });
    });
  }, []);
  const clearTimer = useCallback(() => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } }, []);
  const persist = useCallback(async (value: OrderInput, seq: number) => {
    if (!isNew || closed.current || !request.current) return;
    try {
      const written = await store.saveDraft(request.current, seq, value);
      if (alive.current && seq === sequence.current) { setDraftError(''); setDraftStatus(written ? '草稿已儲存在此 iPhone' : '草稿已關閉'); }
    } catch (cause) { if (alive.current) setDraftError('草稿未能儲存。' + errorMessage(cause)); }
  }, [store, isNew]);
  useEffect(() => {
    alive.current = true; let active = true;
    (async () => {
      if (orderId) {
        const detail = await store.getOrder(orderId);
        if (!editable(detail.order)) throw new DomainError('locked', '此訂單金額及對外資料已鎖定，請返回詳情。');
        if (active) { revision.current = detail.order.revision; current.current = toInput(detail); setForm(current.current); setError(''); }
      } else {
        const draft = await store.openDraft();
        if (active) {
          request.current = draft.requestId; sequence.current = draft.editSeq;
          current.current = draft.input; setForm(draft.input); setDraftStatus('草稿已儲存在此 iPhone'); setError('');
        }
      }
    })().catch((cause: unknown) => { if (active) setError(errorMessage(cause)); });
    return () => { active = false; alive.current = false; };
  }, [store, orderId, retry]);
  useFocusEffect(useCallback(() => () => {
    clearTimer(); if (current.current) void persist(current.current, sequence.current);
  }, [clearTimer, persist]));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') { clearTimer(); if (current.current) void persist(current.current, sequence.current); }
    });
    return () => subscription.remove();
  }, [persist, clearTimer]);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => {
      keyboardActive.current = true; keyboardClosing.current = false; setKeyboardVisible(true);
    });
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => {
      keyboardActive.current = false; keyboardClosing.current = true; visibilityRequest.current += 1; setKeyboardVisible(false);
    });
    const shown = Keyboard.addListener('keyboardDidShow', () => ensureFocusedInputVisible());
    const frameChanged = Platform.OS === 'ios' ? Keyboard.addListener('keyboardDidChangeFrame', () => ensureFocusedInputVisible()) : null;
    return () => { show.remove(); hide.remove(); shown.remove(); frameChanged?.remove(); };
  }, [ensureFocusedInputVisible]);
  function change(value: OrderInput, field?: string) {
    current.current = value; setForm(value); setError('');
    if (field) setFields((old) => { const next = { ...old }; delete next[field]; return next; });
    if (isNew) {
      sequence.current += 1; clearTimer(); setDraftStatus('正在自動儲存…');
      const seq = sequence.current;
      timer.current = setTimeout(() => { void persist(value, seq); }, 350);
    }
  }
  function focusError(key: string) {
    const section = key === 'buyer' ? 'buyer' : key.startsWith('item.') || key === 'items' ? 'items' : key === 'note' ? 'note' : 'shipping';
    const itemId = key.split('.')[1];
    const y = (sectionPositions.current[section] ?? 0) + (section === 'items' ? (itemPositions.current[itemId] ?? 0) + 40 : 0);
    scroll.current?.scrollTo({ y: Math.max(0, y - 16), animated: true });
    inputs.current[key]?.focus();
  }
  function revealInput(key: string) {
    focusedInput.current = key; keyboardClosing.current = false;
    ensureFocusedInputVisible(true);
  }
  function releaseInput(key: string) {
    if (focusedInput.current === key) { focusedInput.current = null; visibilityRequest.current += 1; }
  }
  async function save() {
    if (!current.current || saving.current) return;
    const value = current.current;
    try { evaluate(value); }
    catch (cause) {
      if (cause instanceof DomainError) { setFields(cause.fields); const first = Object.keys(cause.fields)[0]; if (first) focusError(first); }
      setError(errorMessage(cause)); return;
    }
    saving.current = true; closed.current = true; clearTimer(); setBusy(true); setError(''); Keyboard.dismiss();
    try {
      const id = orderId ?? await store.createOrder(request.current, value);
      if (orderId) await store.updateOrder(orderId, revision.current, value);
      router.replace({ pathname: '/order/[id]', params: { id } });
    } catch (cause) {
      closed.current = false; setError(errorMessage(cause));
      void persist(value, sequence.current);
    } finally { saving.current = false; if (alive.current) setBusy(false); }
  }
  function discard() {
    Alert.alert('捨棄這份草稿？', '尚未建立正式訂單，不會消耗或退還任何額度。', [{ text: '保留草稿', style: 'cancel' }, {
      text: '捨棄草稿', style: 'destructive', onPress: () => {
        closed.current = true; clearTimer(); setBusy(true);
        store.discardDraft(request.current).then(() => { if (router.canGoBack()) router.back(); else router.replace('/'); })
          .catch((cause: unknown) => { closed.current = false; setError(errorMessage(cause)); setBusy(false); });
      },
    }]);
  }
  const draftLabel = !isNew ? '編輯中' : draftError ? '未暫存' : draftStatus === '草稿已儲存在此 iPhone' ? '已暫存' : draftStatus === '正在自動儲存…' ? '暫存中' : draftStatus === '草稿已關閉' ? '已關閉' : '讀取中';
  const header = <Stack.Screen options={{ headerRight: () => <Text accessibilityLiveRegion="polite" style={[e.draftBadge, !!draftError && { color: color.error }]}>{draftLabel}</Text> }} />;
  if (!form) return <>{header}{error ? <View style={s.content}><ErrorNotice message={error} retry={() => { setError(''); setRetry((v) => v + 1); }} /><Button title="返回訂單" secondary onPress={() => router.replace('/')} /></View> : <Loading />}</>;
  let total: number | null = null;
  try { total = evaluate(form, false).total; } catch { /* Incomplete or invalid input is shown as a pending total. */ }
  const itemChange = (id: string, key: 'name' | 'price' | 'quantity', value: string) => change({ ...form, items: form.items.map((item) => item.id === id ? { ...item, [key]: value } : item) }, `item.${id}.${key}`);
  function switchShipping(shipping: Shipping) {
    const apply = () => change({ ...form!, shipping, shippingFee: shipping === 'custom' ? form!.shippingFee : '0' }, 'shippingFee');
    if (form!.shipping === 'custom' && shipping !== 'custom' && form!.shippingFee.trim() && !/^0+(?:\.0{1,2})?$/.test(form!.shippingFee.trim())) {
      Alert.alert('清除商家運費？', '這個配送方式不向商家支付運費，原有運費會清零。', [{ text: '保留原設定', style: 'cancel' }, { text: '清零並切換', onPress: apply }]);
    } else apply();
  }
  return <>{header}<View ref={frame} style={s.page} onLayout={() => frame.current?.measureInWindow((_x, y) => { if (alive.current) setKeyboardOffset(y); })}>
    <KeyboardAvoidingView style={[s.page, { paddingLeft: insets.left, paddingRight: insets.right }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    keyboardVerticalOffset={keyboardOffset}>
    <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={e.content}
      automaticallyAdjustKeyboardInsets={false} automaticallyAdjustContentInsets={false} contentInsetAdjustmentBehavior="never"
      scrollEventThrottle={16} onScroll={(event) => { scrollOffset.current = event.nativeEvent.contentOffset.y; }}
      onScrollBeginDrag={() => { dragging.current = true; visibilityRequest.current += 1; }} onScrollEndDrag={() => { dragging.current = false; }}
      onLayout={() => ensureFocusedInputVisible()} onContentSizeChange={() => ensureFocusedInputVisible()}>
      {!!draftError && <ErrorNotice message={draftError} retry={() => { if (current.current) void persist(current.current, sequence.current); }} />}
      {!!error && <ErrorNotice message={error} />}
      <View style={f.section} onLayout={(event) => { sectionPositions.current.buyer = event.nativeEvent.layout.y; }}>
        <SectionHeading title="買家資料" />
        <CompactField ref={(ref) => { inputs.current.buyer = ref; }} accessibilityLabel="買家標識（必填）"
          leading={<Ionicons name="person-outline" size={18} color={color.ink} />} placeholder="IG 用戶名、稱呼或客戶代號"
          autoCapitalize="none" autoCorrect={false} value={form.buyer} editable={!busy} error={fields.buyer}
          onFocus={() => revealInput('buyer')} onBlur={() => releaseInput('buyer')} onChangeText={(value) => change({ ...form, buyer: value }, 'buyer')} />
      </View>
      <View style={f.section} onLayout={(event) => { sectionPositions.current.items = event.nativeEvent.layout.y; }}>
        <SectionHeading title={`商品明細 · ${form.items.length}`} right={<TextAction title="加入商品" icon="add" disabled={busy || form.items.length >= 20}
          onPress={() => change({ ...form, items: [...form.items, { id: randomUUID(), name: '', price: '', quantity: '1' }] }, 'items')} />} />
        {!!fields.items && <Text accessibilityRole="alert" style={e.error}>{fields.items}</Text>}
        <View style={e.surface}>
          {form.items.length === 0 && <View style={[e.inset, { alignItems: 'center', paddingVertical: 20 }]}>
            <Ionicons name="bag-outline" size={26} color={color.muted} /><Text style={e.caption}>尚未加入商品，點按上方「加入商品」。</Text>
          </View>}
          {form.items.map((item, index) => {
            const quantity = /^\d+$/.test(item.quantity.trim()) ? Number(item.quantity) : NaN;
            const validQuantity = Number.isInteger(quantity) && quantity >= 1 && quantity <= 999;
            return <View key={item.id} onLayout={(event) => { itemPositions.current[item.id] = event.nativeEvent.layout.y; }}>
              {index > 0 && <View style={e.divider} />}
              <View style={f.item}>
                <View style={e.row}>
                  <Text style={e.caption}>{index + 1}.</Text>
                  <TextInput ref={(ref) => { inputs.current[`item.${item.id}.name`] = ref; }} accessibilityLabel={`商品 ${index + 1} 名稱`}
                    placeholder="輸入商品名稱" placeholderTextColor={color.muted} selectionColor={color.ink} value={item.name} editable={!busy} multiline submitBehavior="blurAndSubmit"
                    style={f.itemName} onFocus={() => revealInput(`item.${item.id}.name`)} onBlur={() => releaseInput(`item.${item.id}.name`)} onChangeText={(value) => itemChange(item.id, 'name', value)} />
                  <Pressable accessibilityRole="button" accessibilityLabel={`移除商品 ${index + 1}`} accessibilityState={{ disabled: busy }} disabled={busy}
                    onPress={() => change({ ...form, items: form.items.filter((entry) => entry.id !== item.id) }, 'items')}
                    style={({ pressed }) => [e.iconButton, pressed && e.pressed]}><Ionicons name="trash-outline" size={17} color={color.muted} /></Pressable>
                </View>
                {!!fields[`item.${item.id}.name`] && <Text accessibilityRole="alert" style={e.error}>{fields[`item.${item.id}.name`]}</Text>}
                {countChars(item.name) > 100 && <Text style={[e.caption, { textAlign: 'right' }]}>{countChars(item.name)} / 120</Text>}
                <View style={[f.itemValues, expandedFields && { flexWrap: 'wrap' }]}>
                  <View style={{ flex: 1.2, minWidth: 80 }}><CompactField ref={(ref) => { inputs.current[`item.${item.id}.price`] = ref; }}
                    accessibilityLabel={`商品 ${index + 1} 單價（HK$）`} leading={<Text style={f.currency}>HK$</Text>}
                    keyboardType="decimal-pad" placeholder="單價" value={item.price} editable={!busy}
                    style={{ textAlign: 'right', fontVariant: ['tabular-nums'] }} onFocus={() => revealInput(`item.${item.id}.price`)} onBlur={() => releaseInput(`item.${item.id}.price`)} onChangeText={(value) => itemChange(item.id, 'price', value)} /></View>
                  <View style={f.stepper}>
                    <Pressable accessibilityRole="button" accessibilityLabel={`減少商品 ${index + 1} 數量`} disabled={busy || !validQuantity || quantity <= 1}
                      accessibilityState={{ disabled: busy || !validQuantity || quantity <= 1 }}
                      onPress={() => itemChange(item.id, 'quantity', String(quantity - 1))}
                      style={({ pressed }) => [e.iconButton, (pressed || busy || !validQuantity || quantity <= 1) && e.pressed]}><Ionicons name="remove" size={17} color={color.ink} /></Pressable>
                    <TextInput ref={(ref) => { inputs.current[`item.${item.id}.quantity`] = ref; }} accessibilityLabel={`商品 ${index + 1} 數量`}
                      keyboardType="number-pad" selectionColor={color.ink} value={item.quantity} editable={!busy} style={[f.quantity, { width: Math.max(44, Math.ceil(36 * fontScale)) }]}
                      onFocus={() => revealInput(`item.${item.id}.quantity`)} onBlur={() => releaseInput(`item.${item.id}.quantity`)} onChangeText={(value) => itemChange(item.id, 'quantity', value)} />
                    <Pressable accessibilityRole="button" accessibilityLabel={`增加商品 ${index + 1} 數量`} disabled={busy || !validQuantity || quantity >= 999}
                      accessibilityState={{ disabled: busy || !validQuantity || quantity >= 999 }}
                      onPress={() => itemChange(item.id, 'quantity', String(quantity + 1))}
                      style={({ pressed }) => [e.iconButton, (pressed || busy || !validQuantity || quantity >= 999) && e.pressed]}><Ionicons name="add" size={17} color={color.ink} /></Pressable>
                  </View>
                  <View style={[f.lineAmount, expandedFields && { flexBasis: '100%', flexDirection: 'row', justifyContent: 'space-between' }]}>
                    <Text style={f.currency}>行金額</Text><Text style={[e.numeric, { fontWeight: '500' }]}>{itemAmount(item)}</Text>
                  </View>
                </View>
                {['price', 'quantity'].map((key) => fields[`item.${item.id}.${key}`] ? <Text key={key} accessibilityRole="alert" style={e.error}>{fields[`item.${item.id}.${key}`]}</Text> : null)}
              </View>
            </View>;
          })}
        </View>
        {form.items.length >= 20 && <Text style={e.caption}>每張訂單最多 20 項商品。</Text>}
      </View>
      <View style={f.section} onLayout={(event) => { sectionPositions.current.shipping = event.nativeEvent.layout.y; }}>
        <SectionHeading title="配送方式" icon="car-outline" />
        <View style={f.shippingGrid}>{SHIPPING.map((shipping) => <Pressable key={shipping} accessibilityRole="radio"
          accessibilityState={{ checked: form.shipping === shipping, disabled: busy }} disabled={busy} onPress={() => switchShipping(shipping)}
          style={({ pressed }) => [f.shippingOption, form.shipping === shipping && f.shippingSelected, pressed && e.pressed]}>
          <Ionicons name={form.shipping === shipping ? 'checkmark-circle' : shipping === 'pickup' ? 'person-outline' : shipping === 'custom' ? 'create-outline' : 'cube-outline'} size={20} color={color.ink} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}><Text style={f.shippingName}>{shippingText[shipping]}</Text>
            <Text style={f.currency}>{shipping === 'sf_collect' ? '買家另付運費' : shipping === 'custom' ? '設定商家運費' : '商家運費 HK$0'}</Text></View>
        </Pressable>)}</View>
        {form.shipping === 'sf_collect' && <Text style={e.caption}>運費由買家另付順豐；商品貨款仍需先付。</Text>}
        {form.shipping === 'custom' && <CompactField ref={(ref) => { inputs.current.shippingFee = ref; }} label="商家收取運費（HK$）"
          keyboardType="decimal-pad" value={form.shippingFee} editable={!busy} error={fields.shippingFee} style={{ textAlign: 'right', fontVariant: ['tabular-nums'] }}
          onFocus={() => revealInput('shippingFee')} onBlur={() => releaseInput('shippingFee')} onChangeText={(value) => change({ ...form, shippingFee: value }, 'shippingFee')} />}
        <View style={{ marginTop: 8, gap: 8 }}><SectionHeading title="整單固定折扣（選填）" icon="pricetag-outline" />
          <CompactField ref={(ref) => { inputs.current.discount = ref; }} accessibilityLabel="整單固定折扣（HK$，選填）"
            leading={<Text style={e.caption}>HK$</Text>} keyboardType="decimal-pad" placeholder="0.00" value={form.discount} editable={!busy} error={fields.discount}
            style={{ textAlign: 'right', fontVariant: ['tabular-nums'] }} onFocus={() => revealInput('discount')} onBlur={() => releaseInput('discount')} onChangeText={(value) => change({ ...form, discount: value }, 'discount')} />
        </View>
      </View>
      <OrderPaymentSection value={form.payment} disabled={busy} onChange={(payment) => change({ ...form, payment, paymentChosen: true }, 'payment')} />
      <View style={f.section} onLayout={(event) => { sectionPositions.current.note = event.nativeEvent.layout.y; }}>
        <SectionHeading title="訂單備註（選填）" icon="document-text-outline" />
        <CompactField ref={(ref) => { inputs.current.note = ref; }} accessibilityLabel="訂單備註（選填）" value={form.note} editable={!busy} multiline
          error={fields.note} placeholder="例如：顏色、尺寸或交付安排" onFocus={() => revealInput('note')} onBlur={() => releaseInput('note')} onChangeText={(value) => change({ ...form, note: value }, 'note')} />
        {!!form.note && <Text style={[e.caption, { textAlign: 'right' }]}>{countChars(form.note)} / 500</Text>}
      </View>
      <View style={{ gap: 4 }}><Text style={e.caption}>{isNew ? '儲存成功才計入 Free 額度。' : '儲存修改不會建立新單或再扣額度。'}本頁不代表已收款。</Text>
        {isNew && <View style={{ alignSelf: 'center' }}><TextAction title="捨棄草稿" danger disabled={busy} onPress={discard} /></View>}
      </View>
    </ScrollView>
    <View style={[f.footer, { paddingBottom: keyboardVisible ? 6 : Math.max(insets.bottom, 12) }]}>
      {!!fields.total && <Text accessibilityRole="alert" style={e.error}>{fields.total}</Text>}
      <View style={[f.footerRow, !keyboardVisible && expandedFields && { flexDirection: 'column', alignItems: 'stretch' }]}>
        <View style={{ flex: keyboardVisible || !expandedFields ? 1 : undefined, minWidth: 0, gap: 2 }}><Text style={e.caption}>應付總額</Text>
          <Text style={[e.numeric, f.footerTotal, { textAlign: 'left', fontSize: total === null || keyboardVisible ? 16 : 23 }]}>{total === null ? '待填寫有效金額' : money(total)}</Text></View>
        {keyboardVisible ? <TextAction title="完成輸入" onPress={Keyboard.dismiss} /> :
          <View style={{ maxWidth: '100%' }}><ActionButton title={isNew ? '儲存訂單' : '儲存修改'} icon="document-text-outline" busy={busy} onPress={save} /></View>}
      </View>
    </View>
  </KeyboardAvoidingView></View></>;
}

const f = StyleSheet.create({
  section: { gap: 8 },
  item: { paddingHorizontal: 12, paddingTop: 4, paddingBottom: 12, gap: 6 },
  itemName: { flex: 1, minWidth: 0, minHeight: 44, paddingVertical: 10, fontSize: 15, lineHeight: 23, fontWeight: '500', color: color.ink },
  itemValues: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  currency: { fontSize: 12, lineHeight: 18, color: color.muted },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: color.line, borderRadius: 9 },
  quantity: { minHeight: 44, paddingVertical: 8, paddingHorizontal: 0, textAlign: 'center', fontVariant: ['tabular-nums'], fontSize: 15, color: color.ink },
  lineAmount: { flex: 1, minWidth: 72, alignItems: 'flex-end', gap: 2 },
  shippingGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  shippingOption: { flexBasis: '47%', flexGrow: 1, minWidth: 0, minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 9,
    paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: color.line, borderRadius: 11, backgroundColor: color.surface },
  shippingSelected: { borderColor: color.ink, backgroundColor: color.bg },
  shippingName: { fontSize: 14, lineHeight: 21, fontWeight: '500', color: color.ink },
  footer: { paddingTop: 12, paddingHorizontal: 20, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line, backgroundColor: color.surface, gap: 6 },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  footerTotal: { lineHeight: 31, fontWeight: '600' },
});
