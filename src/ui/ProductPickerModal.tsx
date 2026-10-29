import { tr, trMessage } from "../i18n";
import { useLanguage } from "../i18n/react";
import { useEffect, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useApp } from '../AppProvider';
import type { CatalogProduct } from '../domain/catalog';
import { errorMessage, money } from '../domain/model';
import { CompactField, TextAction, e } from './editorial';
import { ErrorNotice, Loading, color, s } from './common';

export function ProductPickerModal({onClose,onAdd,slots}:{onClose:()=>void;onAdd:(product:CatalogProduct)=>void;slots:number}) {
  useLanguage();
  const {store,version}=useApp();
  const [query,setQuery]=useState(''),[products,setProducts]=useState<CatalogProduct[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[message,setMessage]=useState(''),[retry,setRetry]=useState(0),[adding,setAdding]=useState(false);
  const lock=useRef(false),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    let active=true;
    store.listProducts(query).then(rows=>{if(active){setProducts(rows);setError('');}}).catch(cause=>{if(active)setError(errorMessage(cause));}).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[store,version,query,retry]);
  async function add(product:CatalogProduct) {
    if(lock.current||slots<=0)return;lock.current=true;setAdding(true);setError('');
    try {const latest=await store.getProduct(product.id,product.revision);if(alive.current){onAdd(latest);setMessage(`已加入「${latest.name}」× 1，可繼續選取。`);}}
    catch(cause){if(alive.current){setError(errorMessage(cause));setRetry(n=>n+1);}}
    finally{lock.current=false;if(alive.current)setAdding(false);}
  }
  return <Modal visible presentationStyle="pageSheet" animationType="slide" onRequestClose={onClose}>
    <SafeAreaProvider><SafeAreaView edges={['top','left','right','bottom']} style={s.page} accessibilityViewIsModal onAccessibilityEscape={onClose}>
      <View style={[e.row,{paddingHorizontal:20,minHeight:52}]}><Text accessibilityRole="header" style={[e.sectionTitle,{flex:1}]}>{tr`選擇常用商品`}</Text><TextAction title={tr("完成")} disabled={adding} onPress={onClose}/></View>
      <View style={{paddingHorizontal:20,paddingBottom:12,gap:8}}><CompactField accessibilityLabel={tr("搜尋常用商品名稱")} placeholder={tr("搜尋商品名稱")} value={query} onChangeText={value=>{if(value!==query){setQuery(value);setLoading(true);}}} autoCorrect={false} leading={<Ionicons name="search-outline" size={17} color={color.muted}/>}/>
        <Text style={e.caption}>{slots>0 ? tr("每次加入一項，數量為 1；本單可獨立改名及改價。") : tr("已達每張訂單 20 項上限，請先返回調整。")}</Text>
        {!!error&&<ErrorNotice message={trMessage(error)} retry={()=>setRetry(n=>n+1)}/>}
        {!!message&&<Text accessibilityLiveRegion="polite" style={e.caption}>{trMessage(message)}</Text>}
      </View>
      {loading?<Loading/>:<FlatList data={products} keyExtractor={item=>item.id} automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{paddingHorizontal:20,paddingBottom:20}}
        ListEmptyComponent={<View style={{alignItems:'center',paddingVertical:28,gap:8}}><Ionicons name="star-outline" size={28} color={color.muted}/><Text style={e.sectionTitle}>{query.trim()?tr("沒有相符商品"):tr("尚未建立常用商品")}</Text><Text style={e.caption}>{query.trim()?tr("試試其他名稱。"):tr("仍可手動開單，也可到「我的店舖」新增商品。")}</Text></View>}
        renderItem={({item,index})=><View style={[e.surface,{borderRadius:0,borderTopLeftRadius:index===0?14:0,borderTopRightRadius:index===0?14:0,borderBottomLeftRadius:index===products.length-1?14:0,borderBottomRightRadius:index===products.length-1?14:0}]}>
          {index>0&&<View style={[e.divider,{marginHorizontal:14}]}/>}
          <View style={[e.row,{padding:12,gap:12}]}><View style={{flex:1,minWidth:0,gap:3}}><Text style={e.body}>{item.name}</Text><Text style={[e.numeric,{textAlign:'left',fontSize:13}]}>{money(item.unit_price_cents)}</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel={tr`加入 ${item.name}，${money(item.unit_price_cents)}，數量 1`} accessibilityState={{disabled:adding||slots<=0}} disabled={adding||slots<=0} onPress={()=>{void add(item);}} style={({pressed})=>[e.iconButton,{backgroundColor:color.ink,borderRadius:10},(pressed||adding||slots<=0)&&e.pressed]}><Ionicons name="add" size={21} color={color.surface}/></Pressable>
          </View>
        </View>}/>
      }
    </SafeAreaView></SafeAreaProvider>
  </Modal>;
}
