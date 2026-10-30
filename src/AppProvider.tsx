import { tr, trMessage } from "./i18n";
import { useLanguage } from "./i18n/react";
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AppState, View, Text } from 'react-native';
import { proEntitlements } from './data/proNative';
import { openStore, reopenStore } from './data/native';
import { cleanupBackupCache, releaseBackup, restoreBackup } from './data/backupNative';
import type { BackupPreview } from './data/backupNative';
import type { OrderStore } from './data/store';
import { errorMessage } from './domain/model';
import { quotaRefreshDelay } from './domain/quota';
import { Button, Loading, s } from './ui/common';

const Context = createContext<{ store: OrderStore; version: number; restoreData: (preview: BackupPreview) => Promise<void>; restoreResult: string } | null>(null);
export function AppProvider({ children }: { children: ReactNode }) {
  useLanguage();
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
      setRestoreResult('還原完成。店舖、訂單及圖片已重新載入；已記錄的月度用量不會回退。');
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
  useEffect(() => {
    let revision = proEntitlements.current().revision;
    const unsubscribe = proEntitlements.subscribe(() => {
      const next = proEntitlements.current().revision;
      if (revision !== next) { revision = next; setVersion(value => value + 1); }
    });
    void proEntitlements.start();
    const listener = AppState.addEventListener('change', state => { if (state === 'active') void proEntitlements.refresh(); });
    return () => { unsubscribe(); listener.remove(); };
  }, []);
  useEffect(() => store?.subscribe(() => setVersion((value) => value + 1)), [store]);
  useEffect(() => {
    if (!store) return;
    let active = true, signature = '', generation = 0; let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      const ticket = ++generation;
      clearTimeout(timer);
      if (!active || AppState.currentState !== 'active') return;
      let delay = 60000;
      try {
        const quota = await store.getQuota();
        if (!active || ticket !== generation || AppState.currentState !== 'active') return;
        const next = `${quota.period}:${quota.used}:${quota.clockRollback}`;
        if (next !== signature) { signature = next; setVersion(n => n + 1); }
        delay = quotaRefreshDelay(quota.nextResetAt, Date.now());
      } catch { /* Maintenance/reload owns the DB; retry without resetting quota. */ }
      if (active && ticket === generation) timer = setTimeout(() => { void refresh(); }, delay);
    };
    const listener = AppState.addEventListener('change', state => {
      generation++; clearTimeout(timer); if (state === 'active') void refresh();
    });
    void refresh();
    return () => { active = false; generation++; clearTimeout(timer); listener.remove(); };
  }, [store]);
  if (restoring) return <View style={s.loading}><Text style={s.section}>{tr`正在安全還原…`}</Text><Text style={s.body}>{tr`請保持 App 開啟，完成後會重新載入資料。`}</Text></View>;
  if (error) return <View style={[s.loading, { alignItems: 'stretch' }]}><Text style={s.section}>{tr`未能開啟本機資料`}</Text><Text style={s.body}>{trMessage(error)}</Text><Button title={tr("重新嘗試")} onPress={() => { setError(''); setAttempt((v) => v + 1); }} /></View>;
  if (!store) return <Loading />;
  return <Context.Provider key={session} value={{ store, version, restoreData, restoreResult }}>{children}</Context.Provider>;
}
export function useApp() {
  const value = useContext(Context);
  if (!value) throw new Error('AppProvider is missing.');
  return value;
}
