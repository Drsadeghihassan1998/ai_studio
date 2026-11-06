import { coverageShares, type ShareBase } from './calc';
import {
  completeDrug, db, type Coverage, type Drug, type Insurer, type PriceHistory, type PriceList, type ReviewItem,
} from './db';
import { baseName, doseKey, doseOf, formFamily, nameKey, nameSimilarity } from './drugname';
import { matchKey, normalizeText } from './text';

// بانک دارو: ادغام فهرست‌ها، ثبت تغییر قیمت، و محاسبهٔ ستون هر بیمه در کارت دارو.

export const SHARE_BASE_LABEL: Record<ShareBase, string> = {
  price: 'درصد × قیمت',
  netOfSubsidy: 'درصد × (قیمت − یارانه)',
  netPlusSubsidy: 'درصد × (قیمت − یارانه) + یارانه',
  coveredPrice: 'درصد × قیمت مورد تعهد',
};

export const STATUS = {
  covered: 'است',
  none: 'نیست',
  subsidy: 'صرفاً مشمول یارانه دولت',
  special: 'صرفاً مشمول صندوق صعب‌العلاج',
} as const;

export const STATUS_LABELS = Object.values(STATUS);

const SIMILAR_ENOUGH = 0.6;

/** قیمت‌های ۱ و ۲ ریالی در فهرست‌ها جای‌نگهدار هستند، نه قیمت واقعی. */
const MIN_REAL_PRICE = 10;
export const isRealPrice = (price: number | undefined): price is number => (price ?? 0) >= MIN_REAL_PRICE;

/** اگر قیمت یک دارو در دو فهرست بیش از این نسبت فرق داشته باشد، تطبیق مطمئن نیست. */
const PRICE_RATIO_LIMIT = 2;
const PRICE_REASON = 'کد یکی است ولی قیمت دو فهرست بیش از ۲ برابر فرق دارد';

/** یک ردیف فهرست، بعد از نگاشت ستون‌ها */
export interface ListRow {
  brandCode?: string;
  genericCode?: string;
  name: string;
  form?: string;
  dose?: string;
  price?: number;
  netPrice?: number;
  subsidy?: number;
  shareRate?: number;
  nominalRate?: string;
  coveredPrice?: number;
  insurerAmount?: number;
  insurerAmountAll?: number[];
  status?: string;
  conditions?: string;
  hospital?: string;
  caseBased?: string;
  prescribeLimit?: string;
  ePrescription?: string;
  inDocs?: string;
  webOnly?: string;
  minPrice?: number;
  lists?: string;
  effectiveDate?: string;
}

const yes = (text?: string) => /^(بله|است)$/.test(normalizeText(text));

/** کد عددی‌شده در اکسل صفرهای اولش را از دست می‌دهد. */
function cleanCode(code: unknown): string | undefined {
  const text = normalizeText(code);
  if (!text) return undefined;
  return /^\d{1,4}$/.test(text) ? text.padStart(5, '0') : text;
}

function statusOf(row: ListRow): string {
  const text = normalizeText(row.status);
  if (text.includes('یارانه')) return STATUS.subsidy;
  if (text.includes('صعب')) return STATUS.special;
  if (text === 'نیست') return STATUS.none;
  if (text === 'است') return STATUS.covered;
  // فهرست بدون ستون وضعیت (مثل سلامت): از سهم پایه و مبلغ سهم نتیجه می‌گیریم.
  if (/^0%?$/.test(normalizeText(row.nominalRate))) return row.insurerAmount ? STATUS.subsidy : STATUS.none;
  return STATUS.covered;
}

function coverageFrom(row: ListRow, drugId: number, insurerId: number, listKey: string): Omit<Coverage, 'id'> {
  const conditions = normalizeText(row.conditions?.replace(/<br\s*\/?>/gi, ' ؛ '));
  return {
    drugId,
    insurerId,
    listKey,
    price: row.price ?? 0,
    netPrice: row.netPrice,
    subsidy: row.subsidy,
    shareRate: row.shareRate,
    coveredPrice: row.coveredPrice,
    insurerAmount: row.insurerAmount,
    shareOptions: row.insurerAmountAll,
    status: statusOf(row),
    conditions,
    hospitalOnly: row.hospital !== undefined ? yes(row.hospital) : conditions.includes('بیمارستانی'),
    caseBased: yes(row.caseBased),
    prescribeLimit: row.prescribeLimit,
    ePrescription: row.ePrescription,
    inDocs: row.inDocs,
    webOnly: row.webOnly,
    minPrice: row.minPrice,
    lists: normalizeText(row.lists),
    effectiveDate: row.effectiveDate,
    stale: false,
  };
}

