import { useEffect } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { tr, trMessage } from '../../src/i18n';
import { useLanguage } from '../../src/i18n/react';
import { proEntitlements } from '../../src/data/proNative';
import { usePro } from '../../src/ui/usePro';
import { ActionButton, TextAction, e } from '../../src/ui/editorial';
import { color } from '../../src/ui/theme';

export default function ProScreen() {
  useLanguage(); const pro = usePro();
  useEffect(() => { void proEntitlements.refresh().then(grant => { if (!grant.unlimited) return proEntitlements.loadProduct(); }); }, []);
  const busy = !!pro.operation;
  const benefits = [tr('無限建立正式訂單'), tr('移除付款通知品牌署名'), tr('一次購買，永久解鎖'), tr('無月費、無自動續訂')];
  return <SafeAreaView edges={['left', 'right', 'bottom']} style={{ flex: 1, backgroundColor: color.bg }}>
    <ScrollView contentContainerStyle={[e.content, { maxWidth: 560, width: '100%', alignSelf: 'center', flexGrow: 1, gap: 24 }]}>
      <View style={{ gap: 8, paddingTop: 12 }}><Text style={e.caption}>OrderMori Pro</Text>
        <Text accessibilityRole="header" style={e.pageTitle}>{pro.hasPro ? tr('Pro 已永久解鎖') : tr('升級 OrderMori Pro')}</Text>
        <Text style={e.body}>{tr('為你的小店，留更多開單空間。')}</Text>
      </View>
      <View>{benefits.map((benefit, index) => <View key={index} style={[e.row, { minHeight: 52, paddingVertical: 10, borderBottomWidth: 0.5, borderColor: color.line }]}>
        <Ionicons name="checkmark-outline" size={19} color={color.ink} /><Text style={[e.body, { flex: 1 }]}>{benefit}</Text>
      </View>)}</View>
      <View style={{ gap: 10 }}>
        {pro.hasPro ? <View style={[e.row, { minHeight: 52 }]}><Ionicons name="checkmark-circle-outline" size={23} color={color.ink} /><Text style={e.sectionTitle}>{tr('已擁有 OrderMori Pro')}</Text></View> :
          <ActionButton title={pro.product ? tr`永久解鎖 · ${pro.product.displayPrice}` : pro.productLoading ? tr('正在載入 Apple 價格…') : tr('Apple 商品暫不可用')}
            busy={pro.operation === 'purchase' || pro.productLoading} disabled={busy || !pro.product || pro.status === 'checking'} onPress={() => { void proEntitlements.purchase(); }} />}
        {!pro.product && !pro.productLoading && !pro.hasPro && <TextAction title={tr('重新載入 Apple 商品')} onPress={() => { void proEntitlements.loadProduct(); void proEntitlements.refresh(); }} disabled={busy} />}
        <TextAction title={pro.operation === 'restore' ? tr('正在恢復購買…') : tr('恢復購買')} onPress={() => { void proEntitlements.restore(); }} disabled={busy} />
        {!!pro.message && <Text accessibilityLiveRegion="polite" style={pro.tone === 'error' ? e.error : e.caption}>{trMessage(pro.message)}</Text>}
        {pro.status === 'checking' && <Text style={e.caption}>{tr('正在確認 Apple 權益…')}</Text>}
      </View>
      <View style={{ gap: 8 }}><Text style={e.caption}>{tr('一次性購買 · 無訂閱月費 · 不設使用期限')}</Text>
        <Text style={e.caption}>{tr('價格由 Apple 按你的 App Store 地區提供，與訂單的 HKD 金額無關。')}</Text>
        <Text style={e.caption}>{tr('兩款模板、商品庫、分享、相簿儲存及備份仍免費。已保存圖片不會因升級而改寫。')}</Text>
        <Text style={e.caption}>{tr('除 Apple 確認退款或撤銷等特殊交易情況外，正常購買不因時間經過失效。換裝置可使用相同 Apple 購買帳戶恢復。')}</Text>
      </View>
    </ScrollView>
  </SafeAreaView>;
}
