import { matchKey, normalizeText } from './text';

// تحلیل نام دارو: شکل دارویی، دوز، داروهای ترکیبی، جستجوی هوشمند و میزان شباهت دو نام.

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

const DOSE = /\d[\d.,]*\s*(?:\[?iu\]?|mcg|ug|mg|gr|g|ml|l|%|u|meq|mmol)\b(?:\s*\/\s*\d*[\d.,]*\s*(?:\[?iu\]?|mcg|ug|mg|gr|g|ml|l|%|u|dose|doses)\b)*/i;
const DOSE_GLOBAL = new RegExp(DOSE.source, 'gi');

const FORM_ROUTE_WORDS = new Set([
  'INJ', 'INJECTION', 'VIAL', 'AMP', 'AMPOULE', 'INFU', 'INFUSION', 'PARENTERAL', 'INTRAVENOUS', 'IV', 'IM', 'SC',
  'TAB', 'TABS', 'TABLET', 'TABLETS', 'TABLETEXTENDED', 'CAP', 'CAPS', 'CAPSULE', 'CAPSULES',
  'SUSP', 'SUSPENSION', 'SUSPENTION', 'SYRUP', 'ELIXIR', 'DROP', 'DROPS', 'CREAM', 'OINT', 'OINTMENT',
  'GEL', 'SUPP', 'SUPPOSITORY', 'SPRAY', 'INHALATION', 'INHALER', 'AEROSOL', 'SACHET', 'POWDER',
  'SOLUTION', 'SOL', 'LOTION', 'BULK', 'ORAL', 'FOR', 'COATED', 'FILM', 'ENTERIC', 'EXTENDED', 'DELAYED',
  'SUSTAINED', 'RELEASE', 'TOPICAL', 'OPHTHALMIC', 'OTIC', 'NASAL', 'RECTAL', 'VAGINAL', 'SUBLINGUAL',
  'CHEWABLE', 'EFFERVESCENT', 'STERILE', 'AQUEOUS', 'PEN', 'PREFILLED', 'SYRINGE',
]);

function cleanIngredientChunk(chunk: string): string {
  const trimmed = chunk.replace(/^[\s+/,\-،؛:]+|[\s+/,\-،؛:]+$/g, '').trim();
  if (!trimmed) return '';
  const words = trimmed.split(/\s+/);
  while (words.length > 0 && FORM_ROUTE_WORDS.has(words[words.length - 1].toUpperCase().replace(/[^A-Z]/g, ''))) {
    words.pop();
  }
  while (words.length > 0 && FORM_ROUTE_WORDS.has(words[0].toUpperCase().replace(/[^A-Z]/g, ''))) {
    words.shift();
  }
  const res = words.join(' ').replace(/^[\s+/,\-،؛:]+|[\s+/,\-،؛:]+$/g, '').trim();
  return /[A-Za-z؀-ۿ]{2,}/.test(res) ? res : '';
}

/** دوز داخل نام؛ در داروهای ترکیبی همهٔ دوزها با « + » کنار هم می‌آیند. */
export function doseOf(name: string): string {
  const clean = normalizeText(name);
  const matches = [...clean.matchAll(DOSE_GLOBAL)].map((m) => m[0].trim());
  return matches.join(' + ');
}

/** «40 MG» و «40mg» یکی‌اند */
export function doseKey(dose: string | undefined): string {
  return normalizeText(dose).toLowerCase().replace(/\s+/g, '').replace(/gr\b/, 'g');
}