type Match = { drug?: Drug; review?: { candidate: Drug; reason: string } };

/** دارو را پیدا می‌کند: اول با کد و بعد با نام + شکل + دوز. تطبیق نامطمئن به «نیاز به بررسی» می‌رود. */
function findDrug(
  row: ListRow,
  dose: string,
  byCode: Map<string, Drug[]>,
  byName: Map<string, Drug[]>,
  taken: (drug: Drug) => boolean,
): Match {
  const codes = [row.brandCode, row.genericCode].filter((c): c is string => Boolean(c));
  const family = formFamily(`${row.form ?? ''} ${row.name}`);
  for (const code of codes) {
    const found = (byCode.get(code) ?? []).filter((d) => !taken(d));
    if (found.length === 0) continue;
    const ranked = found
      .map((drug) => ({ drug, score: Math.max(...drug.names.map((n) => nameSimilarity(n, row.name))) }))
      .sort((a, b) => b.score - a.score);
    if (ranked[0].score >= SIMILAR_ENOUGH) return { drug: ranked[0].drug };
    return { review: { candidate: ranked[0].drug, reason: `کد ${code} یکی است ولی نام‌ها به هم نمی‌خورند` } };
  }
  const sameName = (byName.get(nameKey(row.name)) ?? []).filter((d) => !taken(d));
  const twin = row.brandCode ? byCode.get(row.brandCode)?.find((d) => d.brandCode === row.brandCode) : undefined;
  const exact = sameName.find((d) => d.formFamily === family && doseKey(d.dose) === doseKey(dose) && doseKey(dose) !== '');
  if (exact) return { drug: exact };
  const near = sameName.find((d) => doseKey(d.dose) === doseKey(dose) || d.formFamily === family);
  if (near && doseKey(dose) !== '' && doseKey(near.dose) === doseKey(dose)) {
    return { review: { candidate: near, reason: 'نام و دوز یکی است ولی شکل دارویی فرق دارد' } };
  }
  if (twin) return { review: { candidate: twin, reason: 'این کد در همین فهرست دو بار با مشخصات متفاوت آمده است' } };
  return {};
}

function addTo(index: Map<string, Drug[]>, key: string, drug: Drug) {
  if (!key) return;
  const list = index.get(key);
  if (!list) index.set(key, [drug]);
  else if (!list.includes(drug)) list.push(drug);
}

export interface ListResult {
  added: number;
  updated: number;
  newDrugs: number;
  priceChanged: number;
  review: number;
  stale: number;
  /** ردیف‌هایی که کد و نام و دوزشان با ردیف قبلی همین فایل یکی بود */
  repeated: number;
}

/**
 * فهرست را در بانک می‌نویسد. insurerId تهی یعنی فهرست دارو بدون اطلاعات بیمه.
 * همه‌چیز در یک تراکنش انجام می‌شود: یا کامل یا هیچ.
 */
