import { backupDatabaseAsync, openDatabaseAsync } from 'expo-sqlite';
import { randomUUID } from 'expo-crypto';
import { OrderStore } from './store';
import { verifyPaymentAsset } from './paymentFiles';
import { setMediaGeneration, businessMediaRoot } from './mediaRoot';
import { DomainError } from '../domain/model';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { DatabasePort } from './store';

export function databasePort(database: SQLiteDatabase): DatabasePort {
  return {
    exec: (sql) => database.execAsync(sql),
    run: (sql, params = []) => database.runAsync(sql, params),
    first: <T>(sql: string, params: (string | number | null)[] = []) => database.getFirstAsync<T>(sql, params),
    all: <T>(sql: string, params: (string | number | null)[] = []) => database.getAllAsync<T>(sql, params),
  };
}
let connection: SQLiteDatabase | undefined;

let pending: Promise<OrderStore> | undefined;
export function openStore(): Promise<OrderStore> {
  pending ??= (async () => {
    const database = await openDatabaseAsync('ordermori.db');
    const store = new OrderStore(databasePort(database), randomUUID, undefined, verifyPaymentAsset);
    try {
      await store.initialize();
      const state = await database.getFirstAsync<{ media_generation: string }>('SELECT media_generation FROM backup_state WHERE id=1');
      if (!state) throw new Error('Missing backup state');
      setMediaGeneration(state.media_generation);
      if (state.media_generation && !businessMediaRoot().exists) throw new DomainError('backup', '已還原圖片目錄無法讀取；請保留資料並重試，App 不會建立空白檔案。');
      connection = database; return store;
    }
    catch (error) { await database.closeAsync(); throw error; }
  })().catch((error: unknown) => { pending = undefined; throw error; });
  return pending;
}

// Caller holds OrderStore.maintenance: SQLite Online Backup includes WAL pages.
export async function snapshotDatabase(destination: SQLiteDatabase) {
  if (!connection) throw new Error('No active database');
  await backupDatabaseAsync({ sourceDatabase: connection, destDatabase: destination });
}
export async function reopenStore() {
  if (connection) await connection.closeAsync();
  connection = undefined; pending = undefined;
  return openStore();
}
