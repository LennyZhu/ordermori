import { tr, trMessage } from "../../src/i18n";
import { useLanguage } from "../../src/i18n/react";
import { useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useApp } from '../../src/AppProvider';
import type { CatalogProduct } from '../../src/domain/catalog';
import { errorMessage, money } from '../../src/domain/model';
import { ActionButton, CompactField, e } from '../../src/ui/editorial';
import { ErrorNotice, Loading, color, s } from '../../src/ui/common';
import { ProductEditorModal } from '../../src/ui/ProductEditorModal';

export default function ProductsScreen() {
  useLanguage();
  const {store,version} = useApp();
  const [query,setQuery] = useState(''), [items,setItems] = useState<CatalogProduct[]>([]);
  const [editor,setEditor] = useState<{product?:CatalogProduct} | null>(null);
  const [error,setError] = useState(''), [message,setMessage] = useState(''), [loading,setLoading] = useState(true), [retry,setRetry] = useState(0), [busy,setBusy] = useState(false);
  const lock = useRef(false);
  useEffect(()=>{
    let active = true;
    store.listProducts(query).then(rows=>{if(active){setItems(rows);setError('');}}).catch(cause=>{if(active)setError(errorMessage(cause));}).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[store,version,query,retry]);
  function remove(product:CatalogProduct) {
    if(lock.current)return;
    Alert.alert(tr("移除常用商品？"),tr`將從商品庫移除「${product.name}」。已帶入草稿及歷史訂單的名稱、價格、數量與付款通知保持不變。`,[
      {text:tr("保留"),style:'cancel'},{text:tr("移除"),style:'destructive',onPress:()=>{
        if(lock.current)return;lock.current=true;setBusy(true);setError('');setMessage('');
        void store.deleteProduct(product.id,product.revision).then(()=>setMessage('已移除常用商品。')).catch(cause=>{setError(errorMessage(cause));setRetry(n=>n+1);}).finally(()=>{lock.current=false;setBusy(false);});
      }},
    ]);
  }
  return <SafeAreaView edges={['left','right','bottom']} style={s.page}>
    <View style={[e.content,{paddingBottom:12,gap:12}]}><View style={e.row}><View style={{flex:1,gap:3}}><Text style={e.sectionTitle}>{tr`讓下一張訂單更快`}</Text><Text style={e.caption}>{tr`常用名稱與單價，帶入後可獨立修改。`}</Text></View><Ionicons name="star-outline" size={24} color={color.ink}/></View>
      <CompactField accessibilityLabel={tr("搜尋常用商品名稱")} placeholder={tr("搜尋商品名稱")} value={query} onChangeText={value=>{if(value!==query){setQuery(value);setLoading(true);}}} autoCorrect={false} returnKeyType="search" leading={<Ionicons name="search-outline" size={17} color={color.muted}/>}/>
      <ActionButton title={tr("新增常用商品")} icon="add" disabled={busy} onPress={()=>{setMessage('');setEditor({});}}/>
      {!!error && <ErrorNotice message={trMessage(error)} retry={()=>setRetry(n=>n+1)}/>}
      {!!message && <Text accessibilityLiveRegion="polite" style={e.caption}>{trMessage(message)}</Text>}
    </View>
    {loading ? <Loading/> : <FlatList data={items} keyExtractor={item=>item.id} automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{paddingHorizontal:20,paddingBottom:24}}
      ListEmptyComponent={<View style={{paddingVertical:32,alignItems:'center',gap:10}}><Ionicons name="bag-outline" size={30} color={color.muted}/><Text style={e.sectionTitle}>{query.trim() ? tr("沒有相符商品") : tr("先儲存一件常用商品")}</Text><Text style={e.caption}>{query.trim() ? tr("試試其他名稱，或新增一件商品。") : tr("只需名稱與預設單價，開單時便可快速選用。")}</Text></View>}
      renderItem={({item,index})=><View style={[e.surface,{borderTopLeftRadius:index===0?14:0,borderTopRightRadius:index===0?14:0,borderBottomLeftRadius:index===items.length-1?14:0,borderBottomRightRadius:index===items.length-1?14:0}]}>
        {index>0&&<View style={[e.divider,{marginHorizontal:14}]}/>}
        <View style={[e.row,{paddingLeft:14,paddingRight:8,paddingVertical:4,gap:4}]}><Pressable accessibilityRole="button" accessibilityLabel={tr`編輯 ${item.name}`} disabled={busy} onPress={()=>{setMessage('');setEditor({product:item});}} style={({pressed})=>[{flex:1,minHeight:56,justifyContent:'center',gap:2,paddingVertical:6},pressed&&e.pressed]}><Text style={e.body}>{item.name}</Text><Text style={[e.numeric,{textAlign:'left',fontSize:13}]}>{money(item.unit_price_cents)}</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={tr`移除 ${item.name}`} disabled={busy} onPress={()=>remove(item)} style={({pressed})=>[e.iconButton,(pressed||busy)&&e.pressed]}><Ionicons name="trash-outline" size={17} color={color.muted}/></Pressable><Ionicons name="chevron-forward" size={15} color={color.muted}/>
        </View>
      </View>}/>
    }
    {editor&&<ProductEditorModal product={editor.product} onClose={()=>setEditor(null)} onSaved={()=>{setEditor(null);setMessage('常用商品已儲存。');}}/>}
  </SafeAreaView>;
}
