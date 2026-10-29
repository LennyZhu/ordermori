import { t, tr, trMessage } from "../../src/i18n";
import { useLanguage } from "../../src/i18n/react";
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useApp } from '../../src/AppProvider';
import { FREE_LIMIT, errorMessage, money } from '../../src/domain/model';
import type { Filter, HomeData } from '../../src/domain/model';
import { ErrorNotice, color, dateText, s, statusText } from '../../src/ui/common';
import { ActionButton, CompactField, OrderStates, SectionHeading, TextAction, e } from '../../src/ui/editorial';
import { hasDraftInput } from '../../src/ui/home';

const filters: Filter[] = ['all', 'unpaid', 'fulfillment', 'completed', 'refunded', 'cancelled'];
export default function OrdersScreen() {
  useLanguage();
  const { store, version } = useApp();
  const router = useRouter();
  const { width, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const expandedHeader = fontScale > 1.3 || width - insets.left - insets.right < 350;
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [data, setData] = useState<HomeData | null>(null);
  const [resumeDraft, setResumeDraft] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    Promise.all([store.getHome(search, filter), store.getDraftInput()]).then(([value, input]) => {
      if (active) { setData(value); setResumeDraft(hasDraftInput(input)); setError(''); }
    })
      .catch((cause: unknown) => { if (active) setError(errorMessage(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [store, version, search, filter, retry]);
  const create = () => {
    if (!data) return;
    if (data.createdCount >= FREE_LIMIT) {
      Alert.alert(tr("Free 累計額度已用完"), tr("前 10 張真實訂單已建立。Pro 購買尚未開放；已有訂單仍可查看及管理，不會刪除。")); return;
    }
    if (resumeDraft) {
      Alert.alert(tr("繼續未完成的訂單？"), tr("目前只保留一份草稿。可繼續填寫，或在草稿頁明確捨棄後重新開單。"), [
        { text: tr("取消"), style: 'cancel' }, { text: tr("繼續草稿"), onPress: () => router.push('/order/new') },
      ]); return;
    }
    router.push('/order/new');
  };
  return <SafeAreaView edges={['top', 'left', 'right']} style={s.page}>
    <FlatList data={data?.orders ?? []} keyExtractor={(item) => item.id} keyboardShouldPersistTaps="handled"
      contentContainerStyle={[e.content, { flexGrow: 1, gap: 0 }]}
      ListHeaderComponent={<View style={{ gap: 16, marginBottom: 10 }}>
        <View style={[h.header, expandedHeader && h.expandedHeader]}>
          <View style={[h.identity, expandedHeader && h.expandedIdentity]}>
            <Text accessibilityRole="header" style={e.pageTitle} numberOfLines={expandedHeader ? undefined : 2} ellipsizeMode="tail">
              {data?.shop.name.trim() || tr("我的店舖")}
            </Text>
            <Text style={e.caption}>{tr`訂單管理`}</Text>
          </View>
          <View style={[h.primaryAction, expandedHeader && h.expandedAction]}><ActionButton title={t('newOrder')} icon="add" disabled={!data} onPress={create} /></View>
        </View>
        {data && !data.shop.name.trim() && <View style={{ alignSelf: 'flex-start' }}><TextAction title={tr("設定店舖名稱")} icon="create-outline" onPress={() => router.push('/shop')} /></View>}
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={tr`待付款 ${data?.unpaid ?? tr("讀取中")}，查看訂單`} disabled={!data} onPress={() => setFilter('unpaid')}
            style={({ pressed }) => [h.metric, fontScale > 1.3 && h.expandedMetric, pressed && e.pressed]}>
            <Text style={[e.caption, { flexShrink: 1 }]}>{tr`待付款`}</Text><Text style={h.metricValue}>{data ? data.unpaid : '—'}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={tr`待發貨及面交 ${data?.fulfillment ?? tr("讀取中")}，查看訂單`} disabled={!data} onPress={() => setFilter('fulfillment')}
            style={({ pressed }) => [h.metric, fontScale > 1.3 && h.expandedMetric, pressed && e.pressed]}>
            <Text style={[e.caption, { flexShrink: 1 }]}>{tr`待發貨／交付`}</Text><Text style={h.metricValue}>{data ? data.fulfillment : '—'}</Text>
          </Pressable>
        </View>
        <CompactField accessibilityLabel={t('search')} placeholder={t('search')} value={search} onChangeText={setSearch}
          autoCapitalize="none" autoCorrect={false} returnKeyType="search" leading={<Ionicons name="search-outline" size={18} color={color.muted} />}
          trailing={search ? <Pressable accessibilityRole="button" accessibilityLabel={tr("清除搜尋")} onPress={() => setSearch('')} style={e.iconButton}><Ionicons name="close-circle" size={18} color={color.muted} /></Pressable> : undefined} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled"
          style={h.filters} contentContainerStyle={h.filterContent}>
          {filters.map((value) => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: filter === value }} onPress={() => setFilter(value)}
            style={({ pressed }) => [h.filter, filter === value && { backgroundColor: color.ink }, pressed && e.pressed]}>
            <Text style={[e.actionText, { color: filter === value ? color.surface : color.muted }]}>{t(value)}</Text>
          </Pressable>)}
        </ScrollView>
        {data && resumeDraft && <Pressable accessibilityRole="button" onPress={() => router.push('/order/new')} style={({ pressed }) => [h.draft, pressed && e.pressed]}>
          <Ionicons name="document-text-outline" size={19} color={color.ink} /><View style={{ flex: 1 }}><Text style={e.fieldLabel}>{tr`繼續未完成的訂單`}</Text><Text style={e.caption}>{tr`已暫存 · 不佔 Free 額度`}</Text></View><Ionicons name="chevron-forward" size={15} color={color.muted} />
        </Pressable>}
        {!!error && <ErrorNotice message={trMessage(error) + (data ? tr(" 以下可能為上次讀取的資料。") : '')} retry={() => setRetry((v) => v + 1)} />}
        <View style={{ gap: 6 }}><SectionHeading title={search ? tr("搜尋結果") : filter === 'all' ? tr("最近訂單") : t(filter)}
          right={data ? <Text style={h.quota}>{tr`Free 累計 ${data.createdCount} / ${FREE_LIMIT}`}</Text> : undefined} />
          {data && data.createdCount >= FREE_LIMIT && <Text style={e.caption}>{tr`新增額度已用完，已有訂單仍可管理。`}</Text>}
        </View>
      </View>}
      renderItem={({ item, index }) => <Pressable accessibilityRole="button" accessibilityLabel={`${item.buyer_identifier}，${item.order_number}，${money(item.total_cents)}，${tr(statusText[item.order_status])}，${tr(statusText[item.payment_status])}，${tr(statusText[item.fulfillment_status])}`}
        onPress={() => router.push({ pathname: '/order/[id]', params: { id: item.id } })}
        style={({ pressed }) => [h.orderRow, { opacity: pressed ? 0.6 : 1,
          borderTopLeftRadius: index === 0 ? 14 : 0, borderTopRightRadius: index === 0 ? 14 : 0,
          borderBottomLeftRadius: index === (data?.orders.length ?? 0) - 1 ? 14 : 0, borderBottomRightRadius: index === (data?.orders.length ?? 0) - 1 ? 14 : 0 }]}>
        <View style={[e.row, { alignItems: 'flex-start' }]}><Text style={[e.body, { flex: 1, minWidth: 0, fontWeight: '500' }]}>{item.buyer_identifier}</Text>
          <Text style={[e.numeric, { fontSize: 16, fontWeight: '600', maxWidth: '50%' }]}>{money(item.total_cents)}</Text></View>
        <Text style={[e.caption, { fontSize: 12 }]}>{item.order_number} · {dateText(item.created_at)}</Text><OrderStates order={item} />
      </Pressable>}
      ItemSeparatorComponent={() => <View style={{ backgroundColor: color.surface, paddingHorizontal: 14 }}><View style={e.divider} /></View>}
      ListEmptyComponent={loading ? <View style={h.empty}><ActivityIndicator color={color.ink} /><Text style={e.caption}>{tr`正在讀取訂單…`}</Text></View> : error ? <View /> : <View style={h.empty}>
        <View style={h.emptySymbol} accessibilityElementsHidden><Ionicons name={search || filter !== 'all' ? 'search-outline' : 'receipt-outline'} size={30} color={color.muted} /></View>
        <Text accessibilityRole="header" style={e.sectionTitle}>{search || filter !== 'all' ? tr("沒有符合的訂單") : tr("從第一張訂單開始")}</Text>
        <Text style={h.emptyBody}>{search || filter !== 'all' ? tr("試試其他買家、編號或篩選條件。") : tr("把買家與商品整理成訂單，\n在這裡輕鬆跟進收款與交付。")}</Text>
        {search || filter !== 'all' ? <TextAction title={tr("清除搜尋及篩選")} icon="refresh-outline" onPress={() => { setSearch(''); setFilter('all'); }} /> :
          <Text style={e.caption}>{tr`點按右上方「新增訂單」開始。`}</Text>}
      </View>}
    />
  </SafeAreaView>;
}

const h = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  expandedHeader: { flexDirection: 'column', alignItems: 'stretch' },
  identity: { flex: 1, minWidth: 0, gap: 4 },
  expandedIdentity: { flex: 0 },
  primaryAction: { flexShrink: 0, alignSelf: 'flex-start', maxWidth: '100%' },
  expandedAction: { alignSelf: 'flex-end' },
  metric: { flex: 1, minWidth: 0, minHeight: 72, padding: 14, borderRadius: 12, backgroundColor: color.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  expandedMetric: { flexDirection: 'column', alignItems: 'flex-start' },
  metricValue: { fontSize: 25, lineHeight: 33, fontWeight: '600', color: color.ink, fontVariant: ['tabular-nums'], flexShrink: 1 },
  filters: { flexGrow: 0 },
  filterContent: { gap: 4, paddingRight: 20 },
  filter: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 9, justifyContent: 'center' },
  draft: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, minHeight: 60, borderWidth: 1, borderColor: color.line, borderRadius: 12, backgroundColor: color.surface },
  quota: { fontSize: 12, lineHeight: 18, color: color.muted, flexShrink: 1, textAlign: 'right' },
  orderRow: { backgroundColor: color.surface, paddingHorizontal: 14, paddingVertical: 12, gap: 6 },
  empty: { backgroundColor: color.surface, borderRadius: 14, alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 28 },
  emptySymbol: { width: 58, height: 64, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: color.line, borderRadius: 12, backgroundColor: color.bg, marginBottom: 4 },
  emptyBody: { fontSize: 14, lineHeight: 22, color: color.muted, textAlign: 'center', maxWidth: 260 },
});