export async function applyList(
  insurerId: number | null,
  rawRows: ListRow[],
  meta: { fileName: string; shareBase?: ShareBase },
): Promise<ListResult> {
  const batch = new Date().toISOString();
  const result: ListResult = { added: 0, updated: 0, newDrugs: 0, priceChanged: 0, review: 0, stale: 0, repeated: 0 };

  await db.transaction('rw', [db.drugs, db.coverage, db.priceHistory, db.reviewItems, db.priceLists, db.insurers], async () => {
    const drugs = await db.drugs.toArray();
    const byId = new Map(drugs.map((d) => [d.id, d]));
    const byCode = new Map<string, Drug[]>();
    const byName = new Map<string, Drug[]>();
    const index = (drug: Drug) => {
      drug.codes.forEach((c) => addTo(byCode, c, drug));
      drug.names.forEach((n) => addTo(byName, nameKey(n), drug));
    };
    drugs.forEach(index);

    const existing = insurerId === null ? [] : await db.coverage.where('insurerId').equals(insurerId).toArray();
    const byListKey = new Map(existing.map((c) => [c.listKey, c]));
    const usedByList = new Set(existing.map((c) => c.drugId));
    // قیمت این داروها در فهرست بیمه‌های دیگر
    const otherPrices = new Map<number, number[]>();
    for (const c of await db.coverage.toArray()) {
      if (c.insurerId === insurerId || c.stale || !isRealPrice(c.price)) continue;
      otherPrices.set(c.drugId, [...(otherPrices.get(c.drugId) ?? []), c.price]);
    }
    const priceConflict = (target: Drug, price: number) =>
      !target.trustPrices &&
      insurerId !== null &&
      isRealPrice(price) &&
      (otherPrices.get(target.id) ?? []).some((p) => Math.max(p, price) / Math.min(p, price) > PRICE_RATIO_LIMIT);
    const seen = new Set<string>();
    const dirty = new Set<Drug>();
    const covers: Coverage[] = [];
    const history: Omit<PriceHistory, 'id'>[] = [];
    const reviews: Omit<ReviewItem, 'id'>[] = [];

    for (const raw of rawRows) {
      const row: ListRow = { ...raw, brandCode: cleanCode(raw.brandCode), genericCode: cleanCode(raw.genericCode) };
      const dose = row.dose || doseOf(row.name);
      const code = row.brandCode ?? row.genericCode ?? '';
      const listKey = `${code}|${matchKey(row.name)}|${doseKey(dose)}`;
      if (seen.has(listKey)) {
        result.repeated++;
        continue;
      }
      seen.add(listKey);

      const previous = byListKey.get(listKey);
      const newPrice = row.price ?? 0;
      const name = normalizeText(row.name);
      let drug = previous ? byId.get(previous.drugId) : undefined;
      let review: Match['review'];
      if (drug && priceConflict(drug, newPrice)) {
        // ادغامی که در ورود قبلی انجام شده بود مطمئن نیست: این ردیف از آن دارو جدا می‌شود.
        review = { candidate: drug, reason: PRICE_REASON };
        Object.assign(drug, completeDrug({ ...drug, names: drug.names.filter((n) => n !== name) }));
        dirty.add(drug);
        drug = undefined;
      } else if (!drug) {
        // هر ردیف یک فهرست فقط به یک دارو می‌خورد؛ دارویی که این فهرست گرفته دوباره انتخاب نمی‌شود.
        const taken = (d: Drug) => insurerId !== null && usedByList.has(d.id);
        const match = findDrug(row, dose, byCode, byName, taken);
        drug = match.drug;
        review = match.review;
        if (drug && priceConflict(drug, newPrice)) {
          review = { candidate: drug, reason: PRICE_REASON };
          drug = undefined;
        }
      }
      if (!drug) {
        const created = completeDrug({
          genericName: baseName(row.name),
          names: [normalizeText(row.name)],
          codes: [row.brandCode, row.genericCode].filter((c, i, all): c is string => Boolean(c) && all.indexOf(c) === i),
          brandCode: row.brandCode,
          genericCode: row.genericCode,
          form: normalizeText(row.form),
          dose: normalizeText(dose),
          price: row.price ?? 0,
          otc: false,
        }) as Drug;
        created.id = (await db.drugs.add(created)) as number;
        byId.set(created.id, created);
        index(created);
        drug = created;
        result.newDrugs++;
        if (review) reviews.push({ drugId: created.id, candidateId: review.candidate.id, reason: review.reason, status: 'open' });
      }

      const oldPrice = insurerId === null ? drug.price : previous?.price;
      if (oldPrice !== undefined && oldPrice !== newPrice && newPrice > 0 && (previous || insurerId === null)) {
        history.push({ drugId: drug.id, insurerId: insurerId ?? undefined, oldPrice, newPrice, date: batch, batch });
        result.priceChanged++;
      }

      const merged = completeDrug({
        ...drug,
        names: drug.names.includes(name) ? drug.names : [...drug.names, name],
        codes: [...new Set([...drug.codes, row.brandCode, row.genericCode].filter((c): c is string => Boolean(c)))],
        genericCode: drug.genericCode ?? row.genericCode,
        brandCode: drug.brandCode ?? row.brandCode,
        form: drug.form || normalizeText(row.form),
        dose: drug.dose || normalizeText(dose),
        price: newPrice > 0 ? newPrice : drug.price,
      });
      Object.assign(drug, merged);
      index(drug);
      dirty.add(drug);

      if (insurerId !== null) {
        usedByList.add(drug.id);
        covers.push({ ...coverageFrom(row, drug.id, insurerId, listKey), id: previous?.id } as Coverage);
        if (previous) result.updated++;
        else result.added++;
      } else {
        result.added++;
      }
    }

    for (const old of existing) {
      if (!seen.has(old.listKey) && !old.stale && old.listKey !== '') {
        covers.push({ ...old, stale: true });
        result.stale++;
      }
    }

    // قیمت بانک: بیشترین قیمت واقعی فهرست‌ها، تا ترتیب ورود فایل‌ها نتیجه را عوض نکند.
    if (insurerId !== null) {
      const here = new Map<number, number[]>();
      for (const c of covers) {
        if (!c.stale && isRealPrice(c.price)) here.set(c.drugId, [...(here.get(c.drugId) ?? []), c.price]);
      }
      for (const drug of dirty) {
        if (drug.manual) continue;
        const prices = [...(otherPrices.get(drug.id) ?? []), ...(here.get(drug.id) ?? [])];
        drug.price = prices.length ? Math.max(...prices) : 0;
      }
    }

    await db.drugs.bulkPut([...dirty]);
    const fresh = covers.filter((c) => c.id === undefined).map(({ id: _id, ...rest }) => rest);
    await db.coverage.bulkAdd(fresh as Coverage[]);
    await db.coverage.bulkPut(covers.filter((c) => c.id !== undefined));
    await db.priceHistory.bulkAdd(history as never[]);
    await db.reviewItems.bulkAdd(reviews as ReviewItem[]);
    result.review = reviews.length;

    if (insurerId !== null) {
      const insurer = await db.insurers.get(insurerId);
      const list = {
        insurerId,
        fileName: meta.fileName,
        effectiveDate: batch.slice(0, 10),
        importedAt: batch,
        shareBase: meta.shareBase ?? 'price',
      };
      if (insurer?.priceListId) {
        await db.priceLists.update(insurer.priceListId, list);
      } else {
        const id = (await db.priceLists.add(list as PriceList)) as number;
        await db.insurers.update(insurerId, { priceListId: id });
      }
    }
  });
  return result;
}

