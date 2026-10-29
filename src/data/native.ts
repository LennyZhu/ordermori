import { openDatabaseAsync } from 'expo-sqlite';
import { randomUUID } from 'expo-crypto';
import { OrderStore } from './store';
import { verifyPaymentAsset } from './paymentFiles';

let pending: Promise<OrderStore> | undefined;
export function openStore(): Promise<OrderStore> {
  pending ??= (async () => {
    const database = await openDatabaseAsync('ordermori.db');
    const store = new OrderStore({
      exec: (sql) => database.execAsync(sql),
      run: (sql, params = []) => database.runAsync(sql, params),
      first: <T>(sql: string, params: (string | number | null)[] = []) => database.getFirstAsync<T>(sql, params),
      all: <T>(sql: string, params: (string | number | null)[] = []) => database.getAllAsync<T>(sql, params),
    }, randomUUID, undefined, verifyPaymentAsset);
    try { await store.initialize(); return store; }
    catch (error) { await database.closeAsync(); throw error; }
  })().catch((error: unknown) => { pending = undefined; throw error; });
  return pending;
}
