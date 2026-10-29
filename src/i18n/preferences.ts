export type Locale = 'zh-HK' | 'en';
export type LanguagePreference = Locale | 'system';
export interface PreferenceStorage { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> }
export const LANGUAGE_KEY = 'ordermori.interface-language.v1';
export function isPreference(value: unknown): value is LanguagePreference { return value === 'system' || value === 'zh-HK' || value === 'en'; }
export function resolveSystemLocale(tags: readonly string[]): Locale {
  // Match the first system/app preference. Other languages deliberately fall
  // back to zh-HK, even if English appears later in the device's list.
  const tag = (tags[0] ?? '').toLowerCase().replace(/_/g, '-');
  return tag === 'en' || tag.startsWith('en-') ? 'en' : 'zh-HK';
}
export class LanguageController {
  preference: LanguagePreference = 'system';
  private systemLocale: Locale = 'zh-HK';
  private storage?: PreferenceStorage;
  private listeners = new Set<() => void>();
  private pending: Promise<void> = Promise.resolve();
  get locale(): Locale { return this.preference === 'system' ? this.systemLocale : this.preference; }
  snapshot = () => `${this.preference}:${this.locale}`;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit() { for (const listener of this.listeners) listener(); }
  setSystem(tags: readonly string[]) { const before = this.snapshot(); this.systemLocale = resolveSystemLocale(tags); if (before !== this.snapshot()) this.emit(); }
  async initialize(storage: PreferenceStorage, tags: readonly string[]) {
    const stored = await storage.getItem(LANGUAGE_KEY);
    this.storage = storage; this.systemLocale = resolveSystemLocale(tags);
    this.preference = isPreference(stored) ? stored : 'system'; this.emit();
  }
  select = (preference: LanguagePreference): Promise<void> => {
    if (!isPreference(preference)) return Promise.reject(new Error('Invalid language preference'));
    const task = this.pending.catch(() => undefined).then(async () => {
      if (!this.storage) throw new Error('Language storage not ready');
      await this.storage.setItem(LANGUAGE_KEY, preference);
      this.preference = preference; this.emit();
    });
    this.pending = task; return task;
  };
}
export const language = new LanguageController();
