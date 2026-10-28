import { MIGRATIONS, SCHEMA_VERSION } from './migrations.ts';
import { DomainError, FREE_LIMIT, blankInput, countChars, editable, evaluate, transition } from '../domain/model.ts';
import type { Action, Draft, Filter, History, HomeData, Order, OrderDetail, OrderInput, OrderItem, Shop } from '../domain/model.ts';

type Binding = string | number | null;
export interface DatabasePort {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: Binding[]): Promise<{ changes: number }>;
  first<T>(sql: string, params?: Binding[]): Promise<T | null>;
  all<T>(sql: string, params?: Binding[]): Promise<T[]>;
}
interface State { active_shop_id: string; created_count: number; order_number_seq: number }
interface DraftRow { shop_id: string; request_id: string; edit_seq: number; payload: string; is_active: number }

export class OrderStore {
  private tail: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  private db: DatabasePort;
  private newId: () => string;
  private now: () => string;
  constructor(db: DatabasePort, newId: () => string, now: () => string = () => new Date().toISOString()) {
    this.db = db; this.newId = newId; this.now = now;
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit() { this.listeners.forEach((listener) => listener()); }
  // This private connection is never exposed: ALL reads and writes enter this queue.
  // No asynchronous query can accidentally enter another operation's transaction.
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.catch(() => undefined);
    return result;
  }
  private async atomic<T>(work: () => Promise<T>): Promise<T> {
    await this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = await work();
      await this.db.exec('COMMIT');
      return result;
    } catch (error) {
      await this.db.exec('ROLLBACK');
      throw error;
    }
  }
  private async state() {
    const state = await this.db.first<State>('SELECT * FROM app_state WHERE id=1');
    if (!state) throw new DomainError('data', '本機檔案設定不完整，未清除任何資料。');
    return state;
  }
  async initialize() {
    return this.enqueue(async () => {
      await this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
      const version = (await this.db.first<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;
      if (version > SCHEMA_VERSION) throw new DomainError('version', '此資料由較新版本建立，請更新 App；不會重建或刪除資料。');
      await this.atomic(async () => {
        for (const migration of MIGRATIONS) if (migration.version > version) {
          await this.db.exec(migration.sql);
          await this.db.exec(`PRAGMA user_version=${migration.version}`);
        }
        if (!await this.db.first('SELECT id FROM app_state WHERE id=1')) {
          if (version !== 0) throw new DomainError('data', '既有本機檔案設定缺失；不會重設店舖或免費額度。');
          const shopId = this.newId();
          await this.db.run('INSERT INTO shops(id,name,description,updated_at) VALUES(?,?,?,?)', [shopId, '', '', this.now()]);
          await this.db.run('INSERT INTO app_state(id,profile_id,active_shop_id) VALUES(1,?,?)', [this.newId(), shopId]);
        }
      });
    });
  }
  async getShop() {
    return this.enqueue(async () => {
      const state = await this.state();
      return (await this.db.first<Shop>('SELECT * FROM shops WHERE id=?', [state.active_shop_id]))!;
    });
  }
  async saveShop(name: string, description: string) {
    if (!name.trim() || countChars(name.trim()) > 80) throw new DomainError('validation', '請填寫 1 至 80 個字符的店舖名稱。');
    if (countChars(description) > 500) throw new DomainError('validation', '店舖簡介最多 500 個字符。');
    return this.enqueue(async () => {
      const state = await this.state();
      await this.db.run('UPDATE shops SET name=?,description=?,updated_at=? WHERE id=?', [name.trim(), description, this.now(), state.active_shop_id]);
      this.emit();
    });
  }
  async getHome(search = '', filter: Filter = 'all'): Promise<HomeData> {
    return this.enqueue(async () => {
      const state = await this.state();
      const clauses: Record<Filter, string> = {
        all: '1=1', unpaid: "order_status='active' AND payment_status='unpaid' AND fulfillment_status='pending'",
        fulfillment: "order_status='active' AND payment_status='paid' AND fulfillment_status='pending'",
        completed: "order_status='active' AND payment_status='paid' AND fulfillment_status!='pending'",
        refunded: "payment_status='refunded'", cancelled: "order_status='cancelled'",
      };
      const escaped = search.trim().replace(/[\\%_]/g, '\\$&');
      const orders = await this.db.all<Order>(`SELECT * FROM orders WHERE shop_id=? AND (${clauses[filter]}) AND (buyer_identifier LIKE ? ESCAPE '\\' OR order_number LIKE ? ESCAPE '\\') ORDER BY created_at DESC,order_number DESC`, [state.active_shop_id, `%${escaped}%`, `%${escaped}%`]);
      const counts = await this.db.first<{ unpaid: number; fulfillment: number }>(`SELECT
        COALESCE(SUM(CASE WHEN order_status='active' AND payment_status='unpaid' AND fulfillment_status='pending' THEN 1 ELSE 0 END),0) AS unpaid,
        COALESCE(SUM(CASE WHEN order_status='active' AND payment_status='paid' AND fulfillment_status='pending' THEN 1 ELSE 0 END),0) AS fulfillment
        FROM orders WHERE shop_id=?`, [state.active_shop_id]);
      return { orders, unpaid: counts!.unpaid, fulfillment: counts!.fulfillment, createdCount: state.created_count,
        hasDraft: !!await this.db.first('SELECT id FROM drafts WHERE id=1 AND is_active=1 AND shop_id=?', [state.active_shop_id]),
        shop: (await this.db.first<Shop>('SELECT * FROM shops WHERE id=?', [state.active_shop_id]))! };
    });
  }
  // Read-only homepage projection; never opens, creates or updates a draft.
  async getDraftInput(): Promise<OrderInput | null> {
    return this.enqueue(async () => {
      const state = await this.state();
      const row = await this.db.first<DraftRow>('SELECT * FROM drafts WHERE id=1 AND is_active=1 AND shop_id=?', [state.active_shop_id]);
      if (!row) return null;
      const parsed = JSON.parse(row.payload) as { version: number; input: OrderInput };
      if (parsed.version !== 1 || !Array.isArray(parsed.input?.items)) throw new DomainError('draft', '草稿格式不支援，未覆寫原資料。');
      return parsed.input;
    });
  }
  async openDraft(): Promise<Draft> {
    return this.enqueue(async () => this.atomic(async () => {
      const state = await this.state();
      const row = await this.db.first<DraftRow>('SELECT * FROM drafts WHERE id=1 AND is_active=1');
      if (row) {
        if (row.shop_id !== state.active_shop_id) throw new DomainError('shop', '草稿店舖歸屬不一致。');
        const parsed = JSON.parse(row.payload) as { version: number; input: OrderInput };
        if (parsed.version !== 1 || !Array.isArray(parsed.input?.items)) throw new DomainError('draft', '草稿格式不支援，未覆寫原資料。');
        return { requestId: row.request_id, shopId: row.shop_id, editSeq: row.edit_seq, input: parsed.input };
      }
      if (state.created_count >= FREE_LIMIT) throw new DomainError('quota', 'Free 累計 10 張訂單已用完。Pro 購買尚未開放，已有訂單仍可管理。');
      const draft = { requestId: this.newId(), shopId: state.active_shop_id, editSeq: 0, input: blankInput(this.newId()) };
      await this.db.run(`INSERT INTO drafts(id,shop_id,request_id,edit_seq,payload,is_active,updated_at) VALUES(1,?,?,0,?,1,?)
        ON CONFLICT(id) DO UPDATE SET shop_id=excluded.shop_id,request_id=excluded.request_id,edit_seq=0,payload=excluded.payload,is_active=1,updated_at=excluded.updated_at`,
      [draft.shopId, draft.requestId, JSON.stringify({ version: 1, input: draft.input }), this.now()]);
      this.emit(); return draft;
    }));
  }
  async saveDraft(requestId: string, editSeq: number, input: OrderInput) {
    return this.enqueue(async () => {
      const state = await this.state();
      const result = await this.db.run('UPDATE drafts SET payload=?,edit_seq=?,updated_at=? WHERE id=1 AND request_id=? AND shop_id=? AND is_active=1 AND edit_seq<=?',
        [JSON.stringify({ version: 1, input }), editSeq, this.now(), requestId, state.active_shop_id, editSeq]);
      if (result.changes) this.emit();
      return result.changes > 0;
    });
  }
  async discardDraft(requestId: string) {
    return this.enqueue(async () => {
      await this.db.run('UPDATE drafts SET is_active=0 WHERE id=1 AND request_id=?', [requestId]); this.emit();
    });
  }
  private async insertItems(orderId: string, shopId: string, input: ReturnType<typeof evaluate>) {
    for (const [position, item] of input.items.entries()) await this.db.run(`INSERT INTO order_items(id,order_id,shop_id,position,name_snapshot,quantity,unit_price_cents,line_total_cents) VALUES(?,?,?,?,?,?,?,?)`,
      [this.newId(), orderId, shopId, position, item.name, item.quantity, item.price, item.lineTotal]);
  }
  async createOrder(requestId: string, input: OrderInput): Promise<string> {
    return this.enqueue(async () => {
      const id = await this.atomic(async () => {
        const state = await this.state();
        const existing = await this.db.first<Order>('SELECT * FROM orders WHERE creation_request_id=? AND shop_id=?', [requestId, state.active_shop_id]);
        if (existing) return existing.id;
        const active = await this.db.first<DraftRow>('SELECT * FROM drafts WHERE id=1 AND is_active=1 AND request_id=? AND shop_id=?', [requestId, state.active_shop_id]);
        if (!active) throw new DomainError('draft', '草稿已轉換或關閉，請返回訂單列表。');
        const values = evaluate(input);
        if (state.created_count >= FREE_LIMIT) throw new DomainError('quota', 'Free 累計 10 張訂單已用完；未建立或扣除任何新訂單。');
        const ordinal = state.order_number_seq + 1;
        if (!Number.isSafeInteger(ordinal)) throw new DomainError('number', '訂單編號已超出安全範圍。');
        const orderId = this.newId(); const now = this.now();
        const shop = (await this.db.first<Shop>('SELECT * FROM shops WHERE id=?', [state.active_shop_id]))!;
        await this.db.run(`INSERT INTO orders(id,shop_id,order_number,creation_request_id,buyer_identifier,shop_name_snapshot,shop_description_snapshot,
          order_status,payment_status,fulfillment_status,shipping_method,subtotal_cents,discount_cents,shipping_cents,total_cents,note,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,'active','unpaid','pending',?,?,?,?,?,?,?,?)`,
        [orderId, shop.id, `OM-${String(ordinal).padStart(6, '0')}`, requestId, values.buyer, shop.name, shop.description,
          values.shippingMethod, values.subtotal, values.discount, values.shipping, values.total, values.note, now, now]);
        await this.insertItems(orderId, shop.id, values);
        await this.db.run('INSERT INTO creation_ledger(event_id,order_id,allocated_number,created_at) VALUES(?,?,?,?)', [this.newId(), orderId, ordinal, now]);
        await this.db.run("INSERT INTO status_history(id,order_id,shop_id,axis,from_value,to_value,reason,recorded_at) VALUES(?,?,?,'order','draft','active','明確儲存建立訂單',?)", [this.newId(), orderId, shop.id, now]);
        await this.db.run('UPDATE app_state SET created_count=created_count+1,order_number_seq=? WHERE id=1', [ordinal]);
        await this.db.run('UPDATE drafts SET is_active=0 WHERE id=1 AND request_id=?', [requestId]);
        return orderId;
      });
      this.emit(); return id;
    });
  }
  private async ownedOrder(id: string) {
    const state = await this.state();
    const order = await this.db.first<Order>('SELECT * FROM orders WHERE id=? AND shop_id=?', [id, state.active_shop_id]);
    if (!order) throw new DomainError('missing', '找不到此訂單，未變更任何資料。');
    return order;
  }
  async getOrder(id: string): Promise<OrderDetail> {
    return this.enqueue(async () => {
      const order = await this.ownedOrder(id);
      return { order, items: await this.db.all<OrderItem>('SELECT * FROM order_items WHERE order_id=? AND shop_id=? ORDER BY position', [id, order.shop_id]),
        history: await this.db.all<History>('SELECT * FROM status_history WHERE order_id=? AND shop_id=? ORDER BY recorded_at,rowid', [id, order.shop_id]) };
    });
  }
  async updateOrder(id: string, revision: number, input: OrderInput) {
    return this.enqueue(async () => {
      await this.atomic(async () => {
        const old = await this.ownedOrder(id);
        if (old.revision !== revision) throw new DomainError('conflict', '訂單已更新，請返回詳情重新開啟。');
        if (!editable(old)) throw new DomainError('locked', '此訂單金額及對外資料已鎖定，不能覆寫。');
        const v = evaluate(input);
        await this.db.run(`UPDATE orders SET buyer_identifier=?,shipping_method=?,subtotal_cents=?,discount_cents=?,shipping_cents=?,total_cents=?,note=?,updated_at=?,revision=revision+1 WHERE id=?`,
          [v.buyer, v.shippingMethod, v.subtotal, v.discount, v.shipping, v.total, v.note, this.now(), id]);
        await this.db.run('DELETE FROM order_items WHERE order_id=?', [id]);
        await this.insertItems(id, old.shop_id, v);
      });
      this.emit();
    });
  }
  async changeStatus(id: string, revision: number, action: Action, reason: string) {
    return this.enqueue(async () => {
      await this.atomic(async () => {
        const order = await this.ownedOrder(id);
        if (order.revision !== revision) throw new DomainError('conflict', '訂單已更新，請重新核對狀態。');
        const event = transition(order, action, reason, this.now()); const n = event.next;
        await this.db.run(`UPDATE orders SET order_status=?,payment_status=?,fulfillment_status=?,financial_locked_at=?,paid_at=?,refunded_at=?,refunded_amount_cents=?,fulfilled_at=?,cancelled_at=?,updated_at=?,revision=? WHERE id=?`,
          [n.order_status, n.payment_status, n.fulfillment_status, n.financial_locked_at, n.paid_at, n.refunded_at, n.refunded_amount_cents, n.fulfilled_at, n.cancelled_at, n.updated_at, n.revision, id]);
        await this.db.run('INSERT INTO status_history(id,order_id,shop_id,axis,from_value,to_value,reason,recorded_at) VALUES(?,?,?,?,?,?,?,?)',
          [this.newId(), id, order.shop_id, event.axis, event.from, event.to, reason.trim(), n.updated_at]);
      });
      this.emit();
    });
  }
}
