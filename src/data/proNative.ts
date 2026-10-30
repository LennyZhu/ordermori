import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { DomainError } from '../domain/model';
import { PRO_PRODUCT_ID, ProEntitlementService, proMessage } from '../domain/pro';
import type { StoreKitPort, StoreProof } from '../domain/pro';
import { checkedStoreProof } from '../domain/storeProof';
import type { Purchase, PurchaseIOS } from 'expo-iap';

type Iap = typeof import('expo-iap');
let api: Iap;
const bundle = Constants.expoConfig?.ios?.bundleIdentifier;
function proof(purchase: Purchase) {
  if (purchase.store !== 'apple' || !bundle || !purchase.purchaseToken || purchase.purchaseState !== 'purchased') throw new DomainError('pro_verification', proMessage.verification);
  const result = checkedStoreProof(purchase.purchaseToken, bundle, __DEV__);
  if (purchase.productId !== result.productId || purchase.id !== result.transactionId) throw new DomainError('pro_verification', proMessage.verification);
  return result;
}
const adapter: StoreKitPort = {
  async connect(changed) {
    if (Platform.OS !== 'ios') throw new DomainError('pro_build', proMessage.build);
    try { api = await import('expo-iap'); }
    catch { throw new DomainError('pro_build', proMessage.build); }
    // Register before connecting. Events only trigger native re-verification.
    const updated = api.purchaseUpdatedListener(() => changed());
    const errors = api.purchaseErrorListener(() => changed());
    try { if (!await api.initConnection()) throw new Error('connection'); }
    catch (error) { updated.remove(); errors.remove(); throw error; }
  },
  async product() {
    const products = await api.fetchProducts({ skus: [PRO_PRODUCT_ID], type: 'in-app' });
    const item = products?.find(p => p.id === PRO_PRODUCT_ID);
    if (!item || item.platform !== 'ios' || item.type !== 'in-app' || item.typeIOS !== 'non-consumable') return null;
    return { id: item.id, title: item.title, displayPrice: item.displayPrice, currency: item.currency };
  },
  async evidence() {
    // OpenIAP 4.0.5 checks EVERY Transaction.currentEntitlements result with
    // checkVerified before returning. It uses the OS cache without catalog I/O.
    const purchases = await api.getAvailablePurchases({ onlyIncludeActiveItemsIOS: true, alsoPublishToEventListenerIOS: false });
    const active = purchases.find(p => p.productId === PRO_PRODUCT_ID);
    if (active) {
      const verified = proof(active);
      if (verified.revoked) throw new DomainError('pro_verification', proMessage.verification);
      return { kind: 'active', proof: verified };
    }
    // Latest is also locally verified, but may be revoked. Never grant from
    // latest alone: active membership is required above.
    const latest = await api.verifyPurchase({ apple: { sku: PRO_PRODUCT_ID } });
    if (!('jwsRepresentation' in latest)) throw new DomainError('pro_verification', proMessage.verification);
    if (!latest.isValid) {
      if (!latest.jwsRepresentation && !latest.latestTransaction) return { kind: 'absent' };
      throw new DomainError('pro_verification', proMessage.verification);
    }
    const verified = checkedStoreProof(latest.jwsRepresentation, bundle ?? '', __DEV__);
    if (verified.revoked) return { kind: 'revoked', proof: verified };
    throw new DomainError('pro_unavailable', proMessage.unavailable);
  },
  async purchase() {
    const result = await api.requestPurchase({ type: 'in-app', request: { apple: { sku: PRO_PRODUCT_ID, andDangerouslyFinishTransactionAutomatically: false } } });
    const items = Array.isArray(result) ? result : result ? [result] : [];
    return items.some(p => p.purchaseState === 'pending') ? 'pending' : 'submitted';
  },
  async sync() { await api.syncIOS(); },
  async finish(verified: StoreProof) {
    // Unfinished enumeration also checkVerified in native code. No raw event
    // object is used as evidence or passed to transaction completion.
    const pending: PurchaseIOS[] = await api.getPendingTransactionsIOS();
    for (const item of pending) if (item.productId === verified.productId && item.id === verified.transactionId) {
      if (proof(item).revoked) continue;
      await api.finishTransaction({ purchase: item, isConsumable: false });
    }
  },
};
export const proEntitlements = new ProEntitlementService(adapter);