/** بخش نام ژنریک؛ در داروهای ترکیبی که دوز وسط نام آمده، همهٔ اجزای ترکیب حفظ می‌شوند. */
export function baseName(name: string): string {
  const clean = normalizeText(name);
  const matches = [...clean.matchAll(DOSE_GLOBAL)];
  if (matches.length === 0) return clean;
  const firstIdx = matches[0].index ?? 0;
  const firstPart = firstIdx > 0 ? clean.slice(0, firstIdx).replace(/[\s+/,\-،؛:]+$/, '').trim() : '';
  const parts: string[] = firstPart ? [firstPart] : [];

  for (let i = 1; i < matches.length; i++) {
    const prevEnd = (matches[i - 1].index ?? 0) + matches[i - 1][0].length;
    const curStart = matches[i].index ?? prevEnd;
    const between = cleanIngredientChunk(clean.slice(prevEnd, curStart));
    if (between) parts.push(between);
  }

  const lastMatch = matches[matches.length - 1];
  const afterLast = clean.slice((lastMatch.index ?? 0) + lastMatch[0].length);
  if (/\+|\/(?=\s*[A-Za-z؀-ۿ]{3,})/.test(afterLast)) {
    const extraSegments = afterLast.split(/\s*(?:\+|\/(?=\s*[A-Za-z؀-ۿ]{3,}))\s*/).slice(1);
    for (const seg of extraSegments) {
      const cleaned = cleanIngredientChunk(seg);
      if (cleaned) parts.push(cleaned);
    }
  }

  return parts.length > 0 ? parts.join(' + ') : clean;
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

// ---------- نمایش کامل و جستجوی هوشمند داروهای ترکیبی ----------

export interface DrugLike {
  id: number;
  genericName: string;
  dose?: string;
  form?: string;
  formFamily?: string;
  names?: string[];
  codes?: string[];
  searchText: string;
  manual?: boolean;
}

/** آیا متن نشان‌دهندهٔ داروی ترکیبی (چندجزئی) است؟ */
export function isComboText(text: string): boolean {
  return /\+|\/(?=\s*[A-Za-z؀-ۿ]{3,})|\bWITH\b|\bAND\b/i.test(text);
}

/**
 * نام کامل نمایشی دارو (با بازسازی اجزای ترکیبی از روی names برای داروهایی که از قبل در بانک ذخیره شده‌اند).
 */
export function fullDrugName(drug: Pick<DrugLike, 'genericName' | 'names' | 'manual'>): string {
  if (drug.manual || !drug.names?.length) return drug.genericName;
  const candidates = [drug.genericName, ...drug.names.map(baseName)].filter(Boolean);
  const combos = candidates.filter(isComboText);
  if (combos.length > 0) {
    return combos.reduce((a, b) => (b.length > a.length ? b : a), combos[0]);
  }
  return candidates.reduce((a, b) => (b.length > a.length ? b : a), drug.genericName);
}

/**
 * دوز کامل نمایشی دارو (با حفظ دوز تمام اجزای داروی ترکیبی).
 */
export function fullDrugDose(drug: Pick<DrugLike, 'dose' | 'names' | 'manual'>): string {
  if (drug.manual || !drug.names?.length) return drug.dose ?? '';
  const candidates = [drug.dose ?? '', ...drug.names.map(doseOf)].filter(Boolean);
  const multiDose = candidates.filter((d) => d.includes('+'));
  if (multiDose.length > 0) {
    return multiDose.reduce((a, b) => (b.length > a.length ? b : a), multiDose[0]);
  }
  return drug.dose || candidates[0] || '';
}

/** برچسب کامل دارو شامل نام کامل (تک‌جزئی یا ترکیبی) و دوز */
export function drugTitle(drug: Pick<DrugLike, 'genericName' | 'dose' | 'names' | 'manual'>): string {
  const name = fullDrugName(drug);
  const dose = fullDrugDose(drug);
  return dose ? `${name} ${dose}` : name;
}

/** تجزیهٔ عبارت جستجو به کلمات مستقل (با پشتیبانی از + ، / ، - ، ویرگول و فاصله) */
export function queryWords(query: string): string[] {
  return matchKey(query)
    .split(/[\s+/,\-،؛()\\]+/)
    .filter(Boolean);
}

/**
 * جستجوی هوشمند دارو:
 * - چه جزء اول داروی ترکیبی نوشته شود، چه جزء دوم، چه هر دو با هر ترتیبی یا با علائم + و / و -
 * - داروهای ترکیبی در کنار داروهای تک‌جزئی در صدر نتایج قرار می‌گیرند و پنهان نمی‌شوند.
 */
export function searchDrugs<T extends DrugLike>(
  drugs: T[],
  query: string,
  aliases: { drugId: number; alias: string }[] = [],
  limit = 25,
): T[] {
  const words = queryWords(query);
  if (words.length === 0) return [];

  const aliasMap = new Map<number, string>();
  for (const a of aliases) {
    aliasMap.set(a.drugId, `${aliasMap.get(a.drugId) ?? ''} ${matchKey(a.alias)}`);
  }

  const wantsCombo = /[+/]/.test(query) || words.length > 1;
  const singles: { drug: T; score: number }[] = [];
  const combos: { drug: T; score: number }[] = [];

  for (const drug of drugs) {
    const fullName = matchKey(fullDrugName(drug));
    const fullDose = matchKey(fullDrugDose(drug));
    const rawHaystack = `${drug.searchText} ${fullName} ${fullDose} ${matchKey(drug.names?.join(' '))} ${aliasMap.get(drug.id) ?? ''}`;
    const cleanHaystack = rawHaystack.replace(/[+/,\-،؛()\\]/g, ' ');

    if (!words.every((w) => rawHaystack.includes(w) || cleanHaystack.includes(w))) continue;

    const combo = isComboText(fullName) || (drug.names ?? []).some(isComboText);
    const cleanName = fullName.replace(/[+/,\-،؛()\\]/g, ' ');

    let score = 0;
    if (cleanName.startsWith(words[0])) score += 4;
    if (words.every((w) => cleanName.includes(w))) score += 3;
    if (aliasMap.get(drug.id)?.includes(words[0])) score += 3;
    if (wantsCombo && combo) score += 5;

    if (combo) combos.push({ drug, score });
    else singles.push({ drug, score });
  }

  singles.sort((a, b) => b.score - a.score);
  combos.sort((a, b) => b.score - a.score);

  if (wantsCombo) {
    return [...combos, ...singles].slice(0, limit).map((x) => x.drug);
  }

  // وقتی یک کلمه نوشته شده (مثلاً جزء اول داروی ترکیبی)، ۳ داروی تک‌جزئی اول و بلافاصله داروهای ترکیبی مرتبط نمایش داده می‌شوند
  const topSingles = singles.slice(0, 3);
  const restSingles = singles.slice(3);
  return [...topSingles, ...combos, ...restSingles].slice(0, limit).map((x) => x.drug);
}

