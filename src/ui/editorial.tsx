import { forwardRef, useState } from 'react';
import type { ComponentProps, ComponentRef, ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import type { TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import type { NativeStackHeaderProps } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { Order } from '../domain/model';
import { statusText } from './common';
import { color, tokens } from './theme';

type IconName = ComponentProps<typeof Ionicons>['name'];
export function TaskHeader({ options, navigation, back }: NativeStackHeaderProps) {
  const router = useRouter();
  const { fontScale } = useWindowDimensions();
  const right = options.headerRight?.({ tintColor: color.ink, canGoBack: !!back, backgroundColor: color.bg });
  const expanded = fontScale > 1.5;
  return <SafeAreaView edges={['top', 'left', 'right']} style={{ backgroundColor: color.bg }}>
    <View style={[e.navigation, { minHeight: Math.max(48, Math.ceil(24 * fontScale + 4)) }]}>
      <View style={[e.navigationSide, expanded && { width: 44 }]}><Pressable accessibilityRole="button" accessibilityLabel="返回"
        onPress={() => { if (navigation.canGoBack()) navigation.goBack(); else router.replace('/'); }}
        style={({ pressed }) => [e.iconButton, pressed && e.pressed]}>
        <Ionicons name="chevron-back" size={23} color={color.ink} />
      </Pressable></View>
      <Text accessibilityRole="header" style={e.navigationTitle}>{options.title ?? '訂單'}</Text>
      <View style={[e.navigationSide, { alignItems: 'flex-end' }, expanded && { width: 44 }]}>
        {!expanded && right}
      </View>
    </View>
    {expanded && !!right && <View style={{ alignItems: 'flex-end', paddingHorizontal: 20, paddingBottom: 8 }}>{right}</View>}
  </SafeAreaView>;
}

export function SectionHeading({ title, icon, right }: { title: string; icon?: IconName; right?: ReactNode }) {
  return <View style={e.sectionHeading}>
    {icon && <Ionicons name={icon} size={17} color={color.ink} />}
    <Text accessibilityRole="header" style={[e.sectionTitle, { flex: 1 }]}>{title}</Text>{right}
  </View>;
}

export function TextAction({ title, icon, onPress, disabled = false, danger = false }: {
  title: string; icon?: IconName; onPress: () => void; disabled?: boolean; danger?: boolean;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled }} disabled={disabled}
    onPress={onPress} style={({ pressed }) => [e.textAction, (pressed || disabled) && e.pressed]}>
    {icon && <Ionicons name={icon} size={17} color={danger ? color.error : color.ink} />}
    <Text style={[e.actionText, danger && { color: color.error }]}>{title}</Text>
  </Pressable>;
}

export function ActionButton({ title, onPress, disabled = false, busy = false, secondary = false, danger = false, icon }: {
  title: string; onPress: () => void; disabled?: boolean; busy?: boolean; secondary?: boolean; danger?: boolean; icon?: IconName;
}) {
  const foreground = secondary ? (danger ? color.error : color.ink) : color.surface;
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: disabled || busy, busy }}
    disabled={disabled || busy} onPress={onPress} style={({ pressed }) => [e.button, secondary && e.secondaryButton,
      danger && !secondary && { backgroundColor: color.error }, (pressed || disabled || busy) && e.pressed]}>
    {busy ? <ActivityIndicator color={foreground} /> : icon && <Ionicons name={icon} size={18} color={foreground} />}
    <Text style={[e.buttonText, { color: foreground }]}>{title}</Text>
  </Pressable>;
}

export const CompactField = forwardRef<ComponentRef<typeof TextInput>, TextInputProps & {
  label?: string; error?: string; leading?: ReactNode; trailing?: ReactNode;
}>(function CompactField({ label, error, leading, trailing, style, onFocus, onBlur, ...props }, ref) {
  const [focused, setFocused] = useState(false);
  return <View style={{ gap: 6 }}>
    {label && <Text style={e.fieldLabel}>{label}</Text>}
    <View style={[e.inputShell, focused && { borderColor: color.ink }, !!error && { borderColor: color.error }]}>
      {leading}
      <TextInput ref={ref} accessibilityLabel={props.accessibilityLabel ?? label} placeholderTextColor={color.muted}
        selectionColor={color.ink} onFocus={(event) => { setFocused(true); onFocus?.(event); }}
        onBlur={(event) => { setFocused(false); onBlur?.(event); }}
        style={[e.input, props.multiline && e.multiline, style]} {...props} />
      {trailing}
    </View>
    {!!error && <Text accessibilityRole="alert" style={e.error}>{error}</Text>}
  </View>;
});

