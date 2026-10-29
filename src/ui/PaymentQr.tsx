import { useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { PaymentAsset, QrState } from '../domain/payment';
import { paymentAssetUri } from '../data/paymentFiles';
import { color, s } from './common';
import { TextAction, e } from './editorial';

export function PaymentQr({ asset, state, onInvalid, compact = false }: { asset: PaymentAsset; state: QrState; onInvalid: () => void; compact?: boolean }) {
  const [preview, setPreview] = useState(false);
  const valid = state === 'available';
  return <View style={{ gap: 8 }}>
    {valid && compact ? <TextAction title="查看已選官方圖片" icon="image-outline" onPress={() => setPreview(true)} /> : valid ? <Pressable accessibilityRole="button" accessibilityLabel="放大檢視上載的官方收款圖片" onPress={() => setPreview(true)}
      style={[e.surface, { padding: 12, borderWidth: 1, borderColor: color.line, alignItems: 'center' }]}>
      <Image source={{ uri: paymentAssetUri(asset) }} resizeMode="contain" style={{ width: '100%', height: 220 }} onError={onInvalid} />
      <Text style={e.caption}>點按放大 · 保留原圖比例</Text>
    </Pressable> : <View style={[e.surface, e.inset, e.row]}><Ionicons name="alert-circle-outline" size={20} color={color.error} />
      <Text style={[e.error, { flex: 1 }]}>{state === 'missing' ? '找不到原收款圖片，請重新匯入。' : '圖片未能完整讀取，請重新匯入。'}</Text></View>}
    <Modal visible={preview && valid} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setPreview(false)}>
      {/* A native Modal has a separate view hierarchy from the app's provider. */}
      <SafeAreaProvider style={s.page}>
        <PaymentQrPreview asset={asset} onClose={() => setPreview(false)} onInvalid={onInvalid} />
      </SafeAreaProvider>
    </Modal>
  </View>;
}

function PaymentQrPreview({ asset, onClose, onInvalid }: { asset: PaymentAsset; onClose: () => void; onInvalid: () => void }) {
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  return <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={s.page} accessibilityViewIsModal onAccessibilityEscape={onClose}>
    <View style={[e.row, previewStyle.navigation]}>
      <Text accessibilityRole="header" numberOfLines={2} style={[e.sectionTitle, previewStyle.title]}>官方收款圖片</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="關閉官方收款圖片預覽" onPress={onClose}
        style={({ pressed }) => [e.textAction, previewStyle.close, pressed && e.pressed]}>
        <Ionicons name="close" size={21} color={color.ink} /><Text style={e.actionText}>關閉</Text>
      </Pressable>
    </View>
    <View style={previewStyle.imageArea} onLayout={({ nativeEvent: { layout } }) => setViewport({ width: layout.width, height: layout.height })}>
      <ScrollView style={previewStyle.scroll} minimumZoomScale={1} maximumZoomScale={4} centerContent
        automaticallyAdjustContentInsets={false} contentInsetAdjustmentBehavior="never" contentContainerStyle={previewStyle.imageContent}>
        {viewport.width > 0 && viewport.height > 0 && <Image source={{ uri: paymentAssetUri(asset) }} resizeMode="contain"
          style={{ width: viewport.width, height: viewport.height }} onError={onInvalid} />}
      </ScrollView>
    </View>
    <Text style={[e.caption, previewStyle.footer]}>請核對收款對象與留白。本 App 不驗證付款碼或實際到帳。</Text>
  </SafeAreaView>;
}

const previewStyle = StyleSheet.create({
  navigation: { flexShrink: 0, minHeight: 52, paddingHorizontal: 16, paddingVertical: 4 },
  title: { flex: 1, minWidth: 0 },
  close: { minWidth: 44, minHeight: 44, flexShrink: 0, paddingHorizontal: 8 },
  imageArea: { flex: 1, minHeight: 0, marginHorizontal: 20, marginVertical: 12 },
  scroll: { flex: 1 },
  imageContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  footer: { flexShrink: 0, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16 },
});
