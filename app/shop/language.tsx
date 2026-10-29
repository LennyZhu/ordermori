import { useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { tr } from '../../src/i18n';
import { useLanguage } from '../../src/i18n/react';
import type { LanguagePreference } from '../../src/i18n';
import { e } from '../../src/ui/editorial';
import { ErrorNotice, color, s } from '../../src/ui/common';

const choices: readonly LanguagePreference[] = ['system','zh-HK','en'];
export default function LanguageScreen() {
  const { preference, locale, select } = useLanguage();
  const [busy,setBusy] = useState(false), [error,setError] = useState(false), [saved,setSaved] = useState(false);
  const lock = useRef(false);
  async function choose(value: LanguagePreference) {
    if (lock.current || value === preference) return;
    lock.current = true; setBusy(true); setError(false); setSaved(false);
    try { await select(value); setSaved(true); }
    catch { setError(true); }
    finally { lock.current = false; setBusy(false); }
  }
  return <SafeAreaView edges={['left','right','bottom']} style={s.page}><ScrollView contentContainerStyle={e.content}>
    <Text style={e.body}>{tr('即時切換介面語言。你輸入的資料及付款通知圖片不會改變。')}</Text>
    <View style={e.surface}>{choices.map((value,index) => <View key={value}>
      {index > 0 && <View style={[e.divider,{marginHorizontal:14}]}/>}
      <Pressable accessibilityRole="radio" accessibilityState={{ checked:preference === value, disabled:busy }} disabled={busy} onPress={() => { void choose(value); }} style={({pressed}) => [e.inset,e.row,{ minHeight:56 },pressed && e.pressed]}>
        <Text style={[e.body,{flex:1,minWidth:0}]}>{value === 'system' ? tr('跟隨系統') : value === 'en' ? 'English' : '繁體中文（香港）'}</Text>
        <Ionicons name={preference === value ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={color.ink}/>
      </Pressable>
    </View>)}</View>
    <Text style={e.caption}>{tr('目前介面語言')} · {locale === 'en' ? 'English' : '繁體中文（香港）'}</Text>
    <Text style={e.caption}>{tr('未支援的系統語言使用繁體中文（香港）。')}</Text>
    {saved && <Text accessibilityLiveRegion="polite" style={[e.caption,{color:color.green}]}>{tr('語言設定已儲存。')}</Text>}
    {error && <ErrorNotice message={tr('語言設定未能儲存，原設定保持不變。請重試。')}/>}
  </ScrollView></SafeAreaView>;
}
