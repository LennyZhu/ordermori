import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { getLocales, useLocales } from 'expo-localization';
import { SQLiteStorage } from 'expo-sqlite/kv-store';
import { language, tr } from './index';
import { color } from '../ui/theme';
// Separate device preference DB: restoring a business backup cannot replace it.
const storage = new SQLiteStorage('ordermori-device-preferences.db');
export function useLanguage() {
  useSyncExternalStore(language.subscribe, language.snapshot, language.snapshot);
  return { preference:language.preference, locale:language.locale, select:language.select };
}
export function LanguageProvider({ children }: { children: ReactNode }) {
  useLanguage();
  const locales = useLocales();
  const [ready, setReady] = useState(false), [error, setError] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    language.initialize(storage, getLocales().map(locale => locale.languageTag)).then(() => { if (active) { setReady(true); setError(false); } }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [retry]);
  useEffect(() => { language.setSystem(locales.map(locale => locale.languageTag)); }, [locales]);
  if (!ready) return <View style={{ flex:1, backgroundColor:color.bg, padding:24, justifyContent:'center', gap:16 }}>
    {error ? <><Text style={{ color:color.ink }}>{tr('未能讀取語言設定，請重試；不會清除原設定。')}</Text><Pressable accessibilityRole="button" onPress={() => { setError(false); setRetry(n => n+1); }} style={{ minHeight:44, justifyContent:'center' }}><Text>{tr('重試')}</Text></Pressable></> : <><ActivityIndicator color={color.ink}/><Text style={{ color:color.muted }}>{tr('正在讀取語言設定…')}</Text></>}
  </View>;
  // No locale-based key: router, editor, focused input and draft stay mounted.
  return children;
}
