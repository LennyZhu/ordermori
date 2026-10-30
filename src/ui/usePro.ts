import { useSyncExternalStore } from 'react';
import { proEntitlements } from '../data/proNative';
export function usePro() { return useSyncExternalStore(proEntitlements.subscribe, proEntitlements.getSnapshot); }