export function AmountRow({ label, value, total = false }: { label: string; value: string; total?: boolean }) {
  return <View style={e.amountRow}><Text style={[e.caption, total && e.totalLabel]}>{label}</Text>
    <Text style={[e.numeric, total && e.totalValue]}>{value}</Text></View>;
}

export function OrderStates({ order }: { order: Order }) {
  return <View style={e.states}>{[order.order_status, order.payment_status, order.fulfillment_status].map((state, index) =>
    <View key={index} accessibilityLabel={`${['訂單', '付款', '履約'][index]}：${statusText[state]}`}
      style={[e.state, { backgroundColor: state === 'paid' ? '#EAF1ED' : state === 'unpaid' ? '#F5EFDF' : color.mutedSurface }]}>
      <Text style={[e.stateText, { color: state === 'paid' ? color.green : state === 'unpaid' ? color.amber : state === 'refunded' || state === 'cancelled' ? color.error : color.muted }]}>{statusText[state]}</Text>
    </View>)}</View>;
}

export const e = StyleSheet.create({
  content: { paddingHorizontal: tokens.page, paddingTop: 12, paddingBottom: 28, gap: 20 },
  surface: { backgroundColor: color.surface, borderRadius: 14 },
  inset: { padding: 14, gap: 12 },
  pageTitle: { fontSize: 26, lineHeight: 34, fontWeight: '600', color: color.ink },
  sectionTitle: { fontSize: 16, lineHeight: 23, fontWeight: '600', color: color.ink },
  body: { fontSize: 15, lineHeight: 23, color: color.ink },
  caption: { fontSize: 13, lineHeight: 20, color: color.muted },
  fieldLabel: { fontSize: 13, lineHeight: 20, fontWeight: '500', color: color.ink },
  error: { fontSize: 13, lineHeight: 20, color: color.error },
  numeric: { fontSize: 15, lineHeight: 23, color: color.ink, fontVariant: ['tabular-nums'], textAlign: 'right', flexShrink: 1 },
  totalLabel: { fontSize: 15, color: color.ink, fontWeight: '600' },
  totalValue: { fontSize: 21, lineHeight: 29, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowWrap: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 28 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: color.line },
  amountRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 12, rowGap: 4 },
  textAction: { minHeight: tokens.touch, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 4, maxWidth: '100%' },
  actionText: { fontSize: 14, lineHeight: 21, fontWeight: '500', color: color.ink, flexShrink: 1 },
  button: { minHeight: tokens.controlHeight, backgroundColor: color.ink, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
  secondaryButton: { backgroundColor: color.surface, borderWidth: 1, borderColor: color.line },
  buttonText: { fontSize: 15, lineHeight: 23, fontWeight: '600', flexShrink: 1, textAlign: 'center' },
  pressed: { opacity: 0.5 },
  inputShell: { flexDirection: 'row', alignItems: 'center', backgroundColor: color.surface, borderWidth: 1, borderColor: color.line,
    borderRadius: 10, paddingHorizontal: 12, gap: 8 },
  input: { minHeight: tokens.touch, flex: 1, minWidth: 0, paddingVertical: 10, paddingHorizontal: 0, fontSize: 15, lineHeight: 23, color: color.ink },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  iconButton: { minHeight: tokens.touch, minWidth: tokens.touch, justifyContent: 'center', alignItems: 'center' },
  navigation: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 2, gap: 8 },
  navigationSide: { width: 68, justifyContent: 'center' },
  navigationTitle: { flex: 1, fontSize: 17, lineHeight: 24, fontWeight: '600', color: color.ink, textAlign: 'center' },
  draftBadge: { fontSize: 12, lineHeight: 18, color: color.muted, backgroundColor: color.mutedSurface, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  states: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  state: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  stateText: { fontSize: 12, lineHeight: 17, fontWeight: '500' },
});
