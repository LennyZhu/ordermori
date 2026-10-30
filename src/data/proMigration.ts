// v10 stores only PNG presentation intent and file identity, never Apple rights.
export const PRO_NOTICE_MIGRATION = { version: 10, sql: `
ALTER TABLE notice_preferences ADD COLUMN hide_branding INTEGER NOT NULL DEFAULT 0 CHECK(hide_branding IN (0,1));
ALTER TABLE notice_files ADD COLUMN branding TEXT NOT NULL DEFAULT 'Made with OrderMori' CHECK(branding IN ('','Made with OrderMori'));
` };