// ---------- ستون هر بیمه در کارت دارو ----------

export interface InsurerColumn {
  insurer: Insurer;
  kind: 'list' | 'default' | 'free' | 'notListed';
  price: number;
  share: number;
  patient: number;
  status: string;
  hospital?: boolean;
  limit?: string;
  conditions?: string;
  stale?: boolean;
  /** سهم‌های مختلف بسته به شرایط؛ ستون کمترین را نشان می‌دهد */
  options?: number[];
  formula: string;
  inputs: [string, number | string][];
}

export function insurerColumn(
  drug: Pick<Drug, 'price' | 'otc'>,
  insurer: Insurer,
  coverage: Coverage | undefined,
  list: PriceList | undefined,
): InsurerColumn {
  if (coverage && !drug.otc) {
    const price = isRealPrice(coverage.price) ? coverage.price : drug.price;
    const shareBase = coverage.shareBase ?? list?.shareBase ?? 'price';
    const notCovered = coverage.status === STATUS.none;
    const shares = coverageShares({
      price,
      shareBase,
      coveredPrice: coverage.coveredPrice,
      subsidy: coverage.subsidy,
      shareRate: coverage.shareRate,
      insurerAmount: coverage.insurerAmount,
      notCovered,
    });
    const direct = coverage.insurerAmount !== undefined && coverage.insurerAmount !== null;
    return {
      insurer,
      kind: 'list',
      price,
      share: shares.insurer,
      patient: shares.patient,
      status: coverage.status ?? STATUS.covered,
      hospital: coverage.hospitalOnly,
      limit: coverage.prescribeLimit,
      conditions: coverage.conditions,
      stale: coverage.stale,
      options: coverage.shareOptions,
      formula: notCovered
        ? 'این دارو در این بیمه تعهد ندارد؛ کل مبلغ را بیمار می‌دهد.'
        : direct
          ? 'مبلغ سهم سازمان مستقیم از فایل بیمه خوانده شده است.'
          : `سهم سازمان = ${SHARE_BASE_LABEL[shareBase]}`,
      inputs: direct
        ? [['مبلغ سهم سازمان در فایل', coverage.insurerAmount!]]
        : [
            ['قیمت', price],
            ...(coverage.subsidy ? ([['یارانه', coverage.subsidy]] as [string, number][]) : []),
            ...(coverage.coveredPrice ? ([['قیمت مورد تعهد', coverage.coveredPrice]] as [string, number][]) : []),
            ['درصد سهم', `${((coverage.shareRate ?? 0) * 100).toLocaleString('fa-IR', { maximumFractionDigits: 3 })}٪`],
          ],
    };
  }
  if (drug.otc) {
    return {
      insurer, kind: 'free', price: drug.price, share: 0, patient: drug.price, status: 'آزاد',
      formula: 'داروی آزاد: کل مبلغ را بیمار نقد می‌دهد.', inputs: [['قیمت', drug.price]],
    };
  }
  if (insurer.priceListId === null) {
    const share = insurer.defaultShare * drug.price;
    return {
      insurer, kind: 'default', price: drug.price, share, patient: drug.price - share, status: 'سهم پیش‌فرض',
      formula: 'این بیمه فهرست قیمت ندارد. سهم سازمان = درصد سهم پیش‌فرض × قیمت',
      inputs: [
        ['قیمت', drug.price],
        ['سهم پیش‌فرض', `${(insurer.defaultShare * 100).toLocaleString('fa-IR')}٪`],
      ],
    };
  }
  return {
    insurer, kind: 'notListed', price: drug.price, share: 0, patient: drug.price, status: 'در فهرست نیست',
    formula: 'این دارو در فهرست این بیمه نیامده است؛ کل مبلغ را بیمار می‌دهد.', inputs: [['قیمت', drug.price]],
  };
}

