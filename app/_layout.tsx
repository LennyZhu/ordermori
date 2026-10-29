import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider } from '../src/AppProvider';
import { color } from '../src/ui/common';
import { TaskHeader } from '../src/ui/editorial';

export default function RootLayout() {
  return <SafeAreaProvider><StatusBar style="dark" /><AppProvider>
    <Stack screenOptions={{ header: (props) => <TaskHeader {...props} />, contentStyle: { backgroundColor: color.bg } }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="order/new" options={{ title: '新增訂單' }} />
      <Stack.Screen name="order/[id]" options={{ title: '訂單詳情' }} />
      <Stack.Screen name="order/edit/[id]" options={{ title: '修改訂單' }} />
      <Stack.Screen name="shop/payments/index" options={{ title: '收款資料' }} />
      <Stack.Screen name="shop/payments/[kind]" options={{ title: '收款設定' }} />
    </Stack>
  </AppProvider></SafeAreaProvider>;
}
