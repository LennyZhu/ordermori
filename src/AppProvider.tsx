import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { View, Text } from 'react-native';
import { openStore, reopenStore } from './data/native';
import { cleanupBackupCache, releaseBackup, restoreBackup } from './data/backupNative';
import type { BackupPreview } from './data/backupNative';
import type { OrderStore } from './data/store';
import { errorMessage } from './domain/model';
import { Button, Loading, s } from './ui/common';

const Context = createContext<{ store: OrderStore; version: number; restoreData: (preview: BackupPreview) => Promise<void>; restoreResult: string } | null>(null);
export function AppProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<OrderStore | null>(null);
  const [version, setVersion] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [restoring, setRestoring] = useState(false);
  const [restoreResult, setRestoreResult] = useState('');
  const restoreLock = useRef(false);
  const [session, setSession] = useState(0);
  async function restoreData(preview: BackupPreview) {
    if (!store || restoreLock.current) return;
    restoreLock.current = true;
    setRestoring(true); setRestoreResult('');
    try {
      await restoreBackup(store, preview);
      setRestoreResult('還原完成。店舖、訂單及圖片已重新載入；累計建立用量不會回退。');
    } catch (cause) { setRestoreResult(errorMessage(cause)); }
    finally {
      store.retire();
      try { setStore(await reopenStore()); setSession(n => n + 1); }
      catch (cause) { setStore(null); setError(errorMessage(cause)); }
      await releaseBackup(preview).catch(() => undefined);
      restoreLock.current = false; setRestoring(false);
    }
  }
  useEffect(() => {
    let active = true;
    void cleanupBackupCache().catch(() => undefined);
    openStore().then((value) => { if (active) setStore(value); }).catch((cause: unknown) => { if (active) setError(errorMessage(cause)); });
    return () => { active = false; };
  }, [attempt]);
  useEffect(() => store?.subscribe(() => setVersion((value) => value + 1)), [store]);
  if (restoring) return <View style={s.loading}><Text style={s.section}>正在安全還原…</Text><Text style={s.body}>請保持 App 開啟，完成後會重新載入資料。</Text></View>;
  if (error) return <View style={[s.loading, { alignItems: 'stretch' }]}><Text style={s.section}>未能開啟本機資料</Text><Text style={s.body}>{error}</Text><Button title="重新嘗試" onPress={() => { setError(''); setAttempt((v) => v + 1); }} /></View>;
  if (!store) return <Loading />;
  return <Context.Provider key={session} value={{ store, version, restoreData, restoreResult }}>{children}</Context.Provider>;
}
export function useApp() {
  const value = useContext(Context);
  if (!value) throw new Error('AppProvider is missing.');
  return value;
}
