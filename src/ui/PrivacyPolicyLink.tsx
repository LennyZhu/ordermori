import { useRef, useState } from 'react';
import { Alert, Linking, Pressable, Text, View } from 'react-native';
import Constants from 'expo-constants';
import Ionicons from '@expo/vector-icons/Ionicons';
import { tr } from '../i18n';
import { useLanguage } from '../i18n/react';
import { e } from './editorial';
import { color } from './theme';
import { legalPageUrl } from './legalLinks';
import type { LegalPage } from './legalLinks';

export function PrivacyPolicyLink() {
  return <LegalPageLink page="privacy" />;
}

export function SupportLink() {
  return <LegalPageLink page="support" />;
}

function LegalPageLink({ page }: { page: LegalPage }) {
  const { locale } = useLanguage();
  const url = legalPageUrl(Constants.expoConfig?.extra?.legal, page, locale);
  const title = page === 'privacy' ? tr('私隱政策') : tr('技術支援');
  const [opening, setOpening] = useState(false);
  const lock = useRef(false);
  async function open() {
    if (!url || lock.current) return;
    lock.current = true; setOpening(true);
    try { await Linking.openURL(url); }
    catch { Alert.alert(page === 'privacy' ? tr('未能開啟私隱政策') : tr('未能開啟技術支援'), tr('請檢查網絡後重試。')); }
    finally { lock.current = false; setOpening(false); }
  }
  return <Pressable accessibilityRole="link" accessibilityLabel={title} accessibilityState={{ disabled: !url || opening, busy: opening }}
    disabled={!url || opening} onPress={() => { void open(); }} style={({ pressed }) => [e.surface, e.inset, e.row, { minHeight: 44 }, pressed && e.pressed]}>
    <Ionicons name={page === 'privacy' ? 'document-text-outline' : 'help-circle-outline'} size={21} color={color.ink} />
    <View style={{ flex: 1, minWidth: 0, gap: 3 }}><Text style={e.fieldLabel}>{title}</Text>
      <Text style={e.caption}>{!url ? tr('網址待提供') : opening ? tr('正在開啟…') : page === 'privacy' ? tr('了解資料儲存、使用及私隱選擇') : tr('使用說明、常見問題及聯絡開發者')}</Text></View>
    {url && <Ionicons name="open-outline" size={17} color={color.muted} />}
  </Pressable>;
}
