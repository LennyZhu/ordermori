import type { Locale } from '../i18n/preferences';

export type LegalPage = 'privacy' | 'support';

// Use explicitly configured destinations. App language never rewrites a URL path.
export function legalPageUrl(config: unknown, page: LegalPage, locale: Locale): string | null {
  if (!config || typeof config !== 'object') return null;
  const key = page === 'privacy' ? 'privacyPolicyUrl' : 'supportUrl';
  const candidate: unknown = (config as Record<string, unknown>)[locale === 'en' ? `${key}En` : key];
  if (typeof candidate !== 'string') return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:' || url.username || url.password ||
      ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.hostname.includes('.')) return null;
    return url.href;
  } catch { return null; }
}
