import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { View, Text } from 'react-native';
import { openStore } from './data/native';
import type { OrderStore } from './data/store';
import { errorMessage } from './domain/model';
import { Button, Loading, s } from './ui/common';

const Context = createContext<{ store: OrderStore; version: number } | null>(null);
export function AppProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<OrderStore | null>(null);
  const [version, setVersion] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    openStore().then((value) => { if (active) setStore(value); }).catch((cause: unknown) => { if (active) setError(errorMessage(cause)); });
    return () => { active = false; };
  }, [attempt]);
  useEffect(() => store?.subscribe(() => setVersion((value) => value + 1)), [store]);
  if (error) return <View style={[s.loading, { alignItems: 'stretch' }]}><Text style={s.section}>未能開啟本機資料</Text><Text style={s.body}>{error}</Text><Button title="重新嘗試" onPress={() => { setError(''); setAttempt((v) => v + 1); }} /></View>;
  if (!store) return <Loading />;
  return <Context.Provider value={{ store, version }}>{children}</Context.Provider>;
}
export function useApp() {
  const value = useContext(Context);
  if (!value) throw new Error('AppProvider is missing.');
  return value;
}
