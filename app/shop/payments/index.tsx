import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useApp } from '../../../src/AppProvider';
import { errorMessage } from '../../../src/domain/model';
import { PAYMENT_KINDS, emptyPayment, paymentIssues, paymentName } from '../../../src/domain/payment';
import type { PaymentKind, PaymentSettings } from '../../../src/domain/payment';
import { ErrorNotice, Loading, color, s } from '../../../src/ui/common';
import { TextAction, e } from '../../../src/ui/editorial';

export default function PaymentsScreen() {
  const { store, version } = useApp(); const router = useRouter();
  const [data, setData] = useState<PaymentSettings | null>(null); const [error, setError] = useState('');
  const [retry, setRetry] = useState(0); const [busy, setBusy] = useState(false); const lock = useRef(false);
  const previous = useRef<PaymentSettings | null>(null); const [notice, setNotice] = useState('');
  useFocusEffect(useCallback(() => { setRetry((value) => value + 1); }, []));
  useEffect(() => {
    let active = true;
    store.getPaymentSettings().then((value) => {
      if (active) {
        if (previous.current) {
          const changed = value.methods.find((method) => previous.current?.methods.find((old) => old.methodId === method.methodId)?.revision !== method.revision);
          if (changed) setNotice(changed.status === 'ready' ? `${paymentName[changed.kind]}資料已儲存。` : `${paymentName[changed.kind]}已儲存，仍未完成設定。`);
        }
        previous.current = value; setData(value); setError('');
      }
    }).catch((cause: unknown) => { if (active) setError(errorMessage(cause)); });
    return () => { active = false; };
  }, [store, version, retry]);
  async function setDefault(id: string | null) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      await store.setDefaultPaymentMethod(id);
      const next = await store.getPaymentSettings(); previous.current = next; setData(next);
      setNotice(id ? '預設收款方式已儲存，只套用到之後新開的草稿。' : '預設收款方式已清除。');
    }
    catch (cause) { const message = errorMessage(cause); setError(message); Alert.alert('未能更新預設收款方式', message); }
    finally { lock.current = false; setBusy(false); }
  }
  function chooseDefault(kind: PaymentKind) {
    if (lock.current) return;
    const method = data?.methods.find((entry) => entry.kind === kind);
    if (!method || method.status !== 'ready') {
      const reasons = paymentIssues(kind, method ?? emptyPayment(), method?.qrState ?? 'none');
      Alert.alert('暫不能設為預設', [...reasons, '未完成設定可以儲存，但不能設為預設或用於正式付款通知。'].join('\n'), [
        { text: '稍後處理', style: 'cancel' },
        { text: '完善資料', onPress: () => router.push({ pathname: '/shop/payments/[kind]', params: { kind } }) },
      ]);
      return;
    }
    if (data?.defaultMethodId === method.methodId) {
      Alert.alert('目前已是預設方式', '此方式只會套用到之後新開的草稿，既有草稿及訂單不變。');
      return;
    }
    void setDefault(method.methodId);
  }
  if (!data && !error) return <Loading />;
  return <SafeAreaView edges={['left', 'right', 'bottom']} style={s.page}><ScrollView contentContainerStyle={e.content}>
    <View style={{ gap: 4 }}><Text style={e.sectionTitle}>讓客人知道如何付款</Text><Text style={e.caption}>每張訂單使用一種收款方式。資料只儲存在此裝置。</Text></View>
    {!!error && <ErrorNotice message={error} retry={() => setRetry((v) => v + 1)} />}
    {!!notice && <Text accessibilityLiveRegion="polite" style={[e.caption, { color: color.green }]}>{notice}</Text>}
    {busy && <Text accessibilityLiveRegion="polite" style={e.caption}>正在儲存預設收款方式…</Text>}
    <View style={e.surface}>{PAYMENT_KINDS.map((kind, index) => {
      const method = data?.methods.find((entry) => entry.kind === kind); const selected = method && data?.defaultMethodId === method.methodId;
      const ready = method?.status === 'ready';
      const status = ready ? '已填妥 · 商家已確認' : method?.status === 'incomplete' ? '資料未完成' : '尚未設定';
      return <View key={kind}>
        {index > 0 && <View style={[e.divider, { marginLeft: 46, marginRight: 14 }]} />}
        <View style={[e.row, { paddingLeft: 14, paddingRight: 4, gap: 2 }]}>
          <Pressable accessibilityRole="button" accessibilityLabel={`編輯${paymentName[kind]}`} disabled={busy} onPress={() => router.push({ pathname: '/shop/payments/[kind]', params: { kind } })}
            style={({ pressed }) => [{ flex: 1, minWidth: 0, minHeight: 72, flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 12 }, (pressed || busy) && e.pressed]}>
            <Ionicons name={kind === 'bank' ? 'business-outline' : 'wallet-outline'} size={20} color={color.ink} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text style={[e.body, { fontWeight: '500' }]}>{paymentName[kind]}</Text>
              <Text style={e.caption}>{status}{selected && !ready ? ' · 預設暫停' : ''}</Text>
            </View>
          </Pressable>
          {ready ? <Pressable accessibilityRole="button" accessibilityLabel={`${paymentName[kind]}：${selected ? '預設' : '設為預設'}`}
            accessibilityHint={selected ? '查看目前預設方式說明' : '只套用到之後新開的草稿'}
            accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => chooseDefault(kind)}
            style={({ pressed }) => [e.textAction, e.iconButton, { maxWidth: 104, gap: 4 }, (pressed || busy) && e.pressed]}>
            {selected && <Ionicons name="checkmark" size={17} color={color.ink} />}
            <Text style={e.actionText}>{selected ? '預設' : '設為預設'}</Text>
          </Pressable> : <Pressable accessibilityRole="button" accessibilityLabel={`查看${paymentName[kind]}未完成原因`}
            accessibilityHint="查看具體原因，並可前往完善資料" accessibilityState={{ disabled: busy }} disabled={busy} onPress={() => chooseDefault(kind)}
            style={({ pressed }) => [e.iconButton, (pressed || busy) && e.pressed]}>
            <Ionicons name="information-circle-outline" size={18} color={color.muted} />
          </Pressable>}
          <Pressable accessibilityRole="button" accessibilityLabel={`開啟${paymentName[kind]}`} disabled={busy} onPress={() => router.push({ pathname: '/shop/payments/[kind]', params: { kind } })}
            style={({ pressed }) => [e.iconButton, (pressed || busy) && e.pressed]}><Ionicons name="chevron-forward" size={16} color={color.muted} /></Pressable>
        </View>
      </View>;
    })}</View>
    <Text style={e.caption}>只套用完整且經商家確認的預設資料到新草稿。預設資料變為未完成或圖片缺失時會暫停套用；既有草稿及訂單不變。</Text>
    {!!data?.defaultMethodId && <TextAction title="清除預設收款方式" disabled={busy} onPress={() => { void setDefault(null); }} />}
    <View style={[e.row, { alignItems: 'flex-start' }]}><Ionicons name="information-circle-outline" size={17} color={color.muted} /><Text style={[e.caption, { flex: 1 }]}>「已填妥」只表示商家已提供並確認資料；App 不驗證官方碼、帳戶或真實到帳。</Text></View>
  </ScrollView></SafeAreaView>;
}
