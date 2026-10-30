import { DomainError } from './model.ts';
import { PRO_PRODUCT_ID, proMessage } from './pro.ts';
import type { StoreProof } from './pro.ts';

// This parser is only called on StoreKit's native .verified results. Decoding
// JWS is NOT signature verification; callback payloads must never call it.
export function checkedStoreProof(jws: string, bundle: string, development: boolean): StoreProof & { revoked: boolean } {
  try {
    const parts = jws.split('.');
    if (parts.length !== 3 || parts[1].length > 32768) throw new Error();
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let value = 0, bits = 0; const bytes: number[] = [];
    for (const char of parts[1].replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')) {
      const digit = alphabet.indexOf(char); if (digit < 0) throw new Error();
      value = (value << 6) | digit; bits += 6;
      if (bits >= 8) { bits -= 8; bytes.push((value >> bits) & 255); }
    }
    const data = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes)));
    if (data.productId !== PRO_PRODUCT_ID || data.bundleId !== bundle || data.type !== 'Non-Consumable' ||
      typeof data.transactionId !== 'string' || !data.transactionId || data.expiresDate != null ||
      !['Production', 'Sandbox', ...(development ? ['Xcode'] : [])].includes(data.environment) ||
      (data.revocationDate != null && (!Number.isFinite(data.revocationDate) || data.revocationDate <= 0))) throw new Error();
    return { transactionId: data.transactionId, productId: data.productId, environment: data.environment, revoked: data.revocationDate != null };
  } catch { throw new DomainError('pro_verification', proMessage.verification); }
}
