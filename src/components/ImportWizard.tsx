import { useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { FileSpreadsheet } from 'lucide-react';
import type { ShareBase } from '../lib/calc';
import { db, type ImportSlot } from '../lib/db';
import { applyList, SHARE_BASE_LABEL, type ListResult, type ListRow } from '../lib/drugbank';
import { faNumber, fullMoney, faPercent, UNIT_LABEL, type Unit } from '../lib/format';
import { monthLabel } from '../lib/jalali';
import {
  balanceCheck, columnWarnings, commitRows, convertCell, detectMapping, guessColumns, headersOf, isSlotOpen, mapRows,
  readWorkbook, saveSlot, signatureOf, UnreadableFile, type Detected, type ImportField, type MappedRows, type SheetData,
  type SlotDef,
} from '../lib/import';
import { normalizeText } from '../lib/text';
import { Badge, Button, Segmented } from './ui/basics';
import { Drawer } from './ui/Drawer';
import { Field, MoreSettings, NumberField, SelectBox } from './ui/fields';
import { useToast } from './ui/Toast';
import { useUnit } from './SettingsContext';

interface Loaded {
  fileName: string;
  sheets: SheetData[];
}

interface Report {
  mapped: MappedRows;
  added: number;
  updated: number;
  list?: ListResult;
}

const SOURCE_NOTE: Record<Detected['source'], string> = {
  template: 'قالب ذخیره‌شدهٔ این فایل اعمال شد.',
  tamin: 'فارماکوپهٔ تأمین شناخته شد. سرستون‌های این فایل جابه‌جا هستند، پس ستون‌ها از روی داده تنظیم شده‌اند. مقدار ردیف اول هر فیلد را با چشم چک کنید.',
  salamat: 'فهرست بیمه سلامت شناخته شد. مبلغ سهم سازمان مستقیم از فایل خوانده می‌شود.',
  guess: 'ستون‌ها از روی نامشان حدس زده شده‌اند. مقدار ردیف اول هر فیلد را چک کنید.',
};

const MAIN_COVERAGE = new Set([
  'name', 'brandCode', 'genericCode', 'price', 'subsidy', 'shareRate', 'insurerAmount', 'coveredPrice', 'status',
]);

function showValue(field: ImportField, value: unknown, unit: Unit): string {
  if (value === undefined) return '—';
  if (field.type === 'money') return fullMoney(value as number, unit);
  if (field.type === 'percent') return faPercent(value as number, 3);
  if (field.type === 'number') return faNumber(value as number, 2);
  if (field.type === 'month') return monthLabel(value as string);
  return String(value);
}

function FieldRow({
  field,
  headers,
  column,
  sample,
  sampleOf,
  warning,
  moneyUnit,
  onChange,
}: {
  field: ImportField;
  headers: string[];
  column: number | undefined;
  sample: unknown;
  /** نمونهٔ دادهٔ هر ستون؛ در فایل‌هایی مثل تأمین سرستون قابل اعتماد نیست */
  sampleOf: (column: number) => string;
  warning?: string;
  moneyUnit: Unit;
  onChange: (column: number | undefined) => void;
}) {
  const unit = useUnit();
  const cell = column === undefined ? {} : convertCell(sample, field.type, moneyUnit);
  return (
    <Field
      label={field.required ? `${field.label} (ضروری)` : field.label}
      hint={
        column === undefined ? undefined : warning ? (
          <span className="text-bad">{warning}</span>
        ) : (
          <>ردیف اول: {cell.bad ? String(sample) : showValue(field, cell.value, unit)}</>
        )
      }
    >
      {(id) => (
        <SelectBox
          id={id}
          value={column === undefined ? '' : String(column)}
          onChange={(v) => onChange(v === '' ? undefined : Number(v))}
          options={[
            { value: '', label: 'انتخاب نشده' },
            ...headers.map((h, i) => ({ value: String(i), label: `ستون ${faNumber(i + 1)}: ${sampleOf(i)} (${h})` })),
          ]}
        />
      )}
    </Field>
  );
}

function RawPreview({
  rows,
  headerRow,
  onPick,
}: {
  rows: unknown[][];
  headerRow: number;
  onPick: (row: number) => void;
}) {
  const shown = rows.slice(0, 20);
  const width = Math.max(...shown.map((r) => r.length));
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full text-note">
        <tbody>
          {shown.map((row, i) => (
            <tr key={i} className={`border-b border-line last:border-0 ${i === headerRow ? 'bg-app font-medium' : ''}`}>
              <th scope="row" className="px-2 font-normal">
                <button
                  type="button"
                  aria-label={`ردیف ${faNumber(i + 1)} سرستون است`}
                  title="این ردیف سرستون است"
                  onClick={() => onPick(i)}
                  className={`min-h-8 min-w-8 ${i === headerRow ? 'text-primary' : 'text-muted'}`}
                >
                  {faNumber(i + 1)}
                </button>
              </th>
              {Array.from({ length: width }, (_, c) => (
                <td key={c} className="max-w-40 truncate px-2 py-1 whitespace-nowrap">
                  {normalizeText(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MappingStep({
  slot,
  saved,
  loaded,
  onClose,
  onReset,
  onDone,
}: {
  slot: SlotDef;
  saved?: ImportSlot;
  loaded: Loaded;
  onClose: () => void;
  onReset: () => void;
  onDone: (report: Report) => void;
}) {
  const toast = useToast();
  const [sheetIndex, setSheetIndex] = useState(0);
  const sheet = loaded.sheets[sheetIndex];
  const [detected, setDetected] = useState(() => detectMapping(slot, sheet.rows, saved?.templates));
  const [headerRow, setHeaderRow] = useState(detected.headerRow);
  const [columns, setColumns] = useState(detected.columns);
  const [moneyUnit, setMoneyUnit] = useState<Unit>(detected.moneyUnit);
  const [busy, setBusy] = useState(false);

  const isCoverage = slot.id === 'coverage';
  const insurers = useLiveQuery(() => db.insurers.toArray()) ?? [];
  const lists = useLiveQuery(() => db.priceLists.toArray()) ?? [];
  const [pickedInsurer, setPickedInsurer] = useState<string | null>(detected.insurerId ? String(detected.insurerId) : null);
  const hinted = detected.insurerHint ? insurers.find((i) => i.name.includes(detected.insurerHint!)) : undefined;
  const insurerId = pickedInsurer ?? (hinted ? String(hinted.id) : '');
  const currentList = lists.find((l) => String(l.insurerId) === insurerId);
  const [pickedBase, setPickedBase] = useState<ShareBase | null>(null);
  const shareBase = pickedBase ?? currentList?.shareBase ?? 'price';

  const headers = useMemo(() => headersOf(sheet.rows, headerRow), [sheet, headerRow]);
  const mapping = { columns, moneyUnit };
  const result = useMemo(
    () => mapRows(sheet.rows, headerRow, slot.fields, mapping),
    [sheet, headerRow, columns, moneyUnit],
  );
  const warnings = useMemo(
    () => columnWarnings(sheet.rows, headerRow, slot.fields, mapping),
    [sheet, headerRow, columns, moneyUnit],
  );
  const balance = isCoverage ? balanceCheck(result.records) : null;
  const firstRow = sheet.rows.slice(headerRow + 1).find((r) => r.some((c) => normalizeText(c) !== '')) ?? [];

  const sampleOf = (column: number) => normalizeText(firstRow[column]).slice(0, 24) || 'خالی';

  const open = isSlotOpen(slot);
  const missing = slot.fields.find((f) => f.required && columns[f.key] === undefined);
  const needsInsurer = isCoverage && insurerId === '';
  const hasMoney = slot.fields.some((f) => f.type === 'money');
  const main = slot.fields.filter((f) => !isCoverage || MAIN_COVERAGE.has(f.key));
  const extra = slot.fields.filter((f) => isCoverage && !MAIN_COVERAGE.has(f.key));

  const setColumn = (key: string) => (index: number | undefined) =>
    setColumns((c) => {
      const next = { ...c };
      if (index === undefined) delete next[key];
      else next[key] = index;
      return next;
    });

  const changeHeader = (row: number) => {
    setHeaderRow(row);
    if (detected.source === 'guess') setColumns(guessColumns(headersOf(sheet.rows, row), slot.fields));
  };

  const changeSheet = (index: number) => {
    const next = detectMapping(slot, loaded.sheets[index].rows, saved?.templates);
    setSheetIndex(index);
    setDetected(next);
    setHeaderRow(next.headerRow);
    setColumns(next.columns);
  };

  const finish = async () => {
    setBusy(true);
    const template = {
      signature: signatureOf(sheet.rows, headerRow),
      headerRow,
      columns,
      moneyUnit,
      insurerId: isCoverage ? Number(insurerId) : undefined,
    };
    try {
      if (!open) {
        await saveSlot(slot, { status: 'mapped' }, template);
        toast('نگاشت ستون‌ها ذخیره شد');
        onClose();
        return;
      }
      const report: Report = { mapped: result, added: 0, updated: 0 };
      if (isCoverage || slot.id === 'drugs') {
        const list = await applyList(
          isCoverage ? Number(insurerId) : null,
          result.records as unknown as ListRow[],
          { fileName: loaded.fileName, shareBase },
        );
        Object.assign(report, { list, added: list.added, updated: list.updated });
      } else {
        Object.assign(report, await commitRows(slot, result.records));
      }
      await saveSlot(
        slot,
        { status: 'imported', lastImportAt: new Date().toISOString(), lastRowCount: report.added + report.updated },
        template,
      );
      onDone(report);
    } catch {
      toast('ذخیره انجام نشد. چیزی تغییر نکرد.', 'error');
      setBusy(false);
    }
  };

  return (
    <Drawer
      open
      wide
      onClose={onClose}
      title={slot.title}
      footer={
        <>
          <Button
            variant="primary"
            disabled={busy || Boolean(missing) || needsInsurer || (open && result.records.length === 0)}
            onClick={finish}
          >
            {busy ? 'در حال ورود…' : open ? `وارد کردن ${faNumber(result.records.length)} ردیف` : 'ذخیرهٔ نگاشت'}
          </Button>
          <Button variant="text" onClick={onReset}>
            انتخاب فایل دیگر
          </Button>
          {missing && <span className="text-note text-bad">ستون «{missing.label}» را انتخاب کنید.</span>}
          {!missing && needsInsurer && <span className="text-note text-bad">بیمهٔ این فهرست را انتخاب کنید.</span>}
        </>
      }
    >
      <p className="text-note text-muted">{loaded.fileName}</p>
      <p className="mt-2 mb-4 rounded-xl bg-app p-4 text-note">
        {!open ? `این بخش در مرحلهٔ ${faNumber(slot.stage)} فعال می‌شود. فعلاً فقط نگاشت ستون‌ها ذخیره می‌شود.` : SOURCE_NOTE[detected.source]}
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {isCoverage && (
          <>
            <Field label="این فهرست مال کدام بیمه است؟">
              {(id) => (
                <SelectBox
                  id={id}
                  value={insurerId}
                  onChange={setPickedInsurer}
                  options={[
                    { value: '', label: 'انتخاب کنید' },
                    ...insurers.map((i) => ({ value: String(i.id), label: i.name })),
                  ]}
                />
              )}
            </Field>
            {columns.insurerAmount === undefined && (
              <Field label="پایهٔ محاسبهٔ سهم" hint="بعداً هم در صفحهٔ بیمه‌ها قابل تغییر است.">
                {(id) => (
                  <SelectBox
                    id={id}
                    value={shareBase}
                    onChange={(v) => setPickedBase(v as ShareBase)}
                    options={Object.entries(SHARE_BASE_LABEL).map(([value, label]) => ({ value, label }))}
                  />
                )}
              </Field>
            )}
          </>
        )}
        {loaded.sheets.length > 1 && (
          <Field label="شیت">
            {(id) => (
              <SelectBox
                id={id}
                value={String(sheetIndex)}
                onChange={(v) => changeSheet(Number(v))}
                options={loaded.sheets.map((s, i) => ({ value: String(i), label: s.name }))}
              />
            )}
          </Field>
        )}
        <NumberField
          label="ردیف سرستون"
          hint="داده از ردیف بعد از این شروع می‌شود."
          value={headerRow + 1}
          onChange={(n) => changeHeader(Math.min(Math.max(Math.round(n) - 1, 0), sheet.rows.length - 1))}
        />
      </div>

      <h3 className="mt-6 mb-2 font-medium">۲۰ ردیف اول فایل</h3>
      <RawPreview rows={sheet.rows} headerRow={headerRow} onPick={changeHeader} />

      <h3 className="mt-6 mb-2 font-medium">نگاشت ستون‌ها</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        {main.map((field) => (
          <FieldRow
            key={field.key}
            field={field}
            headers={headers}
            column={columns[field.key]}
            sample={firstRow[columns[field.key]]}
            sampleOf={sampleOf}
            warning={warnings[field.key]}
            moneyUnit={moneyUnit}
            onChange={setColumn(field.key)}
          />
        ))}
      </div>

      {(extra.length > 0 || hasMoney) && (
        <div className="mt-4">
          <MoreSettings>
            <div className="grid gap-4 sm:grid-cols-2">
              {extra.map((field) => (
                <FieldRow
                  key={field.key}
                  field={field}
                  headers={headers}
                  column={columns[field.key]}
                  sample={firstRow[columns[field.key]]}
            sampleOf={sampleOf}
                  warning={warnings[field.key]}
                  moneyUnit={moneyUnit}
                  onChange={setColumn(field.key)}
                />
              ))}
            </div>
            {hasMoney && (
              <div>
                <p className="mb-1 text-note font-medium">واحد مبلغ در فایل</p>
                <Segmented<Unit>
                  label="واحد مبلغ در فایل"
                  value={moneyUnit}
                  onChange={setMoneyUnit}
                  options={[
                    { value: 'rial', label: UNIT_LABEL.rial },
                    { value: 'toman', label: UNIT_LABEL.toman },
                  ]}
                />
              </div>
            )}
          </MoreSettings>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-2 text-note text-muted">
        <Badge tone="good">{faNumber(result.records.length)} ردیف سالم</Badge>
        {result.issues.length > 0 && <Badge tone="warn">{faNumber(result.issues.length)} ردیف رد می‌شود</Badge>}
        {balance && (
          <Badge tone={balance.ok === balance.total ? 'good' : 'warn'}>
            قیمت − یارانه = جمع مورد قبول در {faNumber(balance.ok)} از {faNumber(balance.total)} ردیف
          </Badge>
        )}
      </div>
    </Drawer>
  );
}

function IssueList({ title, issues }: { title: string; issues: { row: number; message: string }[] }) {
  if (issues.length === 0) return null;
  return (
    <details className="mt-2">
      <summary className="flex min-h-11 items-center text-primary">{title}</summary>
      <ul className="text-note text-muted">
        {issues.slice(0, 200).map((issue, i) => (
          <li key={i} className="py-1">
            ردیف {faNumber(issue.row)}: {issue.message}
          </li>
        ))}
      </ul>
      {issues.length > 200 && <p className="text-note text-muted">و {faNumber(issues.length - 200)} ردیف دیگر.</p>}
    </details>
  );
}

function ReportStep({ slot, report, onClose }: { slot: SlotDef; report: Report; onClose: () => void }) {
  const { mapped, list } = report;
  const lines: [string, number][] = [
    ['ردیف تازه', report.added],
    ['ردیف به‌روز شد', report.updated],
    ['ردیف رد شد', mapped.issues.length],
  ];
  if (list) {
    lines.push(['داروی جدید در بانک', list.newDrugs], ['تغییر قیمت', list.priceChanged], ['نیاز به بررسی', list.review]);
    if (list.repeated) lines.push(['ردیف با کد و نام و دوز یکسان، یکی شد', list.repeated]);
    if (list.stale) lines.push(['دارو در این فایل نبود', list.stale]);
  }
  return (
    <Drawer
      open
      onClose={onClose}
      title={`گزارش ورود: ${slot.title}`}
      footer={
        <Button variant="primary" onClick={onClose}>
          بستن
        </Button>
      }
    >
      <dl>
        {lines.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 border-b border-line py-2">
            <dt className="text-muted">{label}</dt>
            <dd className="font-medium">{faNumber(value)}</dd>
          </div>
        ))}
      </dl>
      <IssueList title="ردیف‌های ردشده و دلیل هرکدام" issues={mapped.issues} />
      <IssueList title="ردیف‌هایی که یک خانه‌شان خوانده نشد" issues={mapped.notes} />
    </Drawer>
  );
}

export function ImportWizard({ slot, saved, onClose }: { slot: SlotDef; saved?: ImportSlot; onClose: () => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [report, setReport] = useState<Report | null>(null);

  const pick = async (file: File) => {
    try {
      const sheets = readWorkbook(await file.arrayBuffer(), file.name);
      if (sheets.length === 0) toast('این فایل خالی است.', 'error');
      else setLoaded({ fileName: file.name, sheets });
    } catch (error) {
      toast(error instanceof UnreadableFile ? error.message : 'این فایل خوانده نشد.', 'error');
    }
  };

  if (report) return <ReportStep slot={slot} report={report} onClose={onClose} />;

  if (loaded) {
    return (
      <MappingStep slot={slot} saved={saved} loaded={loaded} onClose={onClose} onReset={() => setLoaded(null)} onDone={setReport} />
    );
  }

  return (
    <Drawer open onClose={onClose} title={slot.title}>
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <span className="flex size-24 items-center justify-center rounded-full border border-line text-muted">
          <FileSpreadsheet size={40} strokeWidth={1.25} aria-hidden />
        </span>
        <p className="text-muted">{slot.hint}</p>
        <Button variant="primary" onClick={() => input.current?.click()}>
          انتخاب فایل
        </Button>
        <p className="text-note text-muted">اکسل (xlsx، xls) یا CSV</p>
        <input
          ref={input}
          type="file"
          accept=".xlsx,.xls,.csv"
          aria-label="فایل ورودی"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) pick(file);
            e.target.value = '';
          }}
        />
      </div>
    </Drawer>
  );
}