// ---------- کارهای دستی ----------

/** دارو را در داروی دیگر ادغام می‌کند. اگر هر دو در یک بیمه تعهد داشته باشند، ادغام انجام نمی‌شود. */
export async function mergeDrugs(fromId: number, intoId: number): Promise<boolean> {
  return db.transaction('rw', [db.drugs, db.coverage, db.priceHistory, db.drugAliases, db.reviewItems], async () => {
    const [from, into] = await Promise.all([db.drugs.get(fromId), db.drugs.get(intoId)]);
    if (!from || !into) return false;
    const fromCover = await db.coverage.where('drugId').equals(fromId).toArray();
    const intoCover = await db.coverage.where('drugId').equals(intoId).toArray();
    if (fromCover.some((c) => intoCover.some((x) => x.insurerId === c.insurerId))) return false;
    await db.coverage.where('drugId').equals(fromId).modify({ drugId: intoId });
    await db.priceHistory.where('drugId').equals(fromId).modify({ drugId: intoId });
    await db.drugAliases.where('drugId').equals(fromId).modify({ drugId: intoId });
    await db.drugs.put(
      completeDrug({
        ...into,
        names: [...new Set([...into.names, ...from.names])],
        codes: [...new Set([...into.codes, ...from.codes])],
        price: Math.max(into.price, from.price),
        trustPrices: true,
      }),
    );
    await db.drugs.delete(fromId);
    await db.reviewItems.where('drugId').equals(fromId).modify({ status: 'merged' });
    await db.reviewItems.where('candidateId').equals(fromId).modify({ status: 'merged' });
    return true;
  });
}

export async function deleteDrug(id: number): Promise<void> {
  await db.transaction('rw', [db.drugs, db.coverage, db.priceHistory, db.drugAliases, db.reviewItems], async () => {
    await db.coverage.where('drugId').equals(id).delete();
    await db.priceHistory.where('drugId').equals(id).delete();
    await db.drugAliases.where('drugId').equals(id).delete();
    await db.reviewItems.where('drugId').equals(id).delete();
    await db.reviewItems.where('candidateId').equals(id).delete();
    await db.drugs.delete(id);
  });
}

export interface ManualDrug {
  id?: number;
  name: string;
  form: string;
  dose: string;
  code: string;
  price: number;
  otc: boolean;
  insurerId: number | null;
  coveredPrice: number;
  shareRate: number;
}

/** افزودن یا ویرایش دستی. اگر بیمه انتخاب شده باشد، سهم آن بیمه با «درصد × قیمت مورد تعهد» حساب می‌شود. */
export async function saveManualDrug(input: ManualDrug): Promise<number> {
  return db.transaction('rw', db.drugs, db.coverage, async () => {
    const name = normalizeText(input.name);
    const code = normalizeText(input.code);
    const current = input.id ? await db.drugs.get(input.id) : undefined;
    const drug = completeDrug({
      ...current,
      genericName: name,
      names: current ? [name, ...current.names.filter((n) => n !== name)] : [name],
      codes: [...new Set([...(current?.codes ?? []), ...(code ? [code] : [])])],
      brandCode: current?.brandCode ?? (code || undefined),
      form: normalizeText(input.form),
      dose: normalizeText(input.dose),
      price: input.price,
      otc: input.otc,
      manual: current ? current.manual : true,
    });
    const id = (await db.drugs.put(drug as Drug)) as number;
    if (input.insurerId !== null && !input.otc) {
      const listKey = `manual|${id}`;
      const previous = await db.coverage.where('[drugId+insurerId]').equals([id, input.insurerId]).first();
      await db.coverage.put({
        ...previous,
        drugId: id,
        insurerId: input.insurerId,
        listKey: previous?.listKey ?? listKey,
        price: input.price,
        coveredPrice: input.coveredPrice || input.price,
        shareRate: input.shareRate,
        insurerAmount: undefined,
        shareBase: 'coveredPrice',
        status: STATUS.covered,
      } as Coverage);
    }
    return id;
  });
}
