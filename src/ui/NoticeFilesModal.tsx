import { tr, trMessage } from "../i18n";
import { useLanguage } from "../i18n/react";
import { useRef, useState } from 'react';
import { Alert, Image, Modal, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { OrderStore } from '../data/store';
import { removeSavedNotice, verifyNoticeFile } from '../data/noticeFiles';
import { errorMessage } from '../domain/model';
import { noticeFailure } from '../domain/noticeDiagnostics';
import { noticeDate, templateName } from '../domain/notice';
import type { NoticeFileRecord } from '../domain/notice';
import { ErrorNotice, s } from './common';
import { TextAction, e } from './editorial';
import { NoticeExportActions } from './NoticeExportActions';

export function NoticeFilesModal({ store, files, onClose, onRemoved }: { store: OrderStore; files: NoticeFileRecord[]; onClose: () => void; onRemoved: () => void }) {
  useLanguage();
  const [selected, setSelected] = useState<{ file: NoticeFileRecord; uri: string } | null>(null);
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const { width } = useWindowDimensions();
  const lock = useRef(false);
  function setWorking(value: boolean) { lock.current = value; setBusy(value); }
  function close() { if (!lock.current) onClose(); }
  async function open(file: NoticeFileRecord) {
    if (lock.current) return; setWorking(true); setError('');
    try { setSelected({ file, uri: await verifyNoticeFile(file) }); } catch (cause) { setError(noticeFailure('preview-read', file.template, cause).message); } finally { setWorking(false); }
  }
  function remove(file: NoticeFileRecord) {
    if (lock.current) return;
    Alert.alert(tr("移除此 PNG？"), tr("只刪除此份本機輸出，不會刪除訂單、收款設定或官方原圖。外部副本不受影響。"), [{ text: tr("保留"), style: 'cancel' }, {
      text: tr("移除"), style: 'destructive', onPress: () => {
        if (lock.current) return;
        setWorking(true); void removeSavedNotice(store, file).then(() => { setSelected(null); onRemoved(); }).catch((cause: unknown) => setError(errorMessage(cause))).finally(() => setWorking(false));
      },
    }]);
  }
  return <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={close}>
    <SafeAreaProvider style={s.page}><SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={s.page} accessibilityViewIsModal onAccessibilityEscape={close}>
      <View style={[e.row, { paddingHorizontal: 16, minHeight: 52 }]}>
        {selected && <TextAction title={tr("列表")} icon="chevron-back" disabled={busy} onPress={() => { if (!lock.current) setSelected(null); }} />}
        <Text style={[e.sectionTitle, { flex: 1 }]}>{tr`本機付款通知`}</Text><TextAction title={tr("關閉")} icon="close" disabled={busy} onPress={close} />
      </View>
      {!!error && <View style={{ paddingHorizontal: 20 }}><ErrorNotice message={trMessage(error)} /></View>}
      <Text style={[e.caption, { paddingHorizontal: 20, paddingVertical: 8 }]}>{tr`歷史圖片保留產生當時的內容，不代表目前仍需付款，也不代表已到帳。`}</Text>
      {selected && <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}><NoticeExportActions key={selected.file.id} store={store} file={selected.file} onBusyChange={setWorking} /></View>}
      {selected ? <>
        <ScrollView style={{ flex: 1 }} minimumZoomScale={1} maximumZoomScale={4} automaticallyAdjustContentInsets={false} contentInsetAdjustmentBehavior="never" contentContainerStyle={{ padding: 20 }}>
          <Image source={{ uri: selected.uri }} resizeMode="contain" style={{ width: width - 40, height: (width - 40) * selected.file.height / selected.file.width }}
            onError={() => setError('PNG 未能顯示，檔案可能已失效。請返回列表移除，訂單與原圖不受影響。')} />
        </ScrollView><View style={{ paddingHorizontal: 20, paddingBottom: 12 }}><TextAction title={tr("移除此 PNG")} danger disabled={busy} onPress={() => remove(selected.file)} /></View>
      </> : <ScrollView contentContainerStyle={e.content}>
        {!files.length && <Text style={e.caption}>{tr`尚未儲存付款通知 PNG。`}</Text>}
        {files.map((file) => <View key={file.id} style={{ gap: 4, borderBottomWidth: 0.5, borderBottomColor: '#E8E6E1', paddingBottom: 12 }}>
          <Text style={e.fieldLabel}>{tr(templateName[file.template])} · {noticeDate(file.createdAt)}</Text>
          <Text style={e.caption}>{file.width} × {file.height} px · {(file.bytes / 1024).toFixed(0)} KB</Text>
          <View style={[e.rowWrap, { justifyContent: 'space-between' }]}><TextAction title={tr("查看 PNG")} icon="image-outline" disabled={busy} onPress={() => { void open(file); }} /><TextAction title={tr("移除")} danger disabled={busy} onPress={() => remove(file)} /></View>
        </View>)}
      </ScrollView>}
    </SafeAreaView></SafeAreaProvider>
  </Modal>;
}
