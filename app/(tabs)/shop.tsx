import { useEffect, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useApp } from '../../src/AppProvider';
import { FREE_LIMIT, errorMessage } from '../../src/domain/model';
import { ErrorNotice, Loading, color, s } from '../../src/ui/common';
import { ActionButton, CompactField, SectionHeading, e } from '../../src/ui/editorial';
import { t } from '../../src/i18n';

export default function ShopScreen() {
  const { store, version } = useApp();
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [retry, setRetry] = useState(0);
  const lock = useRef(false);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const nameInput = useRef<ComponentRef<typeof TextInput>>(null);
  const descriptionInput = useRef<ComponentRef<typeof TextInput>>(null);
  const reveal = (input: ComponentRef<typeof TextInput> | null) => {
    setTimeout(() => { if (input) scroll.current?.scrollResponderScrollNativeHandleToKeyboard(input, 80, true); }, 100);
  };
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    store.getShop().then((shop) => { if (active) { setLoaded(true); setName(shop.name); setDescription(shop.description); setError(''); } })
      .catch((cause: unknown) => { if (active) setError(errorMessage(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [store, retry]);
  useEffect(() => {
    let active = true;
    store.getHome().then((data) => { if (active) setCount(data.createdCount); }).catch(() => { if (active) setCount(null); });
    return () => { active = false; };
  }, [store, version]);
  async function save() {
    if (lock.current) return; lock.current = true; setBusy(true); setError(''); setSaved(false);
    try { await store.saveShop(name, description); setName(name.trim()); setSaved(true); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { lock.current = false; setBusy(false); }
  }
  if (loading) return <Loading />;
  if (error && !loaded) return <View style={s.content}><ErrorNotice message={error} retry={() => { setLoading(true); setError(''); setRetry((v) => v + 1); }} /></View>;
  return <SafeAreaView edges={['top', 'left', 'right']} style={s.page}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={e.content}>
        <View style={{ gap: 4 }}><Text accessibilityRole="header" style={e.pageTitle}>{t('shop')}</Text>
          <Text style={e.caption}>讓每張訂單，都有你的店舖名字。</Text></View>
        <View style={{ gap: 14 }}>
          <SectionHeading title="店舖資料" icon="storefront-outline" />
          <CompactField ref={nameInput} label="店舖名稱" value={name} editable={!busy} onFocus={() => reveal(nameInput.current)}
            onChangeText={(v) => { setName(v); setSaved(false); }} placeholder="填寫你的店舖名稱" />
          <CompactField ref={descriptionInput} label="店舖簡介（選填）" value={description} editable={!busy} multiline onFocus={() => reveal(descriptionInput.current)}
            onChangeText={(v) => { setDescription(v); setSaved(false); }} placeholder="簡單介紹你的店舖" />
          <Text style={e.caption}>修改資料只影響新訂單，歷史訂單保持原貌。</Text>
          <ActionButton title="儲存店舖資料" busy={busy} onPress={save} />
          {saved && <View style={e.row} accessibilityLiveRegion="polite"><Ionicons name="checkmark-circle-outline" size={17} color={color.green} />
            <Text style={[e.caption, { color: color.green }]}>店舖資料已儲存在此 iPhone。</Text></View>}
        </View>
        {!!error && <ErrorNotice message={error} retry={save} />}
        <View style={{ gap: 8 }}><SectionHeading title="收款資料" />
          <Pressable accessibilityRole="button" accessibilityLabel="管理收款方式及官方二維碼" onPress={() => router.push('/shop/payments')}
            style={({ pressed }) => [e.surface, e.inset, e.row, pressed && e.pressed]}>
            <Ionicons name="wallet-outline" size={21} color={color.ink} /><View style={{ flex: 1, gap: 3 }}><Text style={e.fieldLabel}>收款方式與官方二維碼</Text><Text style={e.caption}>FPS、PayMe 及銀行轉帳</Text></View><Ionicons name="chevron-forward" size={16} color={color.muted} />
          </Pressable>
        </View>
        <View style={[e.surface, e.inset]}>
          <View style={[e.rowWrap, { justifyContent: 'space-between' }]}><Text style={e.sectionTitle}>Free</Text><Text style={e.numeric}>{count ?? '—'} / {FREE_LIMIT} 張</Text></View>
          <View style={e.divider} /><Text style={e.caption}>累計前 {FREE_LIMIT} 張真實訂單免費，取消及退款不退還額度。</Text>
          <Text style={e.caption}>Pro 購買尚未開放。</Text>
        </View>
        <View style={{ gap: 8 }}><View style={e.row}><Ionicons name="lock-closed-outline" size={15} color={color.muted} /><Text style={e.fieldLabel}>本機資料，無需登入</Text></View>
          <Text style={e.caption}>資料只儲存在此裝置，暫未提供備份；刪除 App 將移除本機資料。</Text></View>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
