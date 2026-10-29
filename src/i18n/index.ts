import { I18n } from 'i18n-js';
import { catalog } from './catalog.ts';
import { language } from './preferences.ts';
export { language } from './preferences.ts';
export type { Locale, LanguagePreference } from './preferences.ts';
const translations = { 'zh-HK': Object.fromEntries(catalog.map(m => [m.id, m.zh])), en: Object.fromEntries(catalog.map(m => [m.id, m.en])) };
const i18n = new I18n(translations, { defaultLocale: 'zh-HK', locale: 'zh-HK', enableFallback: true });
const bySource = new Map<string, string>(catalog.map(m => [m.zh, m.id]));
function render(source: string, values: Record<string, unknown> = {}) {
  const id = bySource.get(source);
  if (!id) return source.replace(/%\{(v\d+)\}/g, (_, key: string) => String(values[key] ?? ''));
  if (i18n.locale !== language.locale) i18n.locale = language.locale;
  return i18n.t(id, values);
}
// Explicitly invoked only for authored UI copy, never whole rendered screens or
// arbitrary user strings. Tagged interpolation keeps customer values verbatim.
export function tr(source: string | TemplateStringsArray, ...values: unknown[]): string {
  if (source == null) return '';
  if (typeof source === 'string') return render(source);
  return render(source.reduce((out, part, index) => out + (index ? `%{v${index - 1}}` : '') + part, ''), Object.fromEntries(values.map((v, i) => [`v${i}`, v])));
}
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patterns = catalog.filter(m => /%\{v\d+\}/.test(m.zh)).slice().sort((a, b) => b.zh.replace(/%\{v\d+\}/g, '').length - a.zh.replace(/%\{v\d+\}/g, '').length).map(m => {
  const keys = [...m.zh.matchAll(/%\{(v\d+)\}/g)].map(match => match[1]);
  return { source: m.zh, keys, regex: new RegExp('^' + m.zh.split(/%\{v\d+\}/).map(escape).join('([\\s\\S]*?)') + '$') };
});
// Domain errors stay canonical in data/business modules. Translate at the
// presentation boundary so a visible error also reacts to language changes.
export function trMessage(message: string): string {
  if (!message) return message;
  if (bySource.has(message)) return tr(message);
  for (const pattern of patterns) {
    const match = pattern.regex.exec(message);
    if (match) {
      const values = Object.fromEntries(pattern.keys.map((key, i) => [key, match[i + 1]]));
      if (['%{v0}資料已儲存。', '%{v0}已儲存，仍未完成設定。'].includes(pattern.source)) values.v0 = tr(values.v0);
      return render(pattern.source, values);
    }
  }
  const prefix = '草稿未能儲存。';
  if (message.startsWith(prefix)) return tr(prefix) + trMessage(message.slice(prefix.length));
  const suffix = ' 以下可能為上次讀取的資料。';
  if (message.endsWith(suffix)) return trMessage(message.slice(0, -suffix.length)) + tr(suffix);
  if (message.includes('\n')) return message.split('\n').map(trMessage).join('\n');
  return message;
}
const aliases = {
  orders:'訂單', shop:'我的店舖', newOrder:'新增訂單', saveOrder:'儲存訂單', saveChanges:'儲存修改',
  search:'搜尋買家或訂單編號', all:'全部', unpaid:'待付款', fulfillment:'待發貨', completed:'已完成',
  refunded:'已退款', cancelled:'已取消', retry:'重試', cancel:'取消', back:'返回',
  emptyTitle:'準備好開第一張單了嗎？', emptyBody:'填寫買家和商品，儲存後便可在這裡跟進收款與發貨。',
} as const;
export const t = (key: keyof typeof aliases) => tr(aliases[key]);
export const uiDate = (value: string, options?: Intl.DateTimeFormatOptions) => new Date(value).toLocaleString(language.locale === 'en' ? 'en-HK' : 'zh-HK', options);
