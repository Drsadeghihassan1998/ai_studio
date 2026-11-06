import { normalizeText } from './text';

// تحلیل نام دارو: شکل دارویی، دوز، و میزان شباهت دو نام.

const FORM_RULES: [RegExp, string][] = [
  [/\b(INJ|INJECTION|VIAL|AMP|AMPOULE|INFU|INFUSION|PARENTERAL|INTRAVENOUS)\b/, 'تزریقی'],
  [/\b(TAB|TABS|TABLET|TABLETS|TABLETEXTENDED)\b/, 'قرص'],
  [/\b(CAP|CAPS|CAPSULE|CAPSULES)\b/, 'کپسول'],
  [/\b(SUSP|SUSPENSION|SUSPENTION)\b/, 'سوسپانسیون'],
  [/\b(SYRUP|ELIXIR)\b/, 'شربت'],
  [/\b(DROP|DROPS)\b/, 'قطره'],
  [/\b(CREAM)\b/, 'کرم'],
  [/\b(OINT|OINTMENT)\b/, 'پماد'],
  [/\b(GEL)\b/, 'ژل'],
  [/\b(SUPP|SUPPOSITORY)\b/, 'شیاف'],
  [/\b(SPRAY|INHALATION|INHALER|AEROSOL)\b/, 'اسپری و استنشاقی'],
  [/\b(SACHET|POWDER)\b/, 'پودر و ساشه'],
  [/\b(SOLUTION|SOL|LOTION)\b/, 'محلول'],
  [/\b(BULK)\b/, 'فله'],
];

export const FORM_FAMILIES = [...FORM_RULES.map(([, label]) => label), 'سایر'];

/** خانوادهٔ شکل دارویی از روی متن شکل یا نام */
export function formFamily(text: string): string {
  const upper = normalizeText(text).toUpperCase();
  return FORM_RULES.find(([rule]) => rule.test(upper))?.[1] ?? 'سایر';
}

const DOSE = /\d[\d.,]*\s*(?:\[?iu\]?|mcg|ug|mg|gr|g|ml|l|%|u)\b(?:\s*\/\s*\d*[\d.,]*\s*(?:mg|ml|g|l)\b)*/i;

/** اولین دوز داخل نام: «VERAPAMIL HCL 40 mg TABLET» ← «40 mg» */
export function doseOf(name: string): string {
  return DOSE.exec(normalizeText(name))?.[0] ?? '';
}

/** «40 MG» و «40mg» یکی‌اند */
export function doseKey(dose: string | undefined): string {
  return normalizeText(dose).toLowerCase().replace(/\s+/g, '').replace(/gr\b/, 'g');
}

/** بخش نام ژنریک، قبل از اولین دوز */
export function baseName(name: string): string {
  const clean = normalizeText(name);
  const at = clean.search(DOSE);
  return (at > 0 ? clean.slice(0, at) : clean).trim();
}

const NOISE = new Set([
  'HCL', 'HYDROCHLORIDE', 'SODIUM', 'POTASSIUM', 'SULFATE', 'ACETATE', 'AS', 'THE', 'AND', 'ACID', 'ORAL', 'TABLET', 'TAB',
  'CAPSULE', 'CAP', 'INJECTION', 'INJ', 'SOLUTION', 'SUSPENSION', 'PARENTERAL', 'POWDER', 'FOR', 'COATED', 'EXTENDED', 'RELEASE',
]);

const tokenCache = new Map<string, string[]>();

function tokens(name: string): string[] {
  const cached = tokenCache.get(name);
  if (cached) return cached;
  const list = baseName(name)
    .toUpperCase()
    .replace(/[^A-Z0-9؀-ۿ]+/g, ' ')
    .split(' ')
    .filter((t) => t.length > 1 && !NOISE.has(t));
  tokenCache.set(name, list);
  return list;
}

/** کلید نام برای تطبیق بدون کد */
export const nameKey = (name: string) => tokens(name).join('');

function bigrams(text: string): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < text.length - 1; i++) {
    const pair = text.slice(i, i + 2);
    map.set(pair, (map.get(pair) ?? 0) + 1);
  }
  return map;
}

function dice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const left = bigrams(a);
  let hits = 0;
  for (const [pair, count] of bigrams(b)) hits += Math.min(count, left.get(pair) ?? 0);
  return (2 * hits) / (a.length + b.length - 2);
}

/** شباهت دو نام، بین صفر و یک. یک کلمهٔ مشترک یا نوشتار نزدیک، شباهت بالا می‌دهد. */
export function nameSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  let best = dice(ta.join(''), tb.join(''));
  for (const x of ta) {
    for (const y of tb) {
      if (x.length >= 4 && y.length >= 4) best = Math.max(best, dice(x, y));
    }
  }
  return best;
}
