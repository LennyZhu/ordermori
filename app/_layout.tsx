import { tr } from "../src/i18n";
import { LanguageProvider, useLanguage } from "../src/i18n/react";
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider } from '../src/AppProvider';
import { color } from '../src/ui/common';
import { TaskHeader } from '../src/ui/editorial';

export default function RootLayout() {
  useLanguage();
  return <SafeAreaProvider><LanguageProvider><StatusBar style="dark" /><AppProvider>
    <Stack screenOptions={{ header: (props) => <TaskHeader {...props} />, contentStyle: { backgroundColor: color.bg } }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="order/new" options={{ title: tr("新增訂單") }} />
      <Stack.Screen name="order/[id]" options={{ title: tr("訂單詳情") }} />
      <Stack.Screen name="order/edit/[id]" options={{ title: tr("修改訂單") }} />
      <Stack.Screen name="order/notice/[id]" options={{ title: tr("付款通知預覽") }} />
      <Stack.Screen name="shop/language" options={{ title: tr("語言 / Language") }} />
      <Stack.Screen name="shop/products" options={{ title: tr("常用商品") }} />
      <Stack.Screen name="shop/backup" options={{ title: tr("備份與還原") }} />
      <Stack.Screen name="shop/payments/index" options={{ title: tr("收款資料") }} />
      <Stack.Screen name="shop/payments/[kind]" options={{ title: tr("收款設定") }} />
    </Stack>
  </AppProvider></LanguageProvider></SafeAreaProvider>;
}
