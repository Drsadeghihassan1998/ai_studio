import { completeDrug, db, ensureDefaults, SCHEMA_VERSION, type Drug } from './db';
import { jalaliParts, todayISO } from './jalali';

// پشتیبان: یک فایل JSON شامل همهٔ جدول‌ها. بازیابی همهٔ داده‌های فعلی را با محتوای فایل جایگزین می‌کند.

const APP_ID = 'pharmacy-finance';

export interface BackupFile {
  app: string;
  schemaVersion: number;
  exportedAt: string;
  tables: Record<string, unknown[]>;
}

export async function exportAll(): Promise<BackupFile> {
  const tables: Record<string, unknown[]> = {};
  await db.transaction('r', db.tables, async () => {
    for (const table of db.tables) tables[table.name] = await table.toArray();
  });
  return { app: APP_ID, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), tables };
}

export function backupFileName(iso = todayISO()): string {
  const { y, m, d } = jalaliParts(iso);
  return `pharmacy-backup-${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}.json`;
}

export type BackupCheck =
  | { ok: true; backup: BackupFile; rows: number }
  | { ok: false; message: string };

/** فایل را قبل از هر تغییری بررسی می‌کند؛ تا این مرحله به داده‌ها دست نخورده است. */
export function checkBackup(text: string): BackupCheck {
  let data: Partial<BackupFile>;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, message: 'این فایل پشتیبان سالم نیست.' };
  }
  if (data?.app !== APP_ID || typeof data.tables !== 'object' || data.tables === null) {
    return { ok: false, message: 'این فایل، پشتیبان این برنامه نیست.' };
  }
  if (typeof data.schemaVersion !== 'number' || data.schemaVersion > SCHEMA_VERSION) {
    return { ok: false, message: 'این پشتیبان با نسخهٔ جدیدتری از برنامه ساخته شده است.' };
  }
  const known = new Set(db.tables.map((t) => t.name));
  let rows = 0;
  for (const [name, list] of Object.entries(data.tables)) {
    if (!known.has(name)) continue;
    if (!Array.isArray(list)) return { ok: false, message: 'ساختار فایل پشتیبان درست نیست.' };
    if (name !== 'settings' && name !== 'importSlots') rows += list.length;
  }
  if (!Array.isArray(data.tables.settings) || data.tables.settings.length === 0) {
    return { ok: false, message: 'تنظیمات در این فایل پشتیبان نیست.' };
  }
  return { ok: true, backup: data as BackupFile, rows };
}

export async function restoreAll(backup: BackupFile): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) {
      await table.clear();
      const rows = backup.tables[table.name];
      if (!rows?.length) continue;
      // پشتیبان نسخهٔ قدیمی‌تر فیلدهای جانبی دارو را ندارد.
      const ready = table.name === 'drugs' ? (rows as Drug[]).map(completeDrug) : rows;
      await table.bulkPut(ready as never[]);
    }
  });
  await ensureDefaults();
}
