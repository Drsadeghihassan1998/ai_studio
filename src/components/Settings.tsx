import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { backupFileName, checkBackup, exportAll, restoreAll, type BackupFile } from '../lib/backup';
import { db, updateSettings, type Settings as SettingsRow, type Theme } from '../lib/db';
import { faDate, faNumber } from '../lib/format';
import { addSamples, clearSamples, countSamples } from '../lib/sample';
import { Button, Card, CardTitle, ConfirmButton, PageHeader, Segmented } from './ui/basics';
import { MoneyField, MonthField, MoreSettings, NumberField, PercentField } from './ui/fields';
import { useToast } from './ui/Toast';
import { useSettings } from './SettingsContext';
import { FixedCosts } from './FixedCosts';

type Draft = Pick<
  SettingsRow,
  'openingCash' | 'monthlyRate' | 'technicalFee' | 'technicalFeeInsurerShare' | 'startMonth' | 'workDaysPerMonth' | 'minSafeCash'
  | 'defaultMarginRate'
>;

const pickDraft = (s: SettingsRow): Draft => ({
  openingCash: s.openingCash,
  monthlyRate: s.monthlyRate,
  technicalFee: s.technicalFee,
  technicalFeeInsurerShare: s.technicalFeeInsurerShare,
  startMonth: s.startMonth,
  workDaysPerMonth: s.workDaysPerMonth,
  minSafeCash: s.minSafeCash,
  defaultMarginRate: s.defaultMarginRate ?? 0.18,
});

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function BackupCard({ onRestored }: { onRestored: () => void }) {
  const settings = useSettings();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ backup: BackupFile; rows: number } | null>(null);

  const backup = async () => {
    download(backupFileName(), JSON.stringify(await exportAll()));
    await updateSettings({ lastBackupAt: new Date().toISOString() });
    toast('فایل پشتیبان ذخیره شد');
  };

  const pick = async (file: File) => {
    const check = checkBackup(await file.text());
    if (check.ok) setPending(check);
    else toast(check.message, 'error');
  };

  const restore = async () => {
    if (!pending) return;
    await restoreAll(pending.backup);
    setPending(null);
    onRestored();
    toast('داده‌ها از پشتیبان بازیابی شد');
  };

  return (
    <Card>
      <CardTitle
        note={
          settings.lastBackupAt
            ? `آخرین پشتیبان: ${faDate(settings.lastBackupAt.slice(0, 10))}`
            : 'هنوز پشتیبانی نگرفته‌اید. داده‌ها فقط در همین مرورگر هستند.'
        }
      >
        پشتیبان
      </CardTitle>
      <div className="flex flex-wrap gap-2">
        <Button onClick={backup}>پشتیبان‌گیری</Button>
        <Button onClick={() => input.current?.click()}>بازیابی از پشتیبان</Button>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          aria-label="فایل پشتیبان"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) pick(file);
            e.target.value = '';
          }}
        />
      </div>
      {pending && (
        <div className="mt-4 rounded-xl border border-line p-4">
          <p>
            این پشتیبان تاریخ {faDate(pending.backup.exportedAt.slice(0, 10))} و {faNumber(pending.rows)} ردیف داده دارد.
            همهٔ داده‌های فعلی با آن جایگزین می‌شود.
          </p>
          <div className="mt-2 flex gap-2">
            <Button variant="danger" onClick={restore}>
              جایگزین کن
            </Button>
            <Button variant="text" onClick={() => setPending(null)}>
              انصراف
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function SampleCard() {
  const toast = useToast();
  const count = useLiveQuery(countSamples) ?? 0;
  return (
    <Card>
      <CardTitle note="برای امتحان برنامه. ردیف‌ها برچسب «نمونه» دارند و دادهٔ شما را تغییر نمی‌دهند.">داده‌های نمونه</CardTitle>
      {count === 0 ? (
        <Button
          onClick={async () => {
            await addSamples();
            toast('داده‌های نمونه اضافه شد');
          }}
        >
          افزودن داده‌های نمونه
        </Button>
      ) : (
        <ConfirmButton
          label="پاک کردن داده‌های نمونه"
          question={`${faNumber(count)} ردیف نمونه پاک شود؟`}
          confirmLabel="پاک کن"
          onConfirm={async () => {
            await clearSamples();
            toast('داده‌های نمونه پاک شد');
          }}
        />
      )}
    </Card>
  );
}

export function Settings() {
  const settings = useSettings();
  const toast = useToast();
  const [draft, setDraft] = useState(() => pickDraft(settings));
  const dirty = JSON.stringify(draft) !== JSON.stringify(pickDraft(settings));
  const set = <K extends keyof Draft>(key: K) => (value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  return (
    <>
      <PageHeader
        title="تنظیمات"
        note="عددهای پایهٔ محاسبات، ظاهر برنامه و پشتیبان."
        action={
          <Button
            variant="primary"
            disabled={!dirty}
            onClick={async () => {
              await updateSettings(draft);
              toast('تنظیمات ذخیره شد');
            }}
          >
            ذخیرهٔ تنظیمات
          </Button>
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>عددهای پایه</CardTitle>
          <div className="grid gap-4">
            <MoneyField label="موجودی نقد اولیه" value={draft.openingCash} onChange={set('openingCash')} />
            <MoneyField
              label="حداقل موجودی نقد امن"
              hint="پایین‌تر از این مبلغ، برچسب «هشدار» نشان داده می‌شود."
              value={draft.minSafeCash}
              onChange={set('minSafeCash')}
            />
            <PercentField
              label="هزینهٔ پول (r) در ماه"
              hint="ارزش زمانی پول. اگر مطمئن نیستید، ۳٪ را نگه دارید."
              value={draft.monthlyRate}
              onChange={set('monthlyRate')}
            />
            <MoreSettings>
              <MonthField label="ماه شروع فعالیت" value={draft.startMonth} onChange={set('startMonth')} />
              <NumberField label="روز کاری ماه" suffix="روز" value={draft.workDaysPerMonth} onChange={set('workDaysPerMonth')} />
              <PercentField
                label="میانگین درصد سود"
                hint="برای پیش‌بینی پزشکان، وقتی سود واقعی قلم در دسترس نیست."
                value={draft.defaultMarginRate ?? 0.18}
                onChange={set('defaultMarginRate')}
              />
            </MoreSettings>
          </div>
        </Card>

        <div className="grid gap-4">
          <Card>
            <CardTitle>حق فنی</CardTitle>
            <div className="grid gap-4 sm:grid-cols-2">
              <MoneyField label="حق فنی هر نسخه" value={draft.technicalFee} onChange={set('technicalFee')} />
              <PercentField
                label="سهم بیمه از حق فنی"
                value={draft.technicalFeeInsurerShare}
                onChange={set('technicalFeeInsurerShare')}
              />
            </div>
          </Card>

          <Card>
            <CardTitle>ظاهر</CardTitle>
            <Segmented<Theme>
              label="حالت نمایش"
              value={settings.theme}
              onChange={(theme) => updateSettings({ theme })}
              options={[
                { value: 'light', label: 'روشن' },
                { value: 'dark', label: 'تاریک' },
              ]}
            />
          </Card>

          <FixedCosts />
          <BackupCard
            onRestored={async () => {
              const restored = await db.settings.get('main');
              if (restored) setDraft(pickDraft(restored));
            }}
          />
          <SampleCard />
        </div>
      </div>
    </>
  );
}
