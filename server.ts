import express from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import { INVOICE_PROMPT } from './src/lib/invoicePrompt';
import path from 'node:path';
import { existsSync } from 'node:fs';

function getAiClient() {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const INVOICE_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    distributor: { type: Type.STRING, description: 'نام شرکت پخش دارویی (مثلاً پخش رازی، البرز، هجرت، فردوس، سها، قاسم، محیا، بهستان، دارویی کشور و غیره)' },
    invoice_no: { type: Type.STRING, description: 'شماره فاکتور یا شماره سند' },
    invoice_date: { type: Type.STRING, description: 'تاریخ فاکتور به شمسی با فرمت YYYY/MM/DD و ارقام لاتین' },
    payment: {
      type: Type.OBJECT,
      properties: {
        type: { type: Type.STRING, description: 'یکی از مقادیر cash یا cheque یا mixed یا credit' },
        cheque_months: { type: Type.NUMBER, description: 'مدت چک یا مهلت تسویه به ماه (در صورت عدم درج 0)' },
        due_date: { type: Type.STRING, description: 'تاریخ سررسید یا رأس چک به شمسی YYYY/MM/DD یا رشته خالی' },
        notes: { type: Type.STRING, description: 'توضیحات شرایط پرداخت' },
      },
    },
    items: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          row: { type: Type.INTEGER },
          name: { type: Type.STRING, description: 'نام دارو یا فرآورده دارویی به همراه دوز و شکل دارویی' },
          irc: { type: Type.STRING, description: 'کد IRC یا کد فرآورده در صورت وجود یا رشته خالی' },
          generic_code: { type: Type.STRING, description: 'کد ژنریک یا کد کالا در صورت وجود یا رشته خالی' },
          form: { type: Type.STRING, description: 'شکل دارویی (قرص، کپسول، شربت، آمپول و غیره)' },
          strength: { type: Type.STRING, description: 'دوز یا قدرت دارویی (مثلاً 500 mg)' },
          batch: { type: Type.STRING, description: 'شماره سری ساخت یا بچ (Batch/Lot)' },
          expiry: { type: Type.STRING, description: 'تاریخ انقضای دارو' },
          qty: { type: Type.NUMBER, description: 'تعداد خریداری‌شده (بدون احتساب جایزه/آفر)' },
          bonus_qty: { type: Type.NUMBER, description: 'تعداد جایزه، بونوس، آفر یا اشانتیون رایگان' },
          unit_price: { type: Type.NUMBER, description: 'فی یا قیمت واحد خرید داروخانه به ریال' },
          consumer_price: { type: Type.NUMBER, description: 'قیمت مصرف‌کننده هر واحد به ریال' },
          discount_percent: { type: Type.NUMBER, description: 'درصد تخفیف ردیف (مثلاً 3 برای 3 درصد)' },
          discount_amount: { type: Type.NUMBER, description: 'مبلغ تخفیف ردیف به ریال' },
          tax_amount: { type: Type.NUMBER, description: 'مبلغ مالیات و عوارض ارزش افزوده ردیف به ریال' },
          line_total: { type: Type.NUMBER, description: 'مبلغ کل خالص یا قابل پرداخت ردیف به ریال' },
        },
      },
    },
    totals: {
      type: Type.OBJECT,
      properties: {
        gross: { type: Type.NUMBER, description: 'جمع کل قبل از تخفیف و مالیات به ریال' },
        discount: { type: Type.NUMBER, description: 'جمع کل تخفیف فاکتور به ریال' },
        tax: { type: Type.NUMBER, description: 'جمع کل مالیات و عوارض فاکتور به ریال' },
        payable: { type: Type.NUMBER, description: 'مبلغ نهایی قابل پرداخت فاکتور به ریال' },
      },
    },
    currency_note: { type: Type.STRING, description: 'توضیح واحد پول فاکتور در صورت تبدیل از تومان به ریال' },
    warnings: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'هرگونه ناخوانایی، ابهام یا اختلاف جمع سطرها با جمع کل فاکتور به فارسی ساده',
    },
  },
};

const MULTI_DISTRIBUTOR_INSTRUCTION = `شما متخصص دقیق خواندن و استخراج فاکتورهای شرکت‌های پخش دارویی ایران (مانند پخش رازی، البرز، هجرت، فردوس، سها، قاسم، محیا، بهستان، دارویی کشور، کاسپین، اکسیر، التیام و سایر شرکت‌ها) هستید.
نکات مهم برای ساختارهای متفاوت فاکتورهای پخش:
۱. اگر چند عکس یا یک PDF چندصفحه‌ای فرستاده شده است، همه مربوط به یک فاکتور هستند؛ سطرهای تمام صفحات را به ترتیب و بدون تکرار در آرایهٔ items قرار بده و جمع کل نهایی را از صفحهٔ آخر بخوان.
۲. عنوان ستون‌ها در شرکت‌های پخش مختلف ممکن است متفاوت باشد:
   - «تعداد» / «مقدار» / «تعداد فروش» / «تعداد کل»: در qty فقط تعداد خریدِ با پول را بگذار. اگر ستون «تعداد کل» شامل جایزه هم هست، جایزه را از آن کم کن تا qty فقط تعداد خرید باشد و جایزه در bonus_qty قرار بگیرد.
   - «جایزه» / «آفر» / «بونوس» / «اشانتیون» / «رایگان» / «هدیه»: در bonus_qty قرار بده. اگر یک دارو در دو سطر جدا نوشته شده که سطر دوم با فی صفر یا به عنوان جایزه است، آن را در bonus_qty همان دارو ادغام کن.
   - «فی» / «قیمت واحد» / «بهای واحد» / «نرخ فروش» / «فی داروخانه»: در unit_price قرار بده.
   - «قیمت مصرف‌کننده» / «بهای مصرف‌کننده» / «فی مصرف‌کننده»: در consumer_price قرار بده.
   - «مالیات و عوارض» / «ارزش افزوده» / «مالیات»: در tax_amount قرار بده.
   - «مبلغ خالص» / «جمع ردیف» / «مبلغ کل پس از کسر تخفیف و افزودن مالیات» / «قابل پرداخت ردیف»: در line_total قرار بده.
۳. همهٔ مبالغ باید به ریال باشند. اگر فاکتور به تومان است، مبالغ را در ۱۰ ضرب کن و در currency_note ذکر کن.
۴. تاریخ فاکتور (invoice_date) و تاریخ سررسید (due_date) را به صورت تاریخ شمسی YYYY/MM/DD با ارقام لاتین بنویس (مثلاً 1405/08/15). اگر مهلت تسویه بر حسب روز نوشته شده (مثلاً 90 روزه یا 120 روزه)، معادل ماه آن (مثلاً 3 یا 4) را در cheque_months بگذار.`;

