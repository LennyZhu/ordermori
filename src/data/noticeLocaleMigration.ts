// Keep the shipped v3 locale constraint and all lock/immutability triggers.
// New columns provide bilingual output without rebuilding historical tables.
export const NOTICE_LOCALE_MIGRATION = { version: 8, sql: `
ALTER TABLE notice_preferences ADD COLUMN output_locale TEXT NOT NULL DEFAULT 'zh-HK' CHECK(output_locale IN ('zh-HK','en'));
ALTER TABLE notice_files ADD COLUMN locale TEXT NOT NULL DEFAULT 'zh-HK' CHECK(locale IN ('zh-HK','en'));
` };
