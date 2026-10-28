import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useApp } from '../../src/AppProvider';
import { availableActions, editable, errorMessage, money } from '../../src/domain/model';
import type { Action, Order, OrderDetail } from '../../src/domain/model';
import { Button, ErrorNotice, Loading, color, dateText, s, shippingText, statusText } from '../../src/ui/common';
import { ActionButton, AmountRow, CompactField, OrderStates, SectionHeading, TextAction, e } from '../../src/ui/editorial';

function actionTitle(action: Action, order: Order) {
  return { mark_paid: '手動確認已收款', correct_payment: '糾正誤標付款', fulfill: order.shipping_method === 'pickup' ? '登記已交付' : '登記已發貨', refund: '登記整單退款', cancel: '取消訂單' }[action];
}
function actionDescription(action: Action, order: Order) {
  if (action === 'mark_paid') return `請先在收款渠道核對已收到整單 ${money(order.total_cents)}。OrderMori 不會自動核實到帳。確認後金額及對外資料永久鎖定，糾正誤標也不解鎖。`;
  if (action === 'correct_payment') return '僅適用於誤標，請填寫原因。不能用此操作代替真實退款；改回未付款後，金額仍永久鎖定。';
  if (action === 'fulfill') return order.shipping_method === 'pickup' ? '請確認已實際完成面交。登記後不能反向改回待履約。' : '請確認已實際寄出商品。這不代表物流已簽收，登記後不能反向改回待履約。';
  if (action === 'refund') return `請先在 App 外完成整單退款 ${money(order.total_cents)}，再登記結果。本 App 不會發起退款；原金額及已發貨／交付事實會保留。不支援部分退款。`;
  return `取消 ${order.order_number}（${money(order.total_cents)}）後會保留全部紀錄，不能重新啟用，亦不退還建立額度。`;
}

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>(); const router = useRouter();
  const { store, version } = useApp();
  const { fontScale } = useWindowDimensions();
  const [data, setData] = useState<OrderDetail | null>(null);
  const [error, setError] = useState(''); const [retry, setRetry] = useState(0);
  const [pending, setPending] = useState<{ action: Action; order: Order } | null>(null);
  const [reason, setReason] = useState(''); const [operationError, setOperationError] = useState('');
  const [busy, setBusy] = useState(false); const lock = useRef(false);
  useEffect(() => {
    let active = true;
    store.getOrder(id).then((detail) => { if (active) { setData(detail); setError(''); } }).catch((cause: unknown) => { if (active) setError(errorMessage(cause)); });
    return () => { active = false; };
  }, [store, version, id, retry]);
  async function confirm() {
    if (!pending || lock.current) return;
    lock.current = true; setBusy(true); setOperationError('');
    try {
      await store.changeStatus(id, pending.order.revision, pending.action, reason);
      setPending(null); setReason('');
    } catch (cause) { setOperationError(errorMessage(cause)); }
    finally { lock.current = false; setBusy(false); }
  }
  if (!data) return error ? <View style={s.content}><ErrorNotice message={error} retry={() => setRetry((v) => v + 1)} /><Button secondary title="返回訂單" onPress={() => router.replace('/')} /></View> : <Loading />;
  const order = data.order;
  const actions = availableActions(order);
  const primaryAction = actions.find((action) => action === 'mark_paid' || action === 'fulfill');
  const openAction = (action: Action) => { setReason(''); setOperationError(''); setPending({ action, order }); };
  return <SafeAreaView edges={['left', 'right', 'bottom']} style={s.page}>
    <ScrollView contentContainerStyle={e.content}>
      {!!error && <ErrorNotice message={error} retry={() => setRetry((v) => v + 1)} />}
      <View style={{ gap: 12 }}>
        <View style={[e.rowWrap, { justifyContent: 'space-between' }]}><Text style={e.caption}>{order.order_number}</Text><Text style={e.caption}>{dateText(order.created_at)}</Text></View>
        <View style={[d.summary, fontScale > 1.3 && { flexDirection: 'column' }]}>
          <View style={{ flex: fontScale > 1.3 ? undefined : 1, minWidth: 0, gap: 4 }}>
            <Text accessibilityRole="header" style={d.buyer}>{order.buyer_identifier}</Text>
            <Text style={e.caption}>{order.shop_name_snapshot || '建立時未填寫店舖名稱'}</Text>
          </View>
          <View style={{ gap: 2, maxWidth: '100%' }}><Text style={e.caption}>應付總額</Text><Text style={[e.numeric, d.summaryAmount]}>{money(order.total_cents)}</Text></View>
        </View>
        <OrderStates order={order} />
        <View style={[e.rowWrap, { justifyContent: 'space-between' }]}>
          {!!order.financial_locked_at && <View style={[e.row, { flex: 1, alignItems: 'flex-start' }]}><Ionicons name="lock-closed-outline" size={14} color={color.muted} />
            <Text style={[e.caption, { flex: 1 }]}>曾確認付款，金額及對外資料已永久鎖定。</Text></View>}
          {editable(order) && <TextAction title="修改訂單" icon="create-outline" onPress={() => router.push({ pathname: '/order/edit/[id]', params: { id } })} />}
        </View>
      </View>
      <View style={e.surface}>
        <View style={[e.inset, { paddingBottom: 4 }]}><SectionHeading title={`商品明細 · ${data.items.length}`} /></View>
        {data.items.map((item, index) => <View key={item.id}>
          {index > 0 && <View style={[e.divider, { marginHorizontal: 14 }]} />}
          <View style={d.itemRow}><View style={{ flex: 1, minWidth: 0, gap: 3 }}>
            <Text style={e.body}>{item.name_snapshot}</Text><Text style={e.caption}>{money(item.unit_price_cents)} × {item.quantity}</Text>
          </View><Text style={[e.numeric, { maxWidth: '45%' }]}>{money(item.line_total_cents)}</Text></View>
        </View>)}
        <View style={e.divider} />
        <View style={[e.inset, { gap: 8 }]}>
          <AmountRow label="商品小計" value={money(order.subtotal_cents)} />
          <AmountRow label="固定折扣" value={`−${money(order.discount_cents)}`} />
          <AmountRow label="商家運費" value={money(order.shipping_cents)} />
          <View style={[e.divider, { marginVertical: 4 }]} /><AmountRow label="應付總額" value={money(order.total_cents)} total />
        </View>
        <View style={e.divider} />
        <View style={e.inset}><AmountRow label="配送方式" value={shippingText[order.shipping_method]} />
          {order.shipping_method === 'sf_collect' && <Text style={e.caption}>買家另向順豐支付運費，不計入商家應收；商品貨款仍需先付。</Text>}
          {order.payment_status === 'refunded' && <Text style={e.error}>已登記整單退款 {money(order.refunded_amount_cents!)}。原金額與履約紀錄保留。</Text>}
          {!!order.note && <><View style={e.divider} /><Text style={e.fieldLabel}>訂單備註</Text><Text style={e.body}>{order.note}</Text></>}
        </View>
      </View>
      {actions.length > 0 && <View style={{ gap: 10 }}><SectionHeading title="跟進訂單" />
        <Text style={e.caption}>手動登記事實；App 不核實到帳、不寄貨，亦不執行退款。</Text>
        {primaryAction && <ActionButton title={actionTitle(primaryAction, order)} icon={primaryAction === 'mark_paid' ? 'checkmark-circle-outline' : 'cube-outline'} onPress={() => openAction(primaryAction)} />}
        {actions.some((action) => action !== primaryAction) && <View style={e.surface}>
          {actions.filter((action) => action !== primaryAction).map((action, index) => <View key={action}>
            {index > 0 && <View style={[e.divider, { marginHorizontal: 14 }]} />}
            <Pressable accessibilityRole="button" onPress={() => openAction(action)} style={({ pressed }) => [d.actionRow, pressed && e.pressed]}>
              <Ionicons name={action === 'cancel' ? 'close-circle-outline' : 'return-down-back-outline'} size={18} color={action === 'correct_payment' ? color.ink : color.error} />
              <Text style={[e.body, { flex: 1, color: action === 'correct_payment' ? color.ink : color.error }]}>{actionTitle(action, order)}</Text>
              <Ionicons name="chevron-forward" size={15} color={color.muted} />
            </Pressable>
          </View>)}
        </View>}
      </View>}
      <View style={{ gap: 14 }}><SectionHeading title="狀態紀錄" />
        {data.history.map((event, index) => <View key={event.id} style={[e.row, { alignItems: 'stretch' }]}>
          <View style={d.timelineRail}><View style={d.timelineDot} />{index < data.history.length - 1 && <View style={d.timelineLine} />}</View>
          <View style={{ flex: 1, gap: 3, paddingBottom: index < data.history.length - 1 ? 4 : 0 }}>
            <Text style={e.fieldLabel}>{event.axis === 'order' ? '訂單' : event.axis === 'payment' ? '付款' : '履約'}：{statusText[event.from_value] ?? event.from_value} → {statusText[event.to_value] ?? event.to_value}</Text>
            <Text style={e.caption}>{dateText(event.recorded_at)}</Text>{!!event.reason && <Text style={e.body}>{event.reason}</Text>}
          </View>
        </View>)}
      </View>
    </ScrollView>
    <Modal visible={!!pending} presentationStyle="pageSheet" animationType="slide" onRequestClose={() => { if (!busy) setPending(null); }}>
      <SafeAreaView style={s.page}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {pending && <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={e.content}>
            <View style={[e.row, { justifyContent: 'space-between' }]}><Text accessibilityRole="header" style={[e.sectionTitle, { flex: 1 }]}>{actionTitle(pending.action, pending.order)}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="關閉，不更改" disabled={busy} onPress={() => setPending(null)} style={e.iconButton}><Ionicons name="close" size={22} color={color.ink} /></Pressable></View>
            <Text style={e.body}>{actionDescription(pending.action, pending.order)}</Text>
            {(pending.action === 'correct_payment' || pending.action === 'refund' || pending.action === 'cancel') && <CompactField label={pending.action === 'cancel' ? '取消原因（選填）' : '原因／說明（必填）'} multiline value={reason} editable={!busy} onChangeText={setReason} />}
            {!!operationError && <ErrorNotice message={operationError} />}
            <ActionButton title={pending.action === 'mark_paid' ? '已核對，確認已收款' : pending.action === 'refund' ? '已完成外部整單退款，確認登記' : '確認登記'} busy={busy} danger={pending.action === 'cancel' || pending.action === 'refund'}
              disabled={(pending.action === 'correct_payment' || pending.action === 'refund') && !reason.trim()} onPress={confirm} />
            <TextAction title="返回，不更改" disabled={busy} onPress={() => setPending(null)} />
          </ScrollView>}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  </SafeAreaView>;
}

const d = StyleSheet.create({
  summary: { flexDirection: 'row', alignItems: 'flex-start', gap: 16 },
  buyer: { fontSize: 24, lineHeight: 32, fontWeight: '600', color: color.ink },
  summaryAmount: { fontSize: 22, lineHeight: 31, fontWeight: '600' },
  itemRow: { paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  actionRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  timelineRail: { width: 10, alignItems: 'center', paddingTop: 6 },
  timelineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.muted },
  timelineLine: { width: StyleSheet.hairlineWidth, flex: 1, backgroundColor: color.line, marginTop: 5, marginBottom: -14 },
});
