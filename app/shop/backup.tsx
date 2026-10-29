import { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { usePreventRemove } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '../../src/AppProvider';
import { backupLastCreated, chooseBackup, createBackup, exportBackup, releaseBackup } from '../../src/data/backupNative';
import type { BackupPreview } from '../../src/data/backupNative';
import { errorMessage } from '../../src/domain/model';
import { ActionButton, AmountRow, SectionHeading, e } from '../../src/ui/editorial';
import { ErrorNotice, color, s } from '../../src/ui/common';

const date = (value: string) => new Date(value).toLocaleString('zh-HK');
export default function BackupScreen() {
  const { store, restoreData, restoreResult } = useApp();
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [last, setLast] = useState<string | null>(null);
  const [created, setCreated] = useState<BackupPreview | null>(null), [selected, setSelected] = useState<BackupPreview | null>(null);
  const lock = useRef(false), alive = useRef(true), createdRef = useRef<BackupPreview | null>(null), selectedRef = useRef<BackupPreview | null>(null);
  useEffect(() => {
    alive.current = true;
    void backupLastCreated(store).then(value => { if (alive.current) setLast(value); }).catch(cause => { if (alive.current) setError(errorMessage(cause)); });
    return () => { alive.current = false; void releaseBackup(createdRef.current).catch(() => undefined); void releaseBackup(selectedRef.current).catch(() => undefined); };
  }, [store]);
  usePreventRemove(!!busy);
  async function run(label: string, work: () => Promise<void>) {
    if (lock.current) return; lock.current = true; setBusy(label); setError(''); setMessage('');
    try { await work(); } catch (cause) { if (alive.current) setError(errorMessage(cause)); }
    finally { lock.current = false; if (alive.current) setBusy(''); }
  }
  function build() {
    Alert.alert('建立未加密備份', '備份包含買家、訂單及收款資料。請妥善保管，只儲存到你信任的位置；不會自動上傳。', [
      { text:'取消',style:'cancel' }, { text:'建立備份',onPress:() => { void run('正在建立及核對備份…',async() => {
        const preview = await createBackup(store); await releaseBackup(createdRef.current); createdRef.current = preview;
        if (alive.current) { setCreated(preview); setLast(preview.createdAt); setMessage('備份已在本機建立並核對。請繼續儲存到「檔案」。'); }
      }); } },
    ]);
  }
  function restore() {
    if (!selected || lock.current) return;
    Alert.alert('取代此裝置的資料？','還原將取代此裝置現有的店舖及訂單資料。建議先建立目前資料的備份。還原不合併訂單，不恢復 Pro 購買權益，累計用量取有效記錄的較高值。',[
      {text:'取消',style:'cancel'}, {text:'確認還原並取代',style:'destructive',onPress:() => {
        if (lock.current || !selectedRef.current) return;
        const preview=selectedRef.current; selectedRef.current=null; // Provider owns the restore lease while pages unmount.
        lock.current=true; void restoreData(preview);
      }},
    ]);
  }
  return <SafeAreaView edges={['left','right','bottom']} style={s.page}><ScrollView contentContainerStyle={e.content}>
    <View style={{gap:8}}><View style={e.row}><Ionicons name="folder-open-outline" size={22} color={color.ink}/><Text style={e.sectionTitle}>把資料留在自己手上</Text></View>
      <Text style={e.body}>將店舖、訂單、草稿、收款原圖及本機付款通知，保存為一份完整備份。</Text>
      <Text style={e.caption}>備份未加密，可能包含買家及收款資料。校驗可檢查損壞，不能證明來源可信。請只還原你信任的備份。</Text></View>
    <View style={{gap:10}}><ActionButton title="建立備份" icon="archive-outline" busy={!!busy && busy.startsWith('正在建立')} disabled={!!busy} onPress={build}/>
      <ActionButton title="從備份還原" icon="document-outline" secondary disabled={!!busy} onPress={() => { void run('正在只讀檢查備份…',async() => {
        const preview=await chooseBackup();
        if (!preview) { setMessage('已取消選擇，現有資料未變更。'); return; }
        await releaseBackup(selectedRef.current); selectedRef.current=preview; if(alive.current)setSelected(preview);
      }); }}/>
      <Text style={e.caption}>{last ? `最近本機成功建立：${date(last)}` : '尚未在此裝置記錄成功建立的備份。'}此時間不代表已保存到外部位置。</Text></View>
    {!!busy && <Text accessibilityLiveRegion="polite" style={e.body}>{busy}</Text>}
    {!!error && <ErrorNotice message={error}/>}
    {!!message && <Text accessibilityLiveRegion="polite" style={e.body}>{message}</Text>}
    {!!restoreResult && <Text accessibilityLiveRegion="polite" style={e.body}>{restoreResult}</Text>}
    {created && <View style={{gap:10}}><SectionHeading title="本機備份已就緒"/><Summary preview={created}/>
      <ActionButton secondary title="儲存到檔案" icon="share-outline" disabled={!!busy} onPress={() => { void run('正在開啟系統面板…',async() => setMessage(await exportBackup(created))); }}/>
      <Text style={e.caption}>在系統面板選擇「儲存到檔案」，可選 Files、iCloud Drive 或你提供的其他位置。關閉／取消面板不代表已儲存。</Text></View>}
    {selected && <View style={{gap:12}}><View style={e.divider}/><SectionHeading title="還原前確認"/><Summary preview={selected}/>
      <Text style={e.body}>還原將取代此裝置現有的店舖及訂單資料。</Text>
      <Text style={e.caption}>累計建立用量不回退。此備份不授予 Pro；本機資料無法防止卸載或完全抹除後重設累計用量。</Text>
      <ActionButton title="檢查並確認還原" danger secondary disabled={!!busy} onPress={restore}/>
      <ActionButton title="取消還原" secondary disabled={!!busy} onPress={() => { void releaseBackup(selectedRef.current).catch(() => undefined); selectedRef.current=null; setSelected(null); setMessage('已取消還原，現有資料未變更。'); }}/></View>}
    <View style={e.divider}/><Text style={e.caption}>替換還原，不合併訂單。支援本 App 的 .ordermori.zip 及舊版 .ordermori 備份；目前上限 256 MB、512 個檔案。請保持 App 開啟直到完成。</Text>
  </ScrollView></SafeAreaView>;
}
function Summary({preview}:{preview:BackupPreview}) {
  return <View style={[e.surface,e.inset]}><AmountRow label="備份日期" value={date(preview.createdAt)}/><View style={e.divider}/>
    <AmountRow label="訂單 / 商品項目" value={`${preview.summary.orders} / ${preview.summary.items}`}/><AmountRow label="實際圖片檔案" value={`${preview.summary.media} 個`}/>
    <AmountRow label="累計已建立訂單" value={`${preview.summary.createdCount} 張`}/><AmountRow label="備份包大小" value={`${(preview.bytes/1024/1024).toFixed(1)} MB`}/></View>;
}
