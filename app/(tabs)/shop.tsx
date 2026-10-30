import { t, tr, trMessage } from "../../src/i18n";
import { useLanguage } from "../../src/i18n/react";
import { useEffect, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { usePro } from '../../src/ui/usePro';
import { useApp } from '../../src/AppProvider';
import { FREE_LIMIT, errorMessage } from '../../src/domain/model';
import { QUOTA_CLOCK_ERROR } from '../../src/domain/quota';
import { ErrorNotice, Loading, color, s } from '../../src/ui/common';
import { ActionButton, CompactField, SectionHeading, e } from '../../src/ui/editorial';

export default function ShopScreen() {
  const { preference } = useLanguage();
  const pro = usePro();
  const { store, version } = useApp();
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState<number | null>(null);
  const [clockRollback, setClockRollback] = useState(false);
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
    store.getQuota().then((quota) => { if (active) { setCount(quota.used); setClockRollback(quota.clockRollback); } }).catch(() => { if (active) setCount(null); });
    return () => { active = false; };
  }, [store, version]);
  async function save() {
    if (lock.current) return; lock.current = true; setBusy(true); setError(''); setSaved(false);
    try { await store.saveShop(name, description); setName(name.trim()); setSaved(true); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { lock.current = false; setBusy(false); }
  }
  if (loading) return <Loading />;
  if (error && !loaded) return <View style={s.content}><ErrorNotice message={trMessage(error)} retry={() => { setLoading(true); setError(''); setRetry((v) => v + 1); }} /></View>;
  return <SafeAreaView edges={['top', 'left', 'right']} style={s.page}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={e.content}>
        <View style={{ gap: 4 }}><Text accessibilityRole="header" style={e.pageTitle}>{t('shop')}</Text>
          <Text style={e.caption}>{tr`讓每張訂單，都有你的店舖名字。`}</Text></View>
        <View style={{ gap: 14 }}>
          <SectionHeading title={tr("店舖資料")} icon="storefront-outline" />
          <CompactField ref={nameInput} label={tr("店舖名稱")} value={name} editable={!busy} onFocus={() => reveal(nameInput.current)}
            onChangeText={(v) => { setName(v); setSaved(false); }} placeholder={tr("填寫你的店舖名稱")} />
          <CompactField ref={descriptionInput} label={tr("店舖簡介（選填）")} value={description} editable={!busy} multiline onFocus={() => reveal(descriptionInput.current)}
            onChangeText={(v) => { setDescription(v); setSaved(false); }} placeholder={tr("簡單介紹你的店舖")} />
          <Text style={e.caption}>{tr`修改資料只影響新訂單，歷史訂單保持原貌。`}</Text>
          <ActionButton title={tr("儲存店舖資料")} busy={busy} onPress={save} />
          {saved && <View style={e.row} accessibilityLiveRegion="polite"><Ionicons name="checkmark-circle-outline" size={17} color={color.green} />
            <Text style={[e.caption, { color: color.green }]}>{tr`店舖資料已儲存在此 iPhone。`}</Text></View>}
        </View>
        {!!error && <ErrorNotice message={trMessage(error)} retry={save} />}
        <View style={{ gap: 8 }}><SectionHeading title={tr("收款資料")} />
          <Pressable accessibilityRole="button" accessibilityLabel={tr("管理收款方式及官方二維碼")} onPress={() => router.push('/shop/payments')}
            style={({ pressed }) => [e.surface, e.inset, e.row, pressed && e.pressed]}>
            <Ionicons name="wallet-outline" size={21} color={color.ink} /><View style={{ flex: 1, gap: 3 }}><Text style={e.fieldLabel}>{tr`收款方式與官方二維碼`}</Text><Text style={e.caption}>{tr`FPS、PayMe 及銀行轉帳`}</Text></View><Ionicons name="chevron-forward" size={16} color={color.muted} />
          </Pressable>
        </View>
        <View style={{ gap: 8 }}><SectionHeading title={tr("常用商品")} />
          <Pressable accessibilityRole="button" accessibilityLabel={tr("管理常用商品名稱與預設單價")} onPress={() => router.push('/shop/products')} style={({ pressed }) => [e.surface, e.inset, e.row, pressed && e.pressed]}>
            <Ionicons name="star-outline" size={21} color={color.ink} /><View style={{ flex: 1, gap: 3 }}><Text style={e.fieldLabel}>{tr`常用商品庫`}</Text><Text style={e.caption}>{tr`儲存名稱及單價，下次開單直接選用`}</Text></View><Ionicons name="chevron-forward" size={16} color={color.muted} />
          </Pressable>
        </View>
        <View style={{ gap: 8 }}><SectionHeading title={tr("資料與備份")} />
          <Pressable accessibilityRole="button" onPress={() => router.push('/shop/backup')} style={({ pressed }) => [e.surface, e.inset, e.row, pressed && e.pressed]}>
            <Ionicons name="archive-outline" size={21} color={color.ink} /><View style={{ flex: 1, gap: 3 }}><Text style={e.fieldLabel}>{tr`備份與還原`}</Text><Text style={e.caption}>{tr`完整本機備份，安全取代還原`}</Text></View><Ionicons name="chevron-forward" size={16} color={color.muted} />
          </Pressable>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={tr('語言 / Language')} onPress={() => router.push('/shop/language')} style={({ pressed }) => [e.surface, e.inset, e.row, pressed && e.pressed]}>
          <Ionicons name="language-outline" size={21} color={color.ink}/><View style={{ flex:1, minWidth:0, gap:3 }}><Text style={e.fieldLabel}>{tr('語言 / Language')}</Text><Text style={e.caption}>{preference === 'system' ? tr('跟隨系統') : preference === 'en' ? 'English' : '繁體中文（香港）'}</Text></View><Ionicons name="chevron-forward" size={16} color={color.muted}/>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => router.push('/shop/pro')} style={({ pressed }) => [e.surface, e.inset, e.row, pressed && e.pressed]}>
          <Ionicons name="sparkles-outline" size={21} color={color.ink} /><View style={{ flex: 1, minWidth: 0, gap: 3 }}><Text style={e.fieldLabel}>OrderMori Pro</Text><Text style={e.caption}>{pro.hasPro ? tr('已解鎖 · 無限訂單') : tr('一次購買，永久解鎖')}</Text></View><Ionicons name="chevron-forward" size={16} color={color.muted} />
        </Pressable>
        {!pro.hasPro && <View style={[e.surface, e.inset]}>
          <View style={[e.rowWrap, { justifyContent: 'space-between' }]}><Text style={e.sectionTitle}>Free</Text><Text style={e.numeric}>{tr`本月已建立 ${count ?? '—'} / ${FREE_LIMIT} 張訂單`}</Text></View>
          <View style={e.divider} /><Text style={e.caption}>{tr`每月可免費建立 15 張正式訂單，取消、刪除及退款不退還當月額度。`}</Text>
          <Text style={e.caption}>{tr`每月 1 日重新計算，未用額度不累積。草稿及歷史訂單仍可使用。`}</Text>
          <Pressable accessibilityRole="button" onPress={() => router.push('/shop/pro')} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={e.fieldLabel}>{tr('了解 OrderMori Pro')}</Text></Pressable>
          {clockRollback && <Text style={e.caption}>{trMessage(QUOTA_CLOCK_ERROR)}</Text>}
        </View>}
        <View style={{ gap: 8 }}><View style={e.row}><Ionicons name="lock-closed-outline" size={15} color={color.muted} /><Text style={e.fieldLabel}>{tr`本機資料，無需登入`}</Text></View>
          <Text style={e.caption}>{tr`資料只儲存在此裝置，請自行保管備份；刪除 App 將移除本機資料。`}</Text></View>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
