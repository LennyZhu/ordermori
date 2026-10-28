import { Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color } from '../../src/ui/common';
import { t } from '../../src/i18n';

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  return <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: color.ink, tabBarInactiveTintColor: color.muted,
    tabBarLabelPosition: 'below-icon', tabBarHideOnKeyboard: true,
    tabBarStyle: { backgroundColor: color.surface, borderTopColor: color.line, borderTopWidth: StyleSheet.hairlineWidth,
      height: Math.max(56, 34 + Math.ceil(18 * fontScale)) + Math.max(insets.bottom, 6), paddingTop: 4, paddingBottom: Math.max(insets.bottom, 6), elevation: 0, shadowOpacity: 0 },
    tabBarItemStyle: { minHeight: 44, paddingVertical: 2 }, tabBarLabelStyle: { fontSize: 12, lineHeight: 18, fontWeight: '500', marginTop: 2 } }}>
    <Tabs.Screen name="index" options={{ title: t('orders'), tabBarIcon: ({ color: tint, focused }) => <Ionicons name={focused ? 'receipt' : 'receipt-outline'} size={22} color={typeof tint === 'string' ? tint : color.muted} /> }} />
    <Tabs.Screen name="shop" options={{ title: t('shop'), tabBarIcon: ({ color: tint, focused }) => <Ionicons name={focused ? 'storefront' : 'storefront-outline'} size={22} color={typeof tint === 'string' ? tint : color.muted} /> }} />
  </Tabs>;
}
