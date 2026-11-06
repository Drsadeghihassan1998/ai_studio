// نرمال‌سازی متن و عدد برای جستجو، تطبیق نام‌ها و خواندن فایل‌ها.

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** ارقام فارسی و عربی ← لاتین */
export function toLatinDigits(input: string): string {
  return input.replace(/[۰-۹٠-٩]/g, (d) => {
    const fa = FA_DIGITS.indexOf(d);
    return String(fa >= 0 ? fa : AR_DIGITS.indexOf(d));
  });
}

/** «ي» ← «ی»، «ك» ← «ک»، حذف نیم‌فاصله و فاصلهٔ اضافه، ارقام به لاتین */
export function normalizeText(input: unknown): string {
  if (input === null || input === undefined) return '';
  return toLatinDigits(String(input))
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[‌‍‎‏­ـ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** کلید تطبیق: مثل بالا، با حروف کوچک لاتین */
export function matchKey(input: unknown): string {
  return normalizeText(input).toLowerCase();
}

/** آیا متن query در متن text هست؟ (بدون حساسیت به ی/ک و نیم‌فاصله) */
export function matches(text: unknown, query: string): boolean {
  return matchKey(text).includes(matchKey(query));
}

/**
 * خواندن عدد از متن: «۱٬۲۵۰٬۰۰۰» ← 1250000 و «12.5» ← 12.5.
 * اگر عدد معتبر نباشد null برمی‌گرداند. منفی هم با «-12» و «12-» و «(12)» پذیرفته می‌شود.
 */
export function parseNumber(input: unknown): number | null {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (input === null || input === undefined) return null;
  // خانه‌ای که چند عدد در چند خط دارد یک عدد نیست؛ نباید به هم چسبانده شود.
  if (/[\r\n]/.test(String(input).trim())) return null;
  let s = normalizeText(input)
    .replace(/[,٬،\s]/g, '')
    .replace(/٫/g, '.')
    .replace(/[−–]/g, '-');
  if (s === '') return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith('-')) {
    negative = !negative;
    s = s.slice(0, -1);
  }
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/**
 * خواندن درصد و تبدیل به کسر: «70%» ← 0.70 و «70» ← 0.70.
 * عدد بدون علامت ٪ که بین ۰ و ۱ باشد کسر حساب می‌شود (اکسل درصد را این‌طور نگه می‌دارد): 0.7 ← 0.70.
 */
export function parsePercent(input: unknown): number | null {
  if (input === null || input === undefined) return null;
  if (/[\r\n]/.test(String(input).trim())) return null;
  const raw = normalizeText(input);
  const hasSign = /[%٪]/.test(raw);
  const n = parseNumber(raw.replace(/[%٪]/g, ''));
  if (n === null) return null;
  if (hasSign) return n / 100;
  return Math.abs(n) <= 1 ? n : n / 100;
}
