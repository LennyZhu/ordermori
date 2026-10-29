import { tr, trMessage } from "../i18n";
import { useLanguage } from "../i18n/react";
import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useApp } from '../AppProvider';
import { errorMessage } from '../domain/model';
import { paymentName, paymentStatusText, paymentSummary, snapshotOf } from '../domain/payment';
import type { PaymentChoice, PaymentSettings, PaymentSnapshot } from '../domain/payment';
import { ErrorNotice, color, s } from './common';
import { SectionHeading, TextAction, e } from './editorial';
import { PaymentQr } from './PaymentQr';

export function OrderPaymentSection({ value, onChange, readOnly = false, disabled = false }: {
  value: PaymentSnapshot | null | undefined; onChange?: (value: PaymentSnapshot | null) => void; readOnly?: boolean; disabled?: boolean;
}) {
  useLanguage();
  const { store } = useApp(); const router = useRouter();
  const [settings, setSettings] = useState<PaymentSettings | null>(null); const [choice, setChoice] = useState<PaymentChoice | null>(null);
  const [open, setOpen] = useState(false); const [error, setError] = useState(''); const [retry, setRetry] = useState(0);
  useFocusEffect(useCallback(() => { setRetry((next) => next + 1); }, []));
  useEffect(() => {
    let active = true;
    Promise.all([readOnly ? Promise.resolve(null) : store.getPaymentSettings(), value ? store.inspectPayment(value) : Promise.resolve(null)])
      .then(([next, selected]) => { if (active) { setSettings(next); setChoice(selected); setError(''); } })
      .catch((cause: unknown) => { if (active) setError(errorMessage(cause)); });
    return () => { active = false; };
  }, [store, value, readOnly, retry]);
  const summaryText = value ? paymentSummary(value) : '';
  const hasPaymentText = value && (value.kind === 'bank' ? !!(value.bankName || value.accountName || value.accountNumber) : value.kind === 'fps' && !!value.fpsValue);
  const currentChoice = value && choice?.snapshot.methodId === value.methodId && choice.snapshot.revision === value.revision && choice.snapshot.qrAssetId === value.qrAssetId ? choice : null;
  return <View style={{ gap: 8 }}><SectionHeading title={readOnly ? tr("收款資料快照") : tr("本次收款方式")} icon="wallet-outline" />
    {!!error && <ErrorNotice message={trMessage(error)} retry={() => setRetry((v) => v + 1)} />}
    {readOnly ? <View style={[e.surface, e.inset]}>
      <Text style={e.fieldLabel}>{value ? tr(paymentName[value.kind]) : tr("未指定收款方式")}</Text>
      {value && <><Text style={e.body}>{hasPaymentText ? summaryText : tr(summaryText)}</Text><Text style={e.caption}>{tr`保留儲存當時的資料；店舖設定不會回寫此訂單。`}</Text></>}
    </View> : <Pressable accessibilityRole="button" accessibilityLabel={tr("選擇本次單一收款方式")} disabled={disabled} onPress={() => setOpen(true)}
      style={({ pressed }) => [e.surface, e.inset, e.row, (pressed || disabled) && e.pressed]}>
      <View style={{ flex: 1, gap: 3 }}><Text style={e.fieldLabel}>{value ? tr(paymentName[value.kind]) : tr("暫不指定")}</Text>
        <Text style={e.caption}>{value ? tr`${currentChoice ? tr(paymentStatusText[currentChoice.status]) : tr("正在檢查")} · 保留已選資料` : tr("仍可儲存真實訂單，之後按權限補選。")}</Text></View>
      <Ionicons name="chevron-down" size={17} color={color.muted} />
    </Pressable>}
    {value && currentChoice?.asset && <PaymentQr key={currentChoice.asset.id} asset={currentChoice.asset} state={currentChoice.qrState} compact onInvalid={() => setChoice((old) => old && old.asset?.id === currentChoice.asset?.id ? { ...old, qrState: 'invalid', status: 'incomplete' } : old)} />}
    {value?.qrAssetId && currentChoice && !currentChoice.asset && <Text style={e.error}>{tr`找不到當時圖片，不會自動換成店舖最新圖片。`}</Text>}
    {!readOnly && value && currentChoice && currentChoice.status !== 'ready' && <Text style={e.caption}>{tr`收款資料未完成或圖片缺失，不影響普通訂單儲存；不代表可正式發出付款通知。`}</Text>}
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
      <SafeAreaView style={s.page}><ScrollView contentContainerStyle={e.content}>
        <View style={[e.row, { justifyContent: 'space-between' }]}><Text style={e.sectionTitle}>{tr`選擇收款方式`}</Text><TextAction title={tr("關閉")} icon="close" onPress={() => setOpen(false)} /></View>
        <Text style={e.caption}>{tr`本單最多選擇一種方式。選擇會保存當時的資料，不會自動追隨店舖更新。`}</Text>
        <View style={e.surface}>
          <Pressable accessibilityRole="radio" accessibilityState={{ checked: !value }} onPress={() => { onChange?.(null); setOpen(false); }} style={[e.inset, e.row]}>
            <Text style={[e.body, { flex: 1 }]}>{tr`暫不指定`}</Text><Ionicons name={!value ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={color.ink} />
          </Pressable>
          {settings?.methods.map((method) => <View key={method.methodId}><View style={[e.divider, { marginHorizontal: 14 }]} />
            <Pressable accessibilityRole="radio" accessibilityState={{ checked: value?.methodId === method.methodId && value.revision === method.revision }}
              onPress={() => { onChange?.(snapshotOf(method)); setOpen(false); }} style={({ pressed }) => [e.inset, e.row, pressed && e.pressed]}>
              <View style={{ flex: 1, minWidth: 0, gap: 3 }}><Text style={e.fieldLabel}>{tr(paymentName[method.kind])}{settings.defaultMethodId === method.methodId ? tr(" · 店舖預設") : ''}</Text>
                <Text style={e.caption}>{tr(paymentStatusText[method.status])}{value?.methodId === method.methodId && value.revision !== method.revision ? tr(" · 點選將明確套用最新資料") : ''}</Text></View>
              <Ionicons name={value?.methodId === method.methodId && value.revision === method.revision ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={color.ink} />
            </Pressable>
          </View>)}
        </View>
        {settings?.methods.length === 0 && <Text style={e.caption}>{tr`尚未儲存收款設定。你可以先建立訂單，或到店舖補齊資料。`}</Text>}
        <TextAction title={tr("管理店舖收款資料")} icon="create-outline" onPress={() => { setOpen(false); router.push('/shop/payments'); }} />
      </ScrollView></SafeAreaView>
    </Modal>
  </View>;
}
