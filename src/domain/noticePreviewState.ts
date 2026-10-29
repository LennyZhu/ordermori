import type { NoticeTemplate } from './notice.ts';
import { DomainError } from './model.ts';
export const noticeRenderIdentity = (d: { orderId: string; orderRevision: number; preferencesRevision: number; template: NoticeTemplate }): string => `${d.orderId}:${d.orderRevision}:${d.preferencesRevision}:${d.template}`;
export interface NoticePreviewImage { uri: string; width: number; height: number; captureMs: number; template: NoticeTemplate; identity: string }
export interface NoticePreviewState {
  phase: 'loading' | 'ready' | 'error'; generation: number; identity: string; template: NoticeTemplate;
  image: NoticePreviewImage | null; error: string; displayed: boolean; saved: boolean;
}
type Action = { type: 'retry' } | { type: 'ready'; generation: number; image: NoticePreviewImage } |
  { type: 'error'; generation: number; identity: string; error: string } | { type: 'displayed' | 'saved'; generation: number; identity: string };
export const initialNoticePreview = (identity: string, template: NoticeTemplate): NoticePreviewState => ({ phase: 'loading', generation: 1, identity, template, image: null, error: '', displayed: false, saved: false });
export function noticePreviewReducer(state: NoticePreviewState, action: Action): NoticePreviewState {
  if (action.type === 'retry') return { ...initialNoticePreview(state.identity, state.template), generation: state.generation + 1 };
  if (action.generation !== state.generation) return state;
  if ('identity' in action && action.identity !== state.identity) return state;
  if (action.type === 'error') return { ...state, phase: 'error', image: null, error: action.error, displayed: false, saved: false };
  if (action.type === 'ready') {
    if (action.image.template !== state.template || action.image.identity !== state.identity) return state;
    return { ...state, phase: 'ready', image: action.image, error: '', displayed: false, saved: false };
  }
  if (state.phase !== 'ready' || !state.image) return state;
  return action.type === 'displayed' ? { ...state, displayed: true } : { ...state, saved: true };
}
export function canSaveNoticePreview(state: NoticePreviewState, identity: string, template: NoticeTemplate): boolean {
  return state.phase === 'ready' && state.displayed && !state.saved && !!state.image && state.identity === identity && state.template === template && state.image.identity === identity && state.image.template === template;
}
let captureTail: Promise<unknown> = Promise.resolve();
export function withNoticeCaptureSlot<T>(work: () => Promise<T>): Promise<T> {
  const next = captureTail.then(work); captureTail = next.catch(() => undefined); return next;
}
export function withNoticeCaptureDeadline<T>(work: () => Promise<T>, disposeLate: (value: T) => Promise<void>, milliseconds = 30000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => { settled = true; reject(new DomainError('render', '擷取已超時，請重試。過期任務不會取代新預覽。')); }, milliseconds);
    void Promise.resolve().then(work).then((value) => {
      if (settled) { void disposeLate(value).catch(() => undefined); return; }
      settled = true; clearTimeout(timer); resolve(value);
    }, (cause: unknown) => { if (!settled) { settled = true; clearTimeout(timer); reject(cause); } });
  });
}
