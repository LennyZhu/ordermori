import { forwardRef } from 'react';
import type { ComponentRef, ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { TextInputProps } from 'react-native';
import type { Order, Shipping } from '../domain/model';
import { color, tokens } from './theme';

export { color } from './theme';
export const shippingText: Record<Shipping, string> = { included: '包郵', sf_collect: '順豐運費到付', pickup: '面交', custom: '自訂配送' };
export const statusText: Record<string, string> = {
  draft: '草稿', active: '已建立', cancelled: '已取消', unpaid: '未付款', paid: '已付款', refunded: '已退款',
  pending: '待履約', shipped: '已發貨', handed_over: '已交付',
};
export const dateText = (text: string) => new Date(text).toLocaleString('zh-HK', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
export function Button({ title, onPress, disabled = false, busy = false, secondary = false, danger = false }: {
  title: string; onPress: () => void; disabled?: boolean; busy?: boolean; secondary?: boolean; danger?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: disabled || busy, busy }}
    disabled={disabled || busy} onPress={onPress}
    style={({ pressed }) => [s.button, secondary && s.secondary, (disabled || busy || pressed) && { opacity: 0.55 }]}>
    {busy && <ActivityIndicator color={secondary ? color.ink : '#FFFFFF'} />}
    <Text style={[s.buttonText, secondary && { color: danger ? color.error : color.ink }]}>{title}</Text>
  </Pressable>;
}
export const Field = forwardRef<ComponentRef<typeof TextInput>, TextInputProps & { label: string; error?: string }>(function Field({ label, error, style, ...props }, ref) {
  const numeric = props.keyboardType === 'decimal-pad' || props.keyboardType === 'number-pad';
  return <View style={{ gap: 7 }}>
    <Text style={s.label}>{label}</Text>
    <TextInput ref={ref} accessibilityLabel={label} placeholderTextColor={color.muted}
      style={[s.input, numeric && { fontVariant: ['tabular-nums'], textAlign: 'right' }, props.multiline && { minHeight: 100, textAlignVertical: 'top' }, !!error && { borderColor: color.error }, style]} {...props} />
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
  </View>;
});
export function Block({ title, children }: { title: string; children: ReactNode }) {
  return <View style={{ gap: 10 }}><Text style={s.section}>{title}</Text><View style={s.block}>{children}</View></View>;
}
export function ErrorNotice({ message, retry }: { message: string; retry?: () => void }) {
  return <View style={s.notice}><Text accessibilityRole="alert" style={s.error}>{message}</Text>
    {retry && <Button secondary title="重試" onPress={retry} />}</View>;
}
export function Loading() { return <View style={s.loading}><ActivityIndicator size="large" color={color.ink} /><Text style={s.caption}>正在讀取本機資料…</Text></View>; }
export function StatusPills({ order }: { order: Order }) {
  return <View style={s.pills}>{[order.order_status, order.payment_status, order.fulfillment_status].map((state, index) =>
    <View key={index} style={[s.pill, { backgroundColor: state === 'paid' ? '#EAF1ED' : state === 'unpaid' ? '#F5EFDF' : '#EFEEE9' }]}>
      <Text style={[s.pillText, { color: state === 'paid' ? color.green : state === 'unpaid' ? color.amber : state === 'refunded' || state === 'cancelled' ? color.error : color.muted }]}>{statusText[state]}</Text>
    </View>)}</View>;
}
export const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  content: { padding: tokens.page, paddingBottom: 32, gap: tokens.sectionGap },
  title: { fontSize: tokens.title, lineHeight: 38, fontWeight: '600', color: color.ink },
  section: { fontSize: tokens.section, lineHeight: 28, fontWeight: '600', color: color.ink },
  body: { fontSize: tokens.body, lineHeight: 25, color: color.ink, fontVariant: ['tabular-nums'] },
  caption: { fontSize: tokens.caption, lineHeight: 21, color: color.muted },
  label: { fontSize: tokens.label, lineHeight: 22, color: color.ink, fontWeight: '500' },
  error: { fontSize: 14, lineHeight: 21, color: color.error },
  amount: { fontSize: 30, lineHeight: 40, fontWeight: '600', fontVariant: ['tabular-nums'], color: color.ink },
  block: { backgroundColor: color.surface, borderRadius: tokens.radius, padding: tokens.groupPadding, gap: 18 },
  input: { minHeight: tokens.controlHeight, borderWidth: 1, borderColor: '#C9C7BF', borderRadius: tokens.inputRadius, paddingHorizontal: 12, paddingVertical: 12, fontSize: tokens.body, lineHeight: 24, color: color.ink, backgroundColor: color.surface },
  button: { minHeight: tokens.controlHeight, paddingHorizontal: 17, paddingVertical: 13, borderRadius: tokens.controlRadius, backgroundColor: color.ink, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 10 },
  secondary: { backgroundColor: color.surface, borderWidth: 1, borderColor: color.line },
  buttonText: { fontSize: 16, lineHeight: 24, fontWeight: '600', color: '#FFFFFF', textAlign: 'center' },
  notice: { padding: 16, backgroundColor: '#FBEEEA', borderRadius: 12, gap: 12 },
  loading: { flex: 1, minHeight: 180, gap: 16, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: color.bg },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  pill: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 7 },
  pillText: { fontSize: 12, lineHeight: 18, fontWeight: '500' },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: color.line },
});
