import { useEffect, useRef, useState } from 'react';
import type { ComponentRef } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { CatalogProduct, ProductInput } from '../domain/catalog';
import { productPriceInput } from '../domain/catalog';
import { DomainError, countChars, errorMessage } from '../domain/model';
import { useApp } from '../AppProvider';
import { ActionButton, CompactField, TextAction, e } from './editorial';
import { ErrorNotice, s } from './common';

export function ProductEditorModal({ product, initial, onClose, onSaved }: {
  product?: CatalogProduct; initial?: ProductInput; onClose: () => void; onSaved: () => void;
}) {
  const { store } = useApp();
  const [name,setName] = useState(product?.name ?? initial?.name ?? '');
  const [price,setPrice] = useState(product ? productPriceInput(product.unit_price_cents) : initial?.price ?? '');
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [fields,setFields] = useState<Record<string,string>>({});
  const alive=useRef(true); useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const lock = useRef(false), priceInput = useRef<ComponentRef<typeof TextInput>>(null);
  function close() { if (!lock.current) onClose(); }
  async function save(allowDuplicate = false) {
    if (lock.current || !alive.current) return; lock.current = true; setBusy(true); setError(''); setFields({});
    try {
      await store.saveProduct({name,price},product ? {id:product.id,revision:product.revision} : undefined,allowDuplicate);
      if (alive.current) onSaved();
    } catch (cause) {
      if (!alive.current) return;
      if (cause instanceof DomainError && cause.code === 'product_duplicate') Alert.alert('已有同名商品','如要保留另一件同名商品，請明確確認。原商品不會被覆蓋。',[
        {text:'返回檢查',style:'cancel'},{text:product ? '確認儲存此商品' : '仍然新增',onPress:()=>{void save(true);}},
      ]);
      else { setError(errorMessage(cause)); if (cause instanceof DomainError) setFields(cause.fields); }
    } finally { lock.current = false; if(alive.current)setBusy(false); }
  }
  return <Modal visible presentationStyle="fullScreen" animationType="slide" onRequestClose={close}>
    <SafeAreaProvider><SafeAreaView edges={['top','left','right','bottom']} style={s.page} accessibilityViewIsModal onAccessibilityEscape={close}>
      <View style={[e.row,{paddingHorizontal:20,minHeight:52}]}><Text accessibilityRole="header" style={[e.sectionTitle,{flex:1}]}>{product ? '編輯常用商品' : '新增常用商品'}</Text><TextAction title="關閉" icon="close" disabled={busy} onPress={close}/></View>
      <KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={e.content}>
          <Text style={e.caption}>儲存名稱與預設單價，下次開單直接選用。修改只影響之後的選取。</Text>
          <View style={{gap:14}}><CompactField label="商品名稱" placeholder="例如：手作髮圈" value={name} editable={!busy} error={fields.name} onChangeText={setName} returnKeyType="next" onSubmitEditing={()=>priceInput.current?.focus()}/>
            <Text style={[e.caption,{textAlign:'right'}]}>{countChars(name)} / 120</Text>
            <CompactField ref={priceInput} label="預設單價（HK$）" placeholder="0.00" keyboardType="decimal-pad" value={price} editable={!busy} error={fields.price} onChangeText={setPrice} style={{fontVariant:['tabular-nums']}}/>
          </View>
          {!!error && <ErrorNotice message={error}/>}
          <ActionButton title={product ? '儲存商品' : '加入常用商品'} icon="star-outline" busy={busy} onPress={()=>{void save();}}/>
          <Text style={e.caption}>不會修改任何草稿、歷史訂單、收款快照或已保存的付款通知。</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView></SafeAreaProvider>
  </Modal>;
}
