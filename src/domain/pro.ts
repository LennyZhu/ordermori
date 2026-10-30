import { DomainError } from './model.ts';

export const PRO_PRODUCT_ID = 'ordermori.pro.lifetime';
export type ProStatus = 'checking' | 'free' | 'pro' | 'unavailable';
export interface StoreProof { transactionId: string; productId: string; environment: string }
export type StoreEvidence = { kind: 'active' | 'revoked'; proof: StoreProof } | { kind: 'absent' };
export interface ProProduct { id: string; displayPrice: string; title: string; currency: string }
export interface StoreKitPort {
  connect(changed: () => void): Promise<void>;
  product(): Promise<ProProduct | null>;
  evidence(): Promise<StoreEvidence>;
  purchase(): Promise<'submitted' | 'pending'>;
  sync(): Promise<void>;
  finish(proof: StoreProof): Promise<void>;
}
export interface ProGrant { readonly revision: number; readonly transactionId: string | null; readonly unlimited: boolean }
export interface EntitlementAccess {
  current(): ProGrant;
  refresh(): Promise<ProGrant>;
  assertCurrent(grant: ProGrant): void;
}
export const freeEntitlements: EntitlementAccess = {
  current: () => ({ revision: 0, transactionId: null, unlimited: false }),
  refresh: async () => freeEntitlements.current(),
  assertCurrent: () => undefined,
};
export const proMessage = {
  build: '此 Development Build 尚未包含內購模組，請重新構建後再試。',
  unavailable: '暫時無法確認 Apple 購買資料。已確認的離線權益不會因網絡中斷而到期，請稍後重試。',
  verification: 'Apple 交易未能通過驗證，未授予新的 Pro 權益。請重試或恢復購買。',
  product: 'Apple 商品目前無法載入，未顯示價格或發起購買。請檢查網絡及商店設定後重試。',
  cancelled: '已取消購買，未解鎖或變更訂單。',
  pending: '購買正等待 Apple 或家長批准，確認有效交易前不會解鎖。',
  unlocked: 'OrderMori Pro 已永久解鎖。',
  restored: '已恢復 OrderMori Pro。',
  none: '未找到可恢復的有效 Pro 購買，請確認目前的 Apple 購買帳戶。',
  failed: 'Apple 購買未能完成，請稍後重試。未授予新的權益。',
  restoreFailed: '未能完成恢復購買。請檢查網絡及 Apple 帳戶後重試。',
  revoked: 'Apple 已確認 Pro 權益不再有效。資料仍保留，新圖片將使用 Free 品牌署名。',
  finishing: 'Pro 已驗證，交易完成處理仍待重試；請稍後重新同步。',
};
export interface ProSnapshot {
  readonly status: ProStatus; readonly hasPro: boolean; readonly revision: number;
  readonly product: ProProduct | null; readonly productLoading: boolean;
  readonly operation: 'purchase' | 'restore' | null;
  readonly message: string; readonly tone: 'info' | 'error' | 'success';
}
const codeOf = (error: unknown) => error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
// Only a StoreKit adapter can produce evidence. No SQLite, backup, flag setter,
// expiration date or configurable production mock is part of this service.
export class ProEntitlementService implements EntitlementAccess {
  private proof: StoreProof | null = null;
  private suspended = false;
  private revision = 0;
  private connected: Promise<void> | undefined;
  private refreshing: Promise<ProGrant> | undefined;
  private refreshAgain = false;
  private loading: Promise<void> | undefined;
  private finished = new Set<string>();
  private listeners = new Set<() => void>();
  private snapshot: ProSnapshot = Object.freeze({ status: 'checking', hasPro: false, revision: 0, product: null, productLoading: false, operation: null, message: '', tone: 'info' });
  private adapter: StoreKitPort;
  constructor(adapter: StoreKitPort) { this.adapter = adapter; }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  current = (): ProGrant => ({ revision: this.revision, transactionId: this.proof?.transactionId ?? null, unlimited: !!this.proof && !this.suspended });
  assertCurrent(grant: ProGrant) {
    const now = this.current();
    if (now.revision !== grant.revision || now.unlimited !== grant.unlimited) throw new DomainError('pro_changed', '購買權益已改變，未建立或輸出過期內容，請重試。');
  }
  private publish(update: Partial<ProSnapshot>) {
    const grant = this.current();
    this.snapshot = Object.freeze({ ...this.snapshot, ...update, hasPro: grant.unlimited, revision: grant.revision });
    this.listeners.forEach(listener => listener());
  }
  private connect() {
    this.connected ??= this.adapter.connect(() => { if (this.refreshing) this.refreshAgain = true; else void this.refresh(); }).catch(error => { this.connected = undefined; throw error; });
    return this.connected;
  }
  async start() { await this.refresh(); }
  refresh = (): Promise<ProGrant> => {
    this.refreshing ??= this.read().finally(() => { this.refreshing = undefined; if (this.refreshAgain) { this.refreshAgain = false; void this.refresh(); } });
    return this.refreshing;
  };
  private async read(): Promise<ProGrant> {
    this.publish({ status: 'checking' });
    try {
      await this.connect();
      const result = await this.adapter.evidence();
      if (result.kind === 'active') {
        if (result.proof.productId !== PRO_PRODUCT_ID || !result.proof.transactionId) throw new DomainError('pro_verification', proMessage.verification);
        if (this.proof?.transactionId !== result.proof.transactionId || this.suspended) this.revision++;
        this.proof = Object.freeze({ ...result.proof }); this.suspended = false;
        this.publish({ status: 'pro' });
        if (!this.finished.has(this.proof.transactionId)) {
          try { await this.adapter.finish(this.proof); this.finished.add(this.proof.transactionId); }
          catch { this.publish({ message: proMessage.finishing, tone: 'info' }); }
        }
      } else if (result.kind === 'revoked') {
        if (result.proof.productId !== PRO_PRODUCT_ID || !result.proof.transactionId) throw new DomainError('pro_verification', proMessage.verification);
        const owned = !!this.proof; if (owned || this.suspended) this.revision++;
        this.proof = null; this.suspended = false;
        this.publish({ status: 'free', ...(owned ? { message: proMessage.revoked, tone: 'info' as const } : {}) });
      } else {
        // Adapter reports absence only after BOTH native currentEntitlements
        // and verified-latest lookup complete successfully without a purchase.
        if (this.proof || this.suspended) this.revision++;
        this.proof = null; this.suspended = false; this.publish({ status: 'free' });
      }
    } catch (error) {
      const code = codeOf(error), invalid = code === 'pro_verification' || code.includes('validation') || code.includes('verification');
      if (invalid && !this.suspended) { this.suspended = true; this.revision++; }
      this.publish({ status: 'unavailable', message: code === 'pro_build' ? proMessage.build : invalid ? proMessage.verification : proMessage.unavailable, tone: invalid ? 'error' : 'info' });
    }
    return this.current();
  }
  loadProduct(): Promise<void> {
    this.loading ??= (async () => {
      this.publish({ productLoading: true, product: null });
      try {
        await this.connect(); const product = await this.adapter.product();
        if (!product || product.id !== PRO_PRODUCT_ID || !product.displayPrice.trim() || !product.currency) throw new Error('unavailable');
        this.publish({ product: Object.freeze({ ...product }), message: '', tone: 'info' });
      } catch (error) { this.publish({ product: null, message: codeOf(error) === 'pro_build' ? proMessage.build : proMessage.product, tone: 'error' }); }
      finally { this.publish({ productLoading: false }); }
    })().finally(() => { this.loading = undefined; });
    return this.loading;
  }
  private async freshAfterStoreOperation() {
    // A foreground query started while the Apple sheet was open must not be
    // mistaken for the post-purchase/restore result.
    await this.refreshing; return this.refresh();
  }
  async purchase() {
    if (this.snapshot.operation || this.current().unlimited) return;
    this.publish({ operation: 'purchase', message: '', tone: 'info' });
    try {
      await this.connect(); if (!this.snapshot.product) await this.loadProduct();
      if (!this.snapshot.product) return;
      const outcome = await this.adapter.purchase(); await this.freshAfterStoreOperation();
      if (this.current().unlimited) this.publish({ message: proMessage.unlocked, tone: 'success' });
      else this.publish({ message: outcome === 'pending' ? proMessage.pending : proMessage.verification, tone: outcome === 'pending' ? 'info' : 'error' });
    } catch (error) {
      const code = codeOf(error);
      if (code === 'user-cancelled') this.publish({ message: proMessage.cancelled, tone: 'info' });
      else if (code === 'pending' || code === 'deferred-payment') this.publish({ message: proMessage.pending, tone: 'info' });
      else if (code === 'already-owned') { await this.freshAfterStoreOperation(); this.publish({ message: this.current().unlimited ? proMessage.unlocked : proMessage.verification, tone: this.current().unlimited ? 'success' : 'error' }); }
      else this.publish({ message: code === 'network-error' ? proMessage.unavailable : proMessage.failed, tone: 'error' });
    } finally { this.publish({ operation: null }); }
  }
  async restore() {
    if (this.snapshot.operation) return;
    this.publish({ operation: 'restore', message: '', tone: 'info' });
    try {
      await this.connect(); await this.adapter.sync(); await this.freshAfterStoreOperation();
      if (this.snapshot.status === 'unavailable') this.publish({ message: proMessage.verification, tone: 'error' });
      else this.publish({ message: this.current().unlimited ? proMessage.restored : proMessage.none, tone: this.current().unlimited ? 'success' : 'info' });
    } catch (error) { this.publish({ message: codeOf(error) === 'user-cancelled' ? proMessage.cancelled : proMessage.restoreFailed, tone: codeOf(error) === 'user-cancelled' ? 'info' : 'error' }); }
    finally { this.publish({ operation: null }); }
  }
}
