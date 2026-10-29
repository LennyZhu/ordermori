import type { OrderInput } from '../domain/model.ts';

// Display-only: an automatically created blank draft is not unfinished work.
export function hasDraftInput(input: OrderInput | null): boolean {
  if (!input) return false;
  return Boolean(
    input.buyer.trim() || input.note.trim() || input.discount.trim() || input.paymentChosen ||
    input.shipping !== 'included' ||
    (input.shippingFee.trim() && input.shippingFee.trim() !== '0') ||
    input.items.some((item) => item.name.trim() || item.price.trim() || item.quantity.trim() !== '1')
  );
}
