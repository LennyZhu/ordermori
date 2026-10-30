import { memo } from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import type { LayoutChangeEvent, TextStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { noticeTextBlocks } from '../domain/notice';
import type { NoticeDocument } from '../domain/notice';
import { paymentAssetUri } from '../data/paymentFiles';

export interface PaperObservation {
  layout: (event: LayoutChangeEvent) => void; footer: (event: LayoutChangeEvent) => void;
  text: (id: string) => void; row: (id: string, top: number, height: number) => void;
  imageLoaded: () => void; imageFailed: () => void;
  decorationReady: () => void;
}
export const NoticePaper = memo(function NoticePaper({ document: d, width, observe }: { document: NoticeDocument; width: number; observe: PaperObservation }) {
  const english = d.locale === 'en';
  const r = width / 360; const soft = d.template === 'soft'; const b = noticeTextBlocks(d);
  const ink = soft ? '#49362B' : '#20201F', muted = soft ? '#806F60' : '#686762', line = soft ? '#E5D9CA' : '#DDDBD6';
  const paper = soft ? '#FCF8F1' : '#FFFFFF';
  const gap = (n: number) => n * r;
  function Copy({ id, size = 12, style }: { id: string; size?: number; style?: TextStyle | TextStyle[] }) {
    return <Text allowFontScaling={false} onTextLayout={() => observe.text(id)} style={[{ fontSize: gap(size), lineHeight: gap(size * 1.5), color: ink }, style]}>{b[id]}</Text>;
  }
  const rule = { height: gap(0.55), backgroundColor: line };
  const row = { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: gap(6) };
  const quantity = { width: gap(24), textAlign: 'right' as const, fontVariant: ['tabular-nums'] as const };
  const unit = { width: gap(66), textAlign: 'right' as const, fontVariant: ['tabular-nums'] as const };
  const amount = { width: gap(76), textAlign: 'right' as const, fontVariant: ['tabular-nums'] as const };
  const hasText = !!(b.paymentValue || b.bank); const squareQr = d.qr && d.qr.width / d.qr.height >= 0.8 && d.qr.width / d.qr.height <= 1.25;
  const qrWidth = d.qr ? Math.min(gap(squareQr ? 145 : 280), gap(330) * d.qr.width / d.qr.height) : 0;
  const moneyRow = (label: string, value: string) => <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: gap(12) }}>
    <Copy id={label} style={{ color: muted, flex: 1 }} /><Copy id={value} style={{ fontVariant: ['tabular-nums'], textAlign: 'right', flexShrink: 1 }} />
  </View>;
  return <View collapsable={false} onLayout={observe.layout} style={{ width, padding: gap(20), backgroundColor: paper }}>
    <View style={{ paddingBottom: gap(12), ...(soft ? { minHeight: gap(84), paddingRight: gap(54) } : {}) }}>
      {soft && <View pointerEvents="none" onLayout={({ nativeEvent: { layout } }) => { if (layout.width > 0 && layout.height > 0) observe.decorationReady(); }} style={{ position: 'absolute', right: 0, top: 0 }}>
        <Svg width={gap(48)} height={gap(78)} viewBox="0 0 64 100">
          <Path d="M39 98 C36 76 34 54 29 26 M34 66 C8 62 7 43 10 37 C27 40 33 48 34 66 M31 47 C49 42 56 28 54 18 C37 22 31 33 31 47 M29 29 C12 20 16 7 20 3 C30 10 34 17 29 29 M36 81 C53 75 61 59 57 50 C43 56 38 65 36 81" stroke="#A3917E" strokeWidth="0.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </Svg>
      </View>}
      <View style={{ flexDirection: soft ? 'column' : 'row', alignItems: 'flex-start', gap: gap(12) }}>
        <View style={{ flex: soft ? undefined : 1, minWidth: 0 }}>
          <Copy id="shop" size={soft ? 25 : 24} style={{ fontWeight: soft ? '400' : '600', lineHeight: gap(34), ...(soft && Platform.OS === 'ios' ? { fontFamily: 'Georgia' } : {}) }} />
          {!!b.description && <Copy id="description" size={10.5} style={{ color: muted, marginTop: gap(3) }} />}
        </View>
        {!soft && <View style={{ maxWidth: gap(126), alignItems: 'flex-end', paddingTop: gap(3), gap: gap(3) }}>
          <Copy id="number" size={10} style={{ color: muted, textAlign: 'right' }} /><Copy id="date" size={8.5} style={{ color: muted, textAlign: 'right' }} />
        </View>}
      </View>
    </View>
    <View style={rule} />
    <View style={{ paddingVertical: gap(11), gap: gap(5) }}>
      <Copy id="title" size={11.5} style={{ fontWeight: '500', letterSpacing: gap(0.3), ...(soft && Platform.OS === 'ios' ? { fontFamily: 'Georgia' } : {}) }} />
      {soft && <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: gap(5) }}>
        <Copy id="number" size={10} style={{ color: muted }} /><Copy id="date" size={9} style={{ color: muted }} />
      </View>}
    </View>
    <View style={{ paddingHorizontal: gap(10), paddingVertical: gap(9), backgroundColor: soft ? '#F4EDE3' : '#F8F7F4', borderRadius: gap(5), gap: gap(5), marginBottom: gap(13) }}>
      <View style={row}><Copy id="buyerLabel" size={10.5} style={{ width: gap(50), color: muted }} /><Copy id="buyer" size={11.5} style={{ flex: 1, fontWeight: '500' }} /></View>
      <View style={row}><Copy id="shippingLabel" size={10.5} style={{ width: gap(50), color: muted }} /><Copy id="shipping" size={11.5} style={{ flex: 1 }} /></View>
    </View>
    <View style={[row, { backgroundColor: soft ? '#F7F0E6' : '#F4F3F0', paddingVertical: gap(6) }]}>
      <Copy id="itemLabel" size={11} style={{ flex: 1, minWidth: 0 }} /><Copy id="quantityLabel" size={10.5} style={quantity} /><Copy id="unitLabel" size={10.5} style={unit} /><Copy id="lineLabel" size={10.5} style={amount} />
    </View>
    {d.items.map((item, n) => <View key={item.id} collapsable={false} onLayout={({ nativeEvent: { layout } }) => observe.row(item.id, layout.y, layout.height)}>
      <View style={[row, { paddingVertical: gap(8) }]}>
        <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', gap: gap(4) }}>
          <Copy id={`item-${n}-serial`} size={8} style={{ color: muted, width: gap(13), lineHeight: gap(19) }} />
          <Copy id={`item-${n}-name`} size={12.5} style={{ flex: 1, minWidth: 0, lineHeight: gap(19) }} />
        </View>
        <Copy id={`item-${n}-quantity`} size={11.5} style={[quantity, { lineHeight: gap(19) }]} /><Copy id={`item-${n}-unit`} size={10.5} style={[unit, { lineHeight: gap(19) }]} /><Copy id={`item-${n}-line`} size={11} style={[amount, { lineHeight: gap(19) }]} />
      </View><View style={rule} />
    </View>)}
    <View style={{ gap: gap(4), paddingVertical: gap(11) }}>{moneyRow('subtotalLabel', 'subtotal')}{b.discount && moneyRow('discountLabel', 'discount')}{b.delivery && moneyRow('deliveryLabel', 'delivery')}</View>
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: gap(8), paddingVertical: gap(11), paddingHorizontal: soft ? gap(11) : 0, backgroundColor: soft ? '#EFE3D4' : paper, borderRadius: soft ? gap(8) : 0 }}>
      <Copy id="totalLabel" size={14} style={{ fontWeight: '600' }} /><Copy id="total" size={28} style={{ fontWeight: soft ? '500' : '600', fontVariant: ['tabular-nums'], textAlign: 'right' }} />
    </View>
    <View style={[rule, { marginTop: gap(8), marginBottom: gap(16) }]} />
    <View style={{ gap: gap(8) }}>
      <View style={{ flexDirection: squareQr ? 'row' : 'column', alignItems: squareQr ? 'center' : 'stretch', gap: gap(14) }}>
        <View style={{ flex: squareQr ? 1 : undefined, minWidth: 0, gap: gap(7) }}>
          <Copy id="paymentTitle" size={13.5} style={{ fontWeight: '600' }} />
          {hasText && <View style={{ gap: gap(5) }}>
          {b.paymentValue && <><Copy id="paymentLabel" size={10.5} style={{ color: muted }} /><Copy id="paymentValue" size={13} /></>}
          {b.bank && <>{['bank', 'payee', 'account'].map((key) => <View key={key} style={{ gap: gap(2) }}><Copy id={`${key}Label`} size={10.5} style={{ color: muted }} /><Copy id={key} size={13} /></View>)}</>}
          </View>}
        </View>
        {d.qr && <View style={{ ...(english ? { width: qrWidth + gap(16) + StyleSheet.hairlineWidth * 2 } : {}), alignItems: 'center', padding: gap(8), backgroundColor: '#FFFFFF', borderWidth: StyleSheet.hairlineWidth, borderColor: line, borderRadius: gap(6) }}>
          <Image source={{ uri: paymentAssetUri(d.qr) }} fadeDuration={0} resizeMode="contain" onLoad={observe.imageLoaded} onError={observe.imageFailed}
            style={{ width: qrWidth, height: qrWidth * d.qr.height / d.qr.width }} />
          <Copy id="qrLabel" size={8.5} style={{ color: muted, marginTop: gap(4), textAlign: 'center' }} />
        </View>}
      </View>
      {!!b.qrReminder && <Copy id="qrReminder" size={10} style={{ color: muted }} />}
    </View>
    {!!b.note && <View style={{ marginTop: gap(18), gap: gap(5) }}><Copy id="noteLabel" size={11} style={{ fontWeight: '600' }} /><Copy id="note" /></View>}
    <View collapsable={false} onLayout={observe.footer} style={{ marginTop: gap(15), paddingTop: gap(11), borderTopWidth: gap(0.55), borderTopColor: line, gap: gap(5) }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: gap(10) }}>
        <View style={{ flex: 1, minWidth: 0, gap: gap(3) }}><Copy id="reminder" size={10} style={{ color: muted }} /><Copy id="greeting" size={9} style={{ color: muted }} /></View>
        <Copy id="thanks" size={soft ? 20 : 17} style={{ color: soft ? '#9C7D64' : muted, fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', fontStyle: 'italic', flexShrink: 1 }} />
      </View>
      <Copy id="legal" size={9} style={{ color: muted }} />
      {!!b.brand && <Copy id="brand" size={8} style={{ color: muted, textAlign: 'right', marginTop: gap(4) }} />}
    </View>
  </View>;
});
