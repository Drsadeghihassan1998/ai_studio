import { useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowRight, Building2, ClipboardCopy, Download, FileSpreadsheet, FileText, FolderArchive,
  ImagePlus, Loader2, Plus, Search, Sparkles, Trash2, Upload,
} from 'lucide-react';
import { db, type Cheque, type Distributor, type Drug, type Invoice, type InvoiceItem } from '../lib/db';
import { fullDrugDose, fullDrugName } from '../lib/drugname';
import { faDate, faNumber } from '../lib/format';
import { deleteInvoice, emptyDraft, loadDraft, parseInvoiceJson, type DraftInvoice } from '../lib/invoice';
import { convertExcelBufferToInvoice } from '../lib/invoiceExcelImport';
import { exportDistributorArchiveToExcel, exportInvoiceToExcel } from '../lib/invoiceExport';
import { PAYMENT_TYPE_LABELS } from '../lib/invoiceExportLabels';
import { INVOICE_PROMPT } from '../lib/invoicePrompt';
import { EXCEL_INVOICE_PROMPT, SMART_JSON_INVOICE_PROMPT } from '../lib/invoiceSmartPrompt';
import { currentMonthKey, jalaliParts, monthKey } from '../lib/jalali';
import { matches, normalizeText } from '../lib/text';
import {
  Badge, Button, Card, ConfirmButton, EmptyState, KeyCard, PageHeader, PageSkeleton, SampleBadge, Segmented,
} from './ui/basics';
import { Drawer } from './ui/Drawer';
import { NumberField, PercentField, TextField } from './ui/fields';
import { Money } from './ui/Money';
import { useToast } from './ui/Toast';
import { InvoiceEditor } from './InvoiceEditor';

type MainTab = 'invoices' | 'distributors';
type ArchiveSubTab = 'invoices' | 'items' | 'cheques';

const monthOf = (iso: string) => {
  const { y, m } = jalaliParts(iso);
  return monthKey(y, m);
};

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

interface SelectedInvoiceFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('خواندن فایل ناموفق بود'));
    reader.readAsDataURL(file);
  });
}

