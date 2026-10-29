import { DomainError } from './model.ts';

interface ForegroundEvents {
  current(): string | null;
  subscribe(listener: (state: string) => void): () => void;
}

// An iOS permission promise can settle before the inactive -> active event.
// Wait for that event, not a guessed animation delay. Never resume background
// work; the bounded timeout only fails closed and releases listeners/the gate.
export function waitForPermissionForeground(events: ForegroundEvents, mounted: () => boolean, timeoutMs = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    let remove: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (allowed: boolean) => {
      if (done) return;
      done = true;
      remove?.();
      if (timer) clearTimeout(timer);
      if (allowed) resolve();
      else reject(new DomainError('notice_export_inactive', '請返回此頁後再匯出圖片。'));
    };
    const inspect = (state: string | null) => {
      if (!mounted() || state === 'background') finish(false);
      else if (state === 'active') finish(true);
    };
    remove = events.subscribe(inspect);
    if (done) remove();
    else {
      timer = setTimeout(() => finish(false), timeoutMs);
      inspect(events.current());
    }
  });
}