interface UploadedFilePayload {
  name?: string;
  mimeType: string;
  data: string;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  app.post('/api/invoice/extract', async (req, res) => {
    try {
      const files = (req.body?.files ?? []) as UploadedFilePayload[];
      const excelText = typeof req.body?.excelText === 'string' ? req.body.excelText : '';
      if ((!Array.isArray(files) || files.length === 0) && !excelText.trim()) {
        res.status(400).json({ error: 'هیچ فایل عکس، PDF یا اکسل برای استخراج ارسال نشده است.' });
        return;
      }

      const parts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = [];
      for (const file of files) {
        if (!file?.data || !file?.mimeType) continue;
        const cleanBase64 = file.data.includes(',') ? file.data.split(',')[1] : file.data;
        parts.push({
          inlineData: {
            mimeType: file.mimeType,
            data: cleanBase64,
          },
        });
      }

      if (excelText.trim()) {
        parts.push({
          text: `محتوای جدول فاکتور:\n${excelText}`,
        });
      }

      if (parts.length === 0) {
        res.status(400).json({ error: 'فرمت فایل ارسالی معتبر نیست.' });
        return;
      }

      parts.push({
        text: `${INVOICE_PROMPT}\n\nلطفاً تمام ردیف‌ها، تعداد، بونوس، فی خرید، قیمت مصرف‌کننده، تخفیف، مالیات و جمع کل را با دقت به صورت JSON معتبر استخراج کن.`,
      });

      const ai = getAiClient();
      let text = '';
      try {
        const response = await ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: { parts },
          config: {
            systemInstruction: MULTI_DISTRIBUTOR_INSTRUCTION,
            responseMimeType: 'application/json',
            responseSchema: INVOICE_RESPONSE_SCHEMA,
          },
        });
        text = (response.text ?? '').trim();
      } catch {
        const fallbackResponse = await ai.models.generateContent({
          model: 'gemini-flash-latest',
          contents: { parts },
          config: {
            systemInstruction: MULTI_DISTRIBUTOR_INSTRUCTION,
            responseMimeType: 'application/json',
          },
        });
        text = (fallbackResponse.text ?? '').trim();
      }

      if (!text) {
        res.status(502).json({ error: 'پاسخی از هوش مصنوعی دریافت نشد. لطفاً دوباره تلاش کنید.' });
        return;
      }

      res.json({ json: text });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Invoice extraction error:', msg);
      res.status(500).json({
        error: 'خطا در خواندن فایل فاکتور توسط هوش مصنوعی. مطمئن شوید تصویر یا PDF خوانا است و کلید Gemini در تنظیمات فعال است.',
        detail: msg,
      });
    }
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    app.get('/@vite/client', (_req, res) => {
      res.type('application/javascript').send(`
const sheetsMap = new Map();
let lastInsertedStyle;
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement("style");
    style.setAttribute("type", "text/css");
    style.setAttribute("data-vite-dev-id", id);
    style.textContent = content;
    if (!lastInsertedStyle) {
      document.head.appendChild(style);
      setTimeout(() => { lastInsertedStyle = undefined; }, 0);
    } else {
      lastInsertedStyle.insertAdjacentElement("afterend", style);
    }
    lastInsertedStyle = style;
  } else if (style.textContent !== content) {
    style.textContent = content;
  }
  sheetsMap.set(id, style);
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style) {
    document.head.removeChild(style);
    sheetsMap.delete(id);
  }
}
export function injectQuery(url, queryToInject) {
  if (url[0] !== "." && url[0] !== "/") return url;
  const pathname = url.replace(/[?#].*$/, "");
  const { search, hash } = new URL(url, "http://vite.dev");
  return \`\${pathname}?\${queryToInject}\${search ? "&" + search.slice(1) : ""}\${hash || ""}\`;
}
export function createHotContext() {
  return {
    data: {},
    accept() {},
    acceptExports() {},
    acceptDeps() {},
    dispose() {},
    prune() {},
    invalidate() {},
    decline() {},
    on() {},
    off() {},
    send() {},
  };
}
export class ErrorOverlay {}
`);
    });

    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    if (existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('/{*splat}', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on http://localhost:${port}`);
  });
}

startServer();