function NewInvoice({
  defaultDistributor,
  onClose,
  onDraft,
}: {
  defaultDistributor?: string;
  onClose: () => void;
  onDraft: (draft: DraftInvoice) => void;
}) {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const excelInputRef = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<SelectedInvoiceFile[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [text, setText] = useState('');
  const [promptMode, setPromptMode] = useState<'excel' | 'smart_json' | 'basic'>('excel');
  const [errors, setErrors] = useState<string[]>([]);

  const applyDefaultDist = (draft: DraftInvoice): DraftInvoice => {
    if (defaultDistributor && !draft.distributor) {
      return { ...draft, distributor: defaultDistributor };
    }
    return draft;
  };

  const activePromptText =
    promptMode === 'excel'
      ? EXCEL_INVOICE_PROMPT
      : promptMode === 'smart_json'
        ? SMART_JSON_INVOICE_PROMPT
        : INVOICE_PROMPT;

  const handleExcelSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const file = fileList[0];
    setErrors([]);
    try {
      const buffer = await file.arrayBuffer();
      const converted = convertExcelBufferToInvoice(buffer);
      if (!converted.ok) {
        setErrors(converted.errors);
      } else {
        setText(converted.json);
        toast('فایل اکسل خوانده و به فاکتور تبدیل شد؛ سطرها را بازبینی کنید');
        onDraft(applyDefaultDist(converted.draft));
      }
    } catch {
      setErrors([`امکان خواندن فایل اکسل «${file.name}» وجود نداشت.`]);
    } finally {
      if (excelInputRef.current) excelInputRef.current.value = '';
    }
  };

  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setErrors([]);
    const added: SelectedInvoiceFile[] = [];
    for (const file of Array.from(fileList)) {
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv')) {
        await handleExcelSelected(fileList);
        return;
      }
      const mimeType = file.type || (lower.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');
      if (!mimeType.startsWith('image/') && mimeType !== 'application/pdf') {
        setErrors((prev) => [...prev, `فایل «${file.name}» باید اکسل، عکس یا PDF باشد.`]);
        continue;
      }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        added.push({
          id: `${Date.now()}-${Math.random()}`,
          name: file.name,
          mimeType,
          size: file.size,
          dataUrl,
        });
      } catch {
        setErrors((prev) => [...prev, `امکان خواندن فایل «${file.name}» وجود نداشت.`]);
      }
    }
    if (added.length > 0) {
      setFiles((prev) => [...prev, ...added]);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const extractAutomatically = async () => {
    if (files.length === 0) {
      setErrors(['لطفاً ابتدا عکس یا فایل PDF فاکتور را انتخاب کنید.']);
      return;
    }
    setExtracting(true);
    setErrors([]);
    try {
      const response = await fetch('/api/invoice/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: files.map((f) => ({
            name: f.name,
            mimeType: f.mimeType,
            data: f.dataUrl,
          })),
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { json?: string; error?: string };
      if (!response.ok || !payload.json) {
        setErrors([payload.error || 'استخراج خودکار انجام نشد. می‌توانید از بخش پایین پرامپت را کپی و خروجی اکسل یا JSON را وارد کنید.']);
        setExtracting(false);
        return;
      }
      setText(payload.json);
      const parsed = parseInvoiceJson(payload.json);
      if (parsed.ok) {
        toast('اطلاعات فاکتور استخراج شد؛ سطرها را بررسی و ذخیره کنید');
        onDraft(applyDefaultDist(parsed.draft));
      } else {
        setErrors(parsed.errors);
      }
    } catch {
      setErrors([
        'ارتباط با سرویس استخراج خودکار برقرار نشد (احتمالاً آفلاین هستید). می‌توانید در بخش پایین پرامپت را کپی و خروجی اکسل یا JSON را وارد کنید.',
      ]);
    } finally {
      setExtracting(false);
    }
  };

  const readManualJson = () => {
    const result = parseInvoiceJson(text);
    if (result.ok) onDraft(applyDefaultDist(result.draft));
    else setErrors(result.errors);
  };

  return (
    <Drawer
      open
      wide
      onClose={onClose}
      title="فاکتور جدید"
      footer={
        <>
          {files.length > 0 ? (
            <Button variant="primary" disabled={extracting} onClick={extractAutomatically}>
              {extracting ? (
                <>
                  <Loader2 size={18} className="animate-spin" aria-hidden />
                  <span>در حال خواندن فاکتور...</span>
                </>
              ) : (
                <>
                  <Sparkles size={18} aria-hidden />
                  <span>استخراج خودکار و بازبینی ({faNumber(files.length)} فایل)</span>
                </>
              )}
            </Button>
          ) : (
            <Button variant="primary" disabled={extracting || !text.trim()} onClick={readManualJson}>
              بررسی و ادامه
            </Button>
          )}
          <Button variant="text" disabled={extracting} onClick={() => onDraft(applyDefaultDist(emptyDraft()))}>
            ورود دستی
          </Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-line bg-app/50 p-4">
          <h3 className="flex items-center gap-2 font-bold text-ink">
            <FileSpreadsheet size={18} className="text-primary" aria-hidden />
            <span>۱. ورود فایل اکسل فاکتور (.xlsx)</span>
          </h3>
          <p className="mt-1 text-note text-muted">
            فایل اکسل را که از هوش مصنوعی یا از سامانهٔ شرکت پخش گرفته‌اید انتخاب کنید تا خودکار به فاکتور تبدیل و برای بازبینی باز شود.
          </p>
          <input
            ref={excelInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => handleExcelSelected(e.target.files)}
          />
          <Button
            variant="primary"
            className="mt-4 w-full"
            disabled={extracting}
            onClick={() => excelInputRef.current?.click()}
          >
            <FileSpreadsheet size={18} aria-hidden />
            <span>انتخاب فایل اکسل فاکتور و تبدیل به فاکتور</span>
          </Button>
        </div>

        <div className="rounded-xl border border-line bg-app/50 p-4">
          <h3 className="flex items-center gap-2 font-bold text-ink">
            <Sparkles size={18} className="text-primary" aria-hidden />
            <span>۲. انتخاب مستقیم PDF یا عکس فاکتور</span>
          </h3>
          <p className="mt-1 text-note text-muted">
            یک یا چند عکس یا PDF از صفحات فاکتور پخش انتخاب کنید تا مستقیم در برنامه خوانده شود.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/*,.xlsx,.xls,.csv"
            multiple
            className="hidden"
            onChange={(e) => handleFilesSelected(e.target.files)}
          />
          <Button
            variant="secondary"
            className="mt-4 w-full"
            disabled={extracting}
            onClick={() => fileInputRef.current?.click()}
          >
            {files.length === 0 ? (
              <>
                <Upload size={18} aria-hidden />
                <span>انتخاب عکس یا PDF فاکتور</span>
              </>
            ) : (
              <>
                <ImagePlus size={18} aria-hidden />
                <span>افزودن عکس یا صفحهٔ دیگر</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {files.length > 0 && (
        <ul className="mt-4 grid gap-2">
          {files.map((f, idx) => (
            <li
              key={f.id}
              className="flex items-center justify-between gap-2 rounded-xl border border-line bg-card px-4 py-2 text-note"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Badge tone="good">صفحه/فایل {faNumber(idx + 1)}</Badge>
                <span dir="auto" className="truncate font-medium">{f.name}</span>
                <span className="text-muted">({f.mimeType === 'application/pdf' ? 'PDF' : 'تصویر'})</span>
              </span>
              <Button
                variant="text"
                disabled={extracting}
                className="min-h-9 px-2 text-bad"
                aria-label={`حذف ${f.name}`}
                onClick={() => removeFile(f.id)}
              >
                <Trash2 size={16} aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {extracting && (
        <p className="mt-4 flex items-center gap-2 rounded-xl border border-primary/30 bg-primary-soft/50 p-4 text-note text-primary">
          <Loader2 size={18} className="shrink-0 animate-spin" aria-hidden />
          <span>
            در حال خواندن سطرهای فاکتور و تطبیق ساختار شرکت پخش... این کار بسته به تعداد اقلام چند ثانیه زمان می‌برد.
          </span>
        </p>
      )}

      {errors.length > 0 && (
        <ul className="mt-4 grid gap-1 rounded-xl border border-bad/40 bg-card p-4 text-note text-bad" role="alert">
          {errors.slice(0, 20).map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}

      <details open className="mt-6 rounded-xl border border-line bg-card p-4">
        <summary className="cursor-pointer font-medium text-ink">
          ۳. پرامپت جامع هوشمند برای هوش مصنوعی (دریافت خروجی اکسل یا JSON با تشخیص سرستون‌های متفاوت پخش)
        </summary>
        <div className="mt-4">
          <ol className="grid gap-1 text-note text-muted">
            <li>۱. یکی از دو پرامپت جامع زیر («دریافت اکسل» یا «دریافت JSON») را کپی کنید و همراه PDF/عکس فاکتور به هوش مصنوعی بدهید.</li>
            <li>۲. در این پرامپت‌ها تمام الفاظ مترادف شرکت‌های پخش (مثلاً فی = قیمت واحد = بهای واحد = نرخ) آموزش داده شده است.</li>
            <li>۳. اگر از هوش مصنوعی فایل اکسل گرفتید با دکمهٔ «انتخاب فایل اکسل» در بالا وارد کنید، و اگر JSON گرفتید در کادر پایین بچسبانید.</li>
          </ol>

          <div className="mt-4">
            <Segmented<'excel' | 'smart_json' | 'basic'>
              label="نوع پرامپت"
              value={promptMode}
              onChange={setPromptMode}
              options={[
                { value: 'excel', label: 'پرامپت جامع دریافت اکسل (.xlsx)' },
                { value: 'smart_json', label: 'پرامپت جامع دریافت JSON' },
                { value: 'basic', label: 'پرامپت کوتاه پایه' },
              ]}
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="primary"
              onClick={async () => {
                if (await copyText(activePromptText)) {
                  toast(
                    promptMode === 'excel'
                      ? 'پرامپت جامع دریافت اکسل کپی شد'
                      : 'پرامپت جامع دریافت JSON کپی شد',
                  );
                } else {
                  toast('کپی نشد. متن را از کادر زیر بردارید.', 'error');
                }
              }}
            >
              <ClipboardCopy size={16} aria-hidden />
              <span>
                {promptMode === 'excel'
                  ? 'کپی پرامپت جامع (دریافت فایل اکسل از هوش مصنوعی)'
                  : promptMode === 'smart_json'
                    ? 'کپی پرامپت جامع (دریافت JSON از هوش مصنوعی)'
                    : 'کپی پرامپت کوتاه پایه'}
              </span>
            </Button>
          </div>

          <details className="mt-3">
            <summary className="flex min-h-11 cursor-pointer items-center text-note text-primary">
              دیدن متن کامل پرامپت انتخاب‌شده (شامل فرهنگ لغت سرستون‌های پخش)
            </summary>
            <pre dir="auto" className="mt-2 max-h-72 overflow-y-auto rounded-xl bg-app p-4 text-note whitespace-pre-wrap">
              {activePromptText}
            </pre>
          </details>

          <label htmlFor="invoice-json" className="mt-4 mb-1 block text-note font-medium">
            خروجی هوش مصنوعی (JSON) — در صورت استفاده از اکسل، خودکار پر می‌شود
          </label>
          <textarea
            id="invoice-json"
            dir="ltr"
            rows={7}
            spellCheck={false}
            placeholder="اگر از هوش مصنوعی خروجی JSON گرفتید، اینجا بچسبانید و «بررسی و ادامه» را بزنید..."
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setErrors([]);
            }}
            className="w-full rounded-xl border border-line bg-card p-4 text-note text-ink"
          />
          {text.trim() !== '' && files.length > 0 && (
            <div className="mt-2">
              <Button onClick={readManualJson}>ادامه با همین متن JSON</Button>
            </div>
          )}
        </div>
      </details>
    </Drawer>
  );
}

interface DistributorData {
  invoices: Invoice[];
  distributors: Distributor[];
  items: InvoiceItem[];
  cheques: Cheque[];
  drugsMap: Map<number, Drug>;
}

function DistributorArchiveView({
  distributor,
  data,
  onBack,
  onOpenInvoice,
  onNewInvoiceForDistributor,
}: {
  distributor: Distributor;
  data: DistributorData;
  onBack: () => void;
  onOpenInvoice: (id: number) => void;
  onNewInvoiceForDistributor: (name: string) => void;
}) {
  const toast = useToast();
  const [subTab, setSubTab] = useState<ArchiveSubTab>('invoices');
  const [itemQuery, setItemQuery] = useState('');

  const distInvoices = useMemo(
    () =>
      data.invoices
        .filter((i) => i.distributorId === distributor.id)
        .sort((a, b) => b.date.localeCompare(a.date)),
    [data.invoices, distributor.id],
  );

  const invoiceIds = useMemo(() => new Set(distInvoices.map((i) => i.id)), [distInvoices]);
  const invMap = useMemo(() => new Map(distInvoices.map((i) => [i.id, i])), [distInvoices]);

  const distItems = useMemo(
    () => data.items.filter((it) => invoiceIds.has(it.invoiceId)),
    [data.items, invoiceIds],
  );

  const distCheques = useMemo(
    () =>
      data.cheques
        .filter((c) => c.distributorId === distributor.id || (c.invoiceId && invoiceIds.has(c.invoiceId)))
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [data.cheques, distributor.id, invoiceIds],
  );

  const totalPurchase = distInvoices.reduce((s, i) => s + i.payable, 0);
  const pendingChequesTotal = distCheques
    .filter((c) => c.status === 'pending')
    .reduce((s, c) => s + c.amount, 0);
  const totalBonusUnits = distItems.reduce((s, it) => s + it.bonus, 0);

  const filteredItems = useMemo(
    () =>
      distItems.filter((it) => {
        const drug = it.drugId !== null ? data.drugsMap.get(it.drugId) : undefined;
        const generic = drug ? `${fullDrugName(drug)} ${fullDrugDose(drug)}` : '';
        const invNo = invMap.get(it.invoiceId)?.number ?? '';
        return matches(`${it.name} ${generic} ${invNo} ${it.batch}`, itemQuery);
      }),
    [distItems, data.drugsMap, invMap, itemQuery],
  );

  return (
    <div className="grid gap-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="text" onClick={onBack}>
              <ArrowRight size={18} aria-hidden />
              <span>همهٔ شرکت‌های پخش</span>
            </Button>
            <div>
              <h2 className="text-title font-bold">{distributor.name}</h2>
              <p className="text-note text-muted">
                پروندهٔ مدیریتی، بایگانی فاکتورها، سابقهٔ اقلام خریداری‌شده و وضعیت چک‌ها
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                exportDistributorArchiveToExcel({
                  distributor,
                  invoices: distInvoices,
                  items: distItems,
                  cheques: distCheques,
                  drugsMap: data.drugsMap,
                });
                toast('فایل اکسل بایگانی شرکت پخش دانلود شد');
              }}
            >
              <FileSpreadsheet size={18} aria-hidden />
              <span>دانلود اکسل کل بایگانی شرکت</span>
            </Button>
            <Button variant="primary" onClick={() => onNewInvoiceForDistributor(distributor.name)}>
              <Plus size={18} aria-hidden />
              <span>ثبت فاکتور جدید این شرکت</span>
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KeyCard label="فاکتورهای بایگانی‌شده">{faNumber(distInvoices.length)}</KeyCard>
          <KeyCard label="مجموع خرید از این شرکت">
            <Money rial={totalPurchase} big />
          </KeyCard>
          <KeyCard label="بدهی باز (چک‌های در انتظار)">
            <Money rial={pendingChequesTotal} big />
          </KeyCard>
          <KeyCard label="کل اقلام / واحدهای جایزه">
            <span>
              {faNumber(distItems.length)} قلم{' '}
              <span className="text-note font-normal text-muted">({faNumber(totalBonusUnits)} عدد آفر)</span>
            </span>
          </KeyCard>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 border-t border-line pt-4 sm:max-w-md">
          <NumberField
            label="مدت چک پایهٔ شرکت"
            suffix="ماه"
            value={distributor.baseChequeMonths}
            onChange={(baseChequeMonths) =>
              db.distributors.update(distributor.id, { baseChequeMonths: Math.max(0, Math.round(baseChequeMonths)) })
            }
          />
          <PercentField
            label="تخفیف زودپرداخت ماهانه"
            value={distributor.earlyPayDiscountPerMonth}
            onChange={(earlyPayDiscountPerMonth) =>
              db.distributors.update(distributor.id, { earlyPayDiscountPerMonth })
            }
          />
        </div>
      </Card>

      <div>
        <Segmented<ArchiveSubTab>
          label="بخش‌های بایگانی شرکت پخش"
          value={subTab}
          onChange={setSubTab}
          options={[
            { value: 'invoices', label: `فاکتورهای شرکت (${faNumber(distInvoices.length)})` },
            { value: 'items', label: `ریز داروهای خریداری‌شده (${faNumber(distItems.length)})` },
            { value: 'cheques', label: `چک‌های شرکت (${faNumber(distCheques.length)})` },
          ]}
        />
      </div>

      {subTab === 'invoices' && (
        <Card flush>
          {distInvoices.length === 0 ? (
            <p className="p-6 text-muted">هنوز فاکتوری برای این شرکت پخش ثبت نشده است.</p>
          ) : (
            <ul>
              {distInvoices.map((inv) => {
                const invItems = distItems.filter((it) => it.invoiceId === inv.id);
                const invCheques = distCheques.filter((c) => c.invoiceId === inv.id);
                const bonusCount = invItems.reduce((s, it) => s + it.bonus, 0);
                return (
                  <li
                    key={inv.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-6 py-4 last:border-0"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenInvoice(inv.id)}
                      className="min-w-0 flex-1 text-start"
                    >
                      <span className="flex flex-wrap items-center gap-2 font-bold text-primary">
                        <span>فاکتور شمارهٔ {inv.number || '—'}</span>
                        <Badge tone="neutral">{PAYMENT_TYPE_LABELS[inv.payment.type] ?? inv.payment.type}</Badge>
                        {inv.sample && <SampleBadge />}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-2 text-note text-muted">
                        <span>تاریخ: {faDate(inv.date)}</span>
                        <span>• {faNumber(invItems.length)} قلم دارو</span>
                        {bonusCount > 0 && <span>• {faNumber(bonusCount)} عدد جایزه/آفر</span>}
                      </span>
                    </button>
                    <div className="flex flex-wrap items-center gap-2">
                      <Money rial={inv.payable} />
                      <Button
                        variant="secondary"
                        className="min-h-9 px-3 text-note"
                        onClick={() => {
                          exportInvoiceToExcel({
                            invoice: inv,
                            items: invItems,
                            distributorName: distributor.name,
                            drugsMap: data.drugsMap,
                            cheques: invCheques,
                          });
                          toast('فایل اکسل فاکتور دانلود شد');
                        }}
                      >
                        <Download size={15} aria-hidden />
                        <span>خروجی اکسل</span>
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {subTab === 'items' && (
        <Card flush>
          <div className="p-4">
            <div className="relative md:max-w-sm">
              <Search size={18} className="absolute inset-y-0 start-4 my-auto text-muted" aria-hidden />
              <input
                type="search"
                aria-label="جستجوی دارو در بایگانی شرکت"
                placeholder="جستجوی نام دارو، شماره فاکتور یا سری ساخت"
                value={itemQuery}
                onChange={(e) => setItemQuery(e.target.value)}
                className="min-h-11 w-full rounded-xl border border-line bg-card ps-11 pe-4 text-ink"
              />
            </div>
          </div>
          {filteredItems.length === 0 ? (
            <p className="px-6 pb-6 text-muted">ردیفی پیدا نشد.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-y border-line text-note text-muted">
                    {[
                      'تاریخ و فاکتور',
                      'نام دارو',
                      'تعداد خرید',
                      'بونوس (آفر)',
                      'فی خرید واحد',
                      'تمام‌شدهٔ هر واحد',
                      'انقضا',
                      'جمع ردیف',
                    ].map((h) => (
                      <th key={h} scope="col" className="px-4 py-2 text-start font-medium whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((it) => {
                    const inv = invMap.get(it.invoiceId);
                    const drug = it.drugId !== null ? data.drugsMap.get(it.drugId) : undefined;
                    return (
                      <tr key={it.id} className="border-b border-line last:border-0">
                        <td className="px-4 py-2 text-note whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => inv && onOpenInvoice(inv.id)}
                            className="text-start text-primary hover:underline"
                          >
                            {inv ? faDate(inv.date) : '—'}
                            <span className="block text-muted">شماره {inv?.number || '—'}</span>
                          </button>
                        </td>
                        <td className="px-4 py-2">
                          <span dir="auto" className="block font-medium">{it.name}</span>
                          {drug && (
                            <span dir="auto" className="block text-note text-muted">
                              {fullDrugName(drug)} {fullDrugDose(drug)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap">{faNumber(it.quantity)}</td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          {it.bonus > 0 ? <Badge tone="good">{faNumber(it.bonus)} رایگان</Badge> : '—'}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap"><Money rial={it.unitPrice} exact /></td>
                        <td className="px-4 py-2 whitespace-nowrap"><Money rial={it.effectiveUnitCost} exact /></td>
                        <td className="px-4 py-2 text-note whitespace-nowrap">{it.expiry ? faDate(it.expiry) : '—'}</td>
                        <td className="px-4 py-2 whitespace-nowrap"><Money rial={it.total} exact /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {subTab === 'cheques' && (
        <Card flush>
          {distCheques.length === 0 ? (
            <p className="p-6 text-muted">چکی برای این شرکت پخش ثبت نشده است.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-y border-line text-note text-muted">
                    {['تاریخ سررسید', 'شماره فاکتور', 'مبلغ چک', 'وضعیت'].map((h) => (
                      <th key={h} scope="col" className="px-4 py-2 text-start font-medium whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {distCheques.map((c) => {
                    const inv = c.invoiceId ? invMap.get(c.invoiceId) : undefined;
                    return (
                      <tr key={c.id} className="border-b border-line last:border-0">
                        <td className="px-4 py-2 whitespace-nowrap">{faDate(c.dueDate)}</td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          {inv ? (
                            <button
                              type="button"
                              onClick={() => onOpenInvoice(inv.id)}
                              className="text-primary hover:underline"
                            >
                              فاکتور {inv.number || '—'} ({faDate(inv.date)})
                            </button>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap"><Money rial={c.amount} exact /></td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          <Badge tone={c.status === 'paid' ? 'good' : 'warn'}>
                            {c.status === 'paid' ? 'پاس‌شده' : 'در انتظار پاس'}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function DistributorDashboard({
  data,
  onOpenInvoice,
  onNewInvoiceForDistributor,
}: {
  data: DistributorData;
  onOpenInvoice: (id: number) => void;
  onNewInvoiceForDistributor: (name: string) => void;
}) {
  const toast = useToast();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [newDistName, setNewDistName] = useState('');
  const [newDistMonths, setNewDistMonths] = useState(3);

  const selectedDistributor = data.distributors.find((d) => d.id === selectedId);
  if (selectedDistributor) {
    return (
      <DistributorArchiveView
        distributor={selectedDistributor}
        data={data}
        onBack={() => setSelectedId(null)}
        onOpenInvoice={onOpenInvoice}
        onNewInvoiceForDistributor={onNewInvoiceForDistributor}
      />
    );
  }

  const summaries = data.distributors
    .filter((d) => matches(d.name, search))
    .map((dist) => {
      const invs = data.invoices
        .filter((i) => i.distributorId === dist.id)
        .sort((a, b) => b.date.localeCompare(a.date));
      const invIds = new Set(invs.map((i) => i.id));
      const items = data.items.filter((it) => invIds.has(it.invoiceId));
      const cheques = data.cheques.filter(
        (c) => c.distributorId === dist.id || (c.invoiceId && invIds.has(c.invoiceId)),
      );
      const totalBuy = invs.reduce((s, i) => s + i.payable, 0);
      const pendingCheque = cheques.filter((c) => c.status === 'pending').reduce((s, c) => s + c.amount, 0);
      const bonusUnits = items.reduce((s, it) => s + it.bonus, 0);
      return {
        dist,
        invs,
        items,
        cheques,
        totalBuy,
        pendingCheque,
        bonusUnits,
        lastDate: invs[0]?.date ?? null,
      };
    })
    .sort((a, b) => b.totalBuy - a.totalBuy || a.dist.name.localeCompare(b.dist.name, 'fa'));

  const totalAllPurchases = data.invoices.reduce((s, i) => s + i.payable, 0);
  const totalPendingCheques = data.cheques
    .filter((c) => c.status === 'pending')
    .reduce((s, c) => s + c.amount, 0);
  const activeDistCount = summaries.filter((s) => s.invs.length > 0).length;

  const addDistributor = async () => {
    const name = normalizeText(newDistName);
    if (!name) return;
    const exists = data.distributors.some((d) => normalizeText(d.name) === name);
    if (exists) {
      toast('این شرکت پخش قبلاً ثبت شده است', 'error');
      return;
    }
    const id = await db.distributors.add({
      name,
      baseChequeMonths: Math.max(0, Math.round(newDistMonths)),
      earlyPayDiscountPerMonth: 0,
    } as Distributor);
    setNewDistName('');
    toast('شرکت پخش جدید به بایگانی اضافه شد');
    setSelectedId(id);
  };

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KeyCard label="شرکت‌های پخش">{faNumber(data.distributors.length)} شرکت ({faNumber(activeDistCount)} دارای فاکتور)</KeyCard>
        <KeyCard label="کل خرید بایگانی‌شده">
          <Money rial={totalAllPurchases} big />
        </KeyCard>
        <KeyCard label="کل چک‌های در جریان پخش">
          <Money rial={totalPendingCheques} big />
        </KeyCard>
        <KeyCard label="کل فاکتورهای ثبت‌شده">{faNumber(data.invoices.length)} فاکتور</KeyCard>
      </div>

      <Card>
        <div className="grid items-end gap-4 md:grid-cols-[1fr_1fr_140px_auto]">
          <div className="relative">
            <label htmlFor="search-dist" className="mb-1 block text-note font-medium text-muted">
              جستجوی شرکت پخش
            </label>
            <Search size={18} className="absolute bottom-3.5 start-4 text-muted" aria-hidden />
            <input
              id="search-dist"
              type="search"
              placeholder="نام شرکت پخش (رازی، البرز، هجرت...)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="min-h-11 w-full rounded-xl border border-line bg-card ps-11 pe-4 text-ink"
            />
          </div>
          <TextField
            label="افزودن شرکت پخش جدید به بایگانی"
            placeholder="مثلاً پخش سها یا فردوس"
            value={newDistName}
            onChange={(e) => setNewDistName(e.target.value)}
          />
          <NumberField
            label="مدت چک پایه"
            suffix="ماه"
            value={newDistMonths}
            onChange={setNewDistMonths}
          />
          <Button disabled={!normalizeText(newDistName)} onClick={addDistributor}>
            <Plus size={18} aria-hidden />
            <span>افزودن شرکت</span>
          </Button>
        </div>
      </Card>

      {summaries.length === 0 ? (
        <EmptyState icon={Building2} text="شرکت پخشی پیدا نشد. می‌توانید نام شرکت پخش جدید را در کادر بالا وارد و اضافه کنید." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {summaries.map(({ dist, invs, items, cheques, totalBuy, pendingCheque, bonusUnits, lastDate }) => (
            <Card key={dist.id} className="flex flex-col justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="flex items-center gap-2 text-cardtitle font-bold text-ink">
                    <Building2 size={20} className="text-primary" aria-hidden />
                    <span>{dist.name}</span>
                  </h3>
                  <div className="flex items-center gap-2">
                    <Badge tone={invs.length > 0 ? 'good' : 'neutral'}>
                      {faNumber(invs.length)} فاکتور
                    </Badge>
                    <Badge tone="neutral">چک پایه {faNumber(dist.baseChequeMonths)} ماهه</Badge>
                  </div>
                </div>

                <dl className="mt-4 grid gap-2 text-note">
                  <div className="flex justify-between border-b border-line py-1.5">
                    <dt className="text-muted">مجموع خرید از این شرکت</dt>
                    <dd className="font-bold text-ink"><Money rial={totalBuy} exact /></dd>
                  </div>
                  <div className="flex justify-between border-b border-line py-1.5">
                    <dt className="text-muted">بدهی باز (چک‌های در انتظار پاس)</dt>
                    <dd className={pendingCheque > 0 ? 'font-medium text-warn' : 'text-muted'}>
                      <Money rial={pendingCheque} exact />
                    </dd>
                  </div>
                  <div className="flex justify-between border-b border-line py-1.5">
                    <dt className="text-muted">اقلام خریداری‌شده و آفر دریافتی</dt>
                    <dd>
                      {faNumber(items.length)} قلم ({faNumber(bonusUnits)} عدد جایزه)
                    </dd>
                  </div>
                  <div className="flex justify-between py-1">
                    <dt className="text-muted">آخرین خرید</dt>
                    <dd>{lastDate ? faDate(lastDate) : 'بدون خرید'}</dd>
                  </div>
                </dl>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                <Button variant="primary" onClick={() => setSelectedId(dist.id)}>
                  <FolderArchive size={17} aria-hidden />
                  <span>پرونده و بایگانی کامل</span>
                </Button>
                <div className="flex items-center gap-2">
                  {invs.length > 0 && (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        exportDistributorArchiveToExcel({
                          distributor: dist,
                          invoices: invs,
                          items,
                          cheques,
                          drugsMap: data.drugsMap,
                        });
                        toast(`اکسل بایگانی ${dist.name} دانلود شد`);
                      }}
                    >
                      <Download size={16} aria-hidden />
                      <span>اکسل بایگانی</span>
                    </Button>
                  )}
                  <Button variant="text" onClick={() => onNewInvoiceForDistributor(dist.name)}>
                    + فاکتور جدید
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export function Invoices() {
  const toast = useToast();
  const data = useLiveQuery(async () => {
    const [invoices, distributors, items, cheques, drugs] = await Promise.all([
      db.invoices.toArray(),
      db.distributors.toArray(),
      db.invoiceItems.toArray(),
      db.cheques.toArray(),
      db.drugs.toArray(),
    ]);
    return {
      invoices,
      distributors,
      items,
      cheques,
      drugsMap: new Map(drugs.map((d) => [d.id, d])),
    };
  });
  const [tab, setTab] = useState<MainTab>('invoices');
  const [creating, setCreating] = useState(false);
  const [creatingForDistributor, setCreatingForDistributor] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState<DraftInvoice | null>(null);
  const [query, setQuery] = useState('');

  if (!data) return <PageSkeleton />;

  if (draft) return <InvoiceEditor key={draft.id ?? 'new'} initial={draft} onClose={() => setDraft(null)} />;

  const nameOf = (id: number) => data.distributors.find((d) => d.id === id)?.name ?? '—';
  const rows = data.invoices
    .filter((i) => matches(`${i.number} ${nameOf(i.distributorId)}`, query))
    .sort((a, b) => b.date.localeCompare(a.date));
  const thisMonth = data.invoices.filter((i) => monthOf(i.date) === currentMonthKey());
  const monthTotal = thisMonth.reduce((sum, i) => sum + i.payable, 0);
  const unmatched = data.items.filter((i) => i.drugId === null).length;

  return (
    <>
      <PageHeader
        title="فاکتورها و بایگانی پخش"
        note="ثبت و استخراج هوشمند فاکتور، خروجی اکسل و داشبورد بایگانی هر شرکت پخش."
        action={
          <Button
            variant="primary"
            onClick={() => {
              setCreatingForDistributor(undefined);
              setCreating(true);
            }}
          >
            فاکتور جدید
          </Button>
        }
      />

      <div className="mb-6">
        <Segmented<MainTab>
          label="بخش‌های صفحه فاکتورها"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'invoices', label: `فهرست فاکتورها (${faNumber(data.invoices.length)})` },
            { value: 'distributors', label: `داشبورد و بایگانی شرکت‌های پخش (${faNumber(data.distributors.length)})` },
          ]}
        />
      </div>

      {tab === 'distributors' && (
        <DistributorDashboard
          data={data}
          onOpenInvoice={async (id) => setDraft(await loadDraft(id))}
          onNewInvoiceForDistributor={(distName) => {
            setCreatingForDistributor(distName);
            setCreating(true);
          }}
        />
      )}

      {tab === 'invoices' && (
        <>
          {data.invoices.length === 0 ? (
            <EmptyState icon={FileText} text="هنوز فاکتوری ثبت نشده است. اولین فاکتور را با دکمهٔ «فاکتور جدید» وارد کنید." />
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-3">
                <KeyCard label="فاکتورهای ثبت‌شده">{faNumber(data.invoices.length)}</KeyCard>
                <KeyCard label="خرید این ماه"><Money rial={monthTotal} big /></KeyCard>
                <KeyCard label="اقلام وصل‌نشده به بانک">{faNumber(unmatched)}</KeyCard>
              </div>

              <Card flush className="mt-6">
                <div className="relative p-4">
                  <Search size={18} className="absolute inset-y-0 start-8 my-auto text-muted" aria-hidden />
                  <input
                    type="search"
                    aria-label="جستجوی فاکتور"
                    placeholder="جستجو با شماره یا شرکت"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="min-h-11 w-full rounded-xl border border-line bg-card ps-12 pe-4 text-ink md:max-w-xs"
                  />
                </div>
                <ul>
                  {rows.map((invoice) => {
                    const invItems = data.items.filter((i) => i.invoiceId === invoice.id);
                    const invCheques = data.cheques.filter((c) => c.invoiceId === invoice.id);
                    const distName = nameOf(invoice.distributorId);
                    return (
                      <li key={invoice.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-6 py-4">
                        <button
                          type="button"
                          onClick={async () => setDraft(await loadDraft(invoice.id))}
                          className="min-w-0 flex-1 text-start"
                        >
                          <span className="flex flex-wrap items-center gap-2 font-medium text-primary">
                            {distName}
                            {invoice.sample && <SampleBadge />}
                          </span>
                          <span className="mt-1 flex flex-wrap items-center gap-2 text-note text-muted">
                            شمارهٔ {invoice.number || '—'}، {faDate(invoice.date)}، {faNumber(invItems.length)} قلم
                            {invoice.warnings?.length ? <Badge tone="warn">{faNumber(invoice.warnings.length)} هشدار</Badge> : null}
                          </span>
                        </button>
                        <span className="flex flex-wrap items-center gap-3">
                          <Money rial={invoice.payable} />
                          <Button
                            variant="secondary"
                            className="min-h-9 px-3 text-note"
                            onClick={() => {
                              exportInvoiceToExcel({
                                invoice,
                                items: invItems,
                                distributorName: distName,
                                drugsMap: data.drugsMap,
                                cheques: invCheques,
                              });
                              toast('فایل اکسل فاکتور دانلود شد');
                            }}
                          >
                            <Download size={15} aria-hidden />
                            <span>خروجی اکسل</span>
                          </Button>
                          <ConfirmButton
                            label="حذف"
                            question="فاکتور و چک و بچ‌هایش حذف شود؟"
                            confirmLabel="حذف کن"
                            onConfirm={async () => {
                              await deleteInvoice(invoice.id);
                              toast('فاکتور حذف شد');
                            }}
                          />
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {rows.length === 0 && <p className="px-6 pb-6 text-muted">فاکتوری پیدا نشد.</p>}
              </Card>
            </>
          )}
        </>
      )}

      {creating && (
        <NewInvoice
          defaultDistributor={creatingForDistributor}
          onClose={() => {
            setCreating(false);
            setCreatingForDistributor(undefined);
          }}
          onDraft={(d) => {
            setCreating(false);
            setCreatingForDistributor(undefined);
            setDraft(d);
          }}
        />
      )}
    </>
  );
}

