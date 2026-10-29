import { useEffect, useRef, useState } from 'react';
import { Alert, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useApp } from '../../../src/AppProvider';
import { errorMessage } from '../../../src/domain/model';
import { emptyPayment, isPaymentKind, normalizePayment, paymentIssues, paymentName, paymentStatus, paymentStatusText } from '../../../src/domain/payment';
import type { PaymentAsset, PaymentInput, QrState } from '../../../src/domain/payment';
import { chooseOfficialQr } from '../../../src/data/paymentFiles';
import { ErrorNotice, Loading, color, s } from '../../../src/ui/common';
import { ActionButton, CompactField, SectionHeading, TextAction, e } from '../../../src/ui/editorial';
import { PaymentQr } from '../../../src/ui/PaymentQr';
import { usePaymentKeyboard } from '../../../src/ui/usePaymentKeyboard';

export default function PaymentEditScreen() {
  const { kind: param } = useLocalSearchParams<{ kind: string }>(); const router = useRouter(); const { store } = useApp();
  const kind = isPaymentKind(param) ? param : null;
  const [form, setForm] = useState<PaymentInput>(emptyPayment); const [asset, setAsset] = useState<PaymentAsset | null>(null);
  const [qrState, setQrState] = useState<QrState>('none'); const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false); const [error, setError] = useState(''); const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false); const lock = useRef(false); const alive = useRef(true);
  const revision = useRef<number | null>(null); const shopId = useRef(''); const { scroll, frame, insets, keyboardVisible, keyboardOffset, measureFrame, field, scrollProps } = usePaymentKeyboard();
  useEffect(() => {
    alive.current = true; let active = true;
    if (kind) Promise.all([store.getPaymentSettings(), store.getShop()]).then(async ([settings, shop]) => {
      const method = settings.methods.find((entry) => entry.kind === kind);
      const choice = method ? await store.inspectPayment(method) : null;
      if (active) {
        shopId.current = shop.id; revision.current = method?.revision ?? null;
        setForm(method ? normalizePayment(kind, method) : emptyPayment()); setAsset(choice?.asset ?? null); setQrState(choice?.qrState ?? 'none'); setLoaded(true); setError('');
      }
    }).catch((cause: unknown) => { if (active) setError(errorMessage(cause)); });
    return () => { active = false; alive.current = false; };
  }, [store, kind, retry]);
  const back = () => { if (router.canGoBack()) router.back(); else router.replace('/shop/payments'); };
  function askBack() {
    if (busy) return;
    if (!dirty) { back(); return; }
    Alert.alert('離開未儲存的設定？', '原有收款設定及訂單快照不會改變。', [{ text: '繼續編輯', style: 'cancel' }, { text: '捨棄修改', style: 'destructive', onPress: back }]);
  }
  function change(value: Partial<PaymentInput>) { setForm((old) => ({ ...old, ...value, confirmed: false })); setDirty(true); setError(''); }
  async function importQr() {
    if (!kind || kind === 'bank' || lock.current) return;
    lock.current = true; setBusy(true); setError(''); Keyboard.dismiss();
    try {
      const next = await chooseOfficialQr(shopId.current, kind);
      if (!next) return;
      await store.registerPaymentAsset(next);
      if (alive.current) { setAsset(next); setQrState('available'); change({ qrAssetId: next.id }); }
    } catch (cause) { if (alive.current) setError(errorMessage(cause)); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  function choose() {
    Alert.alert('匯入官方收款圖片', '請選擇從官方支付工具取得、屬於本店的原圖。匯入圖片不代表 App 已驗證付款碼。',
      [{ text: '取消', style: 'cancel' }, { text: '選擇官方原圖', onPress: () => { void importQr(); } }]);
  }
  function remove() {
    Alert.alert('移除此設定的收款圖片？', '儲存後會從目前設定移除。既有訂單引用的舊圖片仍會保留。', [{ text: '保留', style: 'cancel' }, {
      text: '移除圖片', style: 'destructive', onPress: () => { setAsset(null); setQrState('none'); change({ qrAssetId: null }); },
    }]);
  }
  async function save() {
    if (!kind || lock.current || !loaded) return;
    lock.current = true; setBusy(true); setError(''); Keyboard.dismiss();
    try { await store.savePaymentMethod(kind, form, revision.current); setDirty(false); back(); }
    catch (cause) { if (alive.current) setError(errorMessage(cause)); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  const header = <Stack.Screen options={{ title: kind ? paymentName[kind] : '收款設定', gestureEnabled: !dirty && !busy,
    headerLeft: () => <Pressable accessibilityRole="button" accessibilityLabel="返回收款方式" disabled={busy} onPress={askBack} style={e.iconButton}><Ionicons name="chevron-back" size={23} color={color.ink} /></Pressable>,
    headerRight: () => dirty ? <Text style={e.draftBadge}>未儲存</Text> : null }} />;
  if (!kind) return <>{header}<View style={e.content}><ErrorNotice message="找不到此收款方式。" /></View></>;
  if (!loaded) return <>{header}{error ? <View style={e.content}><ErrorNotice message={error} retry={() => setRetry((v) => v + 1)} /></View> : <Loading />}</>;
  const status = paymentStatus(kind, form, qrState);
  return <>{header}<View ref={frame} style={s.page} onLayout={measureFrame}>
    <KeyboardAvoidingView style={[s.page, { paddingLeft: insets.left, paddingRight: insets.right }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={keyboardOffset}>
      <ScrollView ref={scroll} {...scrollProps} contentContainerStyle={e.content}>
        <View style={[e.rowWrap, { justifyContent: 'space-between' }]}><Text style={e.caption}>只儲存在這部裝置</Text><Text style={[e.fieldLabel, { color: status === 'ready' ? color.green : color.muted }]}>{paymentStatusText[status]}</Text></View>
        {!!error && <ErrorNotice message={error} />}
        {kind === 'fps' && <View style={{ gap: 12 }}><SectionHeading title="收款標識（選填一種）" />
          <View style={[e.rowWrap, { gap: 6 }]}>{(['id', 'phone', 'email'] as const).map((value) => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: form.fpsType === value, disabled: busy }} disabled={busy}
            onPress={() => { if (value !== form.fpsType) change({ fpsType: value, fpsValue: '' }); }} style={({ pressed }) => [{ paddingHorizontal: 14, paddingVertical: 11, minHeight: 44, borderRadius: 9, backgroundColor: form.fpsType === value ? color.ink : color.surface }, pressed && e.pressed]}>
            <Text style={[e.actionText, { color: form.fpsType === value ? color.surface : color.ink }]}>{value === 'id' ? 'FPS ID' : value === 'phone' ? '電話' : '電郵'}</Text>
          </Pressable>)}</View>
          <CompactField {...field('fpsValue')} label={form.fpsType === 'id' ? 'FPS ID' : form.fpsType === 'phone' ? '已關聯 FPS 的電話' : '已關聯 FPS 的電郵'}
            value={form.fpsValue} editable={!busy} autoCapitalize="none" autoCorrect={false} keyboardType={form.fpsType === 'email' ? 'email-address' : form.fpsType === 'phone' ? 'phone-pad' : 'number-pad'} onChangeText={(value) => change({ fpsValue: value })} />
          <Text style={e.caption}>{form.fpsType === 'id' ? 'FPS ID 為 7 或 9 位數字。' : ''}可填一種 FPS 標識，或只上載官方收款碼。</Text>
        </View>}
        {kind === 'bank' && <View style={{ gap: 14 }}><SectionHeading title="銀行收款資料" />
          <CompactField {...field('bankName')} label="銀行名稱" value={form.bankName} editable={!busy} onChangeText={(value) => change({ bankName: value })} />
          <CompactField {...field('accountName')} label="收款人姓名" value={form.accountName} editable={!busy} autoCorrect={false} onChangeText={(value) => change({ accountName: value })} />
          <CompactField {...field('accountNumber')} label="銀行帳號" value={form.accountNumber} editable={!busy} keyboardType="numbers-and-punctuation" autoCorrect={false} onChangeText={(value) => change({ accountNumber: value })} />
        </View>}
        {kind !== 'bank' && <View style={{ gap: 10 }}><SectionHeading title="官方收款二維碼" icon="image-outline" />
          {asset ? <PaymentQr key={asset.id} asset={asset} state={qrState} onInvalid={() => setQrState('invalid')} /> :
            <View style={[e.surface, e.inset, { alignItems: 'center', paddingVertical: 22 }]}><Ionicons name="image-outline" size={28} color={color.muted} /><Text style={e.caption}>尚未上載官方收款圖片</Text></View>}
          {!!form.qrAssetId && !asset && <Text style={e.error}>圖片記錄缺失，請重新匯入或移除此設定的圖片。</Text>}
          {form.qrAssetId ? <View style={[e.rowWrap, { justifyContent: 'space-between' }]}><TextAction title="替換官方碼" icon="swap-horizontal-outline" disabled={busy} onPress={choose} /><TextAction title="移除圖片" danger disabled={busy} onPress={remove} /></View> :
            <ActionButton title="從照片匯入官方碼" icon="add" secondary disabled={busy} onPress={choose} />}
          {busy && <Text accessibilityLiveRegion="polite" style={e.caption}>正在處理，請稍候…</Text>}
          <Text style={e.caption}>PNG / JPEG · 最多 20 MB、4,000 萬像素 · 不裁剪或壓縮。{kind === 'payme' ? 'PayMe 只採用官方收款碼。' : ''}</Text>
        </View>}
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: form.confirmed, disabled: busy }} disabled={busy}
          onPress={() => { setForm((old) => ({ ...old, confirmed: !old.confirmed })); setDirty(true); }} style={({ pressed }) => [e.row, { alignItems: 'flex-start', minHeight: 44, paddingVertical: 8 }, pressed && e.pressed]}>
          <Ionicons name={form.confirmed ? 'checkbox' : 'square-outline'} size={23} color={color.ink} />
          <Text style={[e.body, { flex: 1 }]}>{kind === 'bank' ? '我已核對銀行、收款人及帳號屬於本店。' : '我已核對官方來源及收款對象；文字與圖片如同時提供，均屬於同一帳戶。'}</Text>
        </Pressable>
        <Text style={e.caption}>{kind !== 'bank' ? '官方碼可能含固定金額，請逐單核對。' : ''}App 不驗證帳戶或真實到帳。</Text>
        {status !== 'ready' && <View style={{ gap: 4 }}>{paymentIssues(kind, form, qrState).map((issue) => <Text key={issue} style={e.caption}>{issue}</Text>)}</View>}
        <Text style={e.caption}>可先儲存未完成設定；資料及商家確認未齊備前，不能設為預設或用於正式付款通知。既有訂單快照不變。</Text>
      </ScrollView>
      <View style={{ paddingHorizontal: 20, paddingTop: 10, paddingBottom: keyboardVisible ? 6 : Math.max(insets.bottom, 12), borderTopWidth: 0.5, borderTopColor: color.line, backgroundColor: color.surface }}>
        {keyboardVisible ? <TextAction title="完成輸入" onPress={Keyboard.dismiss} /> : <ActionButton title={status === 'ready' ? '儲存收款資料' : '儲存未完成設定'} busy={busy} onPress={() => { void save(); }} />}
      </View>
    </KeyboardAvoidingView>
  </View></>;
}
