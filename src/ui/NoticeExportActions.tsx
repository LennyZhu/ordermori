import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Text, View, useWindowDimensions } from 'react-native';
import { useApp } from '../AppProvider';
import { DomainError, errorMessage } from '../domain/model';
import type { NoticeFileRecord } from '../domain/notice';
import type { NoticeExportKind } from '../domain/noticeExport';
import { exportNativeNotice, prepareNativeNoticeExport } from '../data/noticeExportNative';
import type { OrderStore } from '../data/store';
import { ActionButton, TextAction, e } from './editorial';
import { color } from './theme';

export function NoticeExportActions({ store, file, onBusyChange }: { store: OrderStore; file: NoticeFileRecord; onBusyChange?: (busy: boolean) => void }) {
  const { version } = useApp(); const { width, fontScale } = useWindowDimensions();
  const [qualification, setQualification] = useState<{ key: string; eligible: boolean; reason: string } | null>(null);
  const [busy, setBusy] = useState<NoticeExportKind | null>(null), [message, setMessage] = useState(''), [error, setError] = useState('');
  const [settings, setSettings] = useState(false), [albumSaved, setAlbumSaved] = useState(false), [refresh, setRefresh] = useState(0);
  const qualificationKey = `${file.id}:${file.dataHash}:${version}:${refresh}`;
  const checking = qualification?.key !== qualificationKey;
  const eligible = !checking && !!qualification?.eligible, reason = qualification?.reason ?? '';
  const alive = useRef(true), lock = useRef(false); const busyCallback = useRef(onBusyChange);
  useEffect(() => { busyCallback.current = onBusyChange; }, [onBusyChange]);
  useEffect(() => { alive.current = true; const listener = AppState.addEventListener('change', (state) => { if (state === 'active') setRefresh((n) => n + 1); }); return () => { alive.current = false; listener.remove(); }; }, []);
  useEffect(() => {
    let active = true;
    void prepareNativeNoticeExport(store, file).then(() => { if (active) setQualification({ key: qualificationKey, eligible: true, reason: '' }); }).catch((cause: unknown) => { if (active) setQualification({ key: qualificationKey, eligible: false, reason: errorMessage(cause) }); });
    return () => { active = false; };
  }, [store, file, qualificationKey]);
  async function run(kind: NoticeExportKind) {
    if (lock.current || !eligible) return;
    lock.current = true; setBusy(kind); busyCallback.current?.(true); setError(''); setMessage(''); setSettings(false);
    try {
      const result = await exportNativeNotice(store, file, kind, () => alive.current);
      if (alive.current) { setMessage(result); if (kind === 'photos') setAlbumSaved(true); }
    } catch (cause) { if (alive.current) { setError(errorMessage(cause)); setSettings(cause instanceof DomainError && cause.code === 'notice_photos_permission'); } }
    finally { lock.current = false; busyCallback.current?.(false); if (alive.current) setBusy(null); }
  }
  return <View style={{ gap: 6 }}>
    {checking ? <Text style={e.caption}>正在核對圖片及目前訂單…</Text> : !eligible ? <Text style={e.caption}>僅供歷史查看 · {reason}</Text> : <>
      <View style={{ flexDirection: width < 370 || fontScale > 1.3 ? 'column' : 'row', gap: 10 }}>
        <View style={{ flex: 1 }}><ActionButton title="分享圖片" icon="share-outline" busy={busy === 'share'} disabled={!!busy} onPress={() => { void run('share'); }} /></View>
        <View style={{ flex: 1 }}><ActionButton title={albumSaved ? '已儲存至相簿' : '儲存至相簿'} icon="download-outline" secondary busy={busy === 'photos'} disabled={!!busy || albumSaved} onPress={() => { void run('photos'); }} /></View>
      </View>
    </>}
    {!!message && <Text accessibilityLiveRegion="polite" style={[e.caption, { color: message === '已儲存至相簿' ? color.green : color.muted }]}>{message}</Text>}
    {!!error && <Text accessibilityRole="alert" style={e.error}>{error}</Text>}
    {settings && <TextAction title="開啟系統設定" icon="open-outline" onPress={() => { void Linking.openSettings().catch(() => setError('未能開啟設定，請手動前往 iPhone 設定 → OrderMori → 相片。')); }} />}
  </View>;
}
