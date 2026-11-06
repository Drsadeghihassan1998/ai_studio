import { useEffect, useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { faNumber, fromRial, toRial, UNIT_LABEL } from '../../lib/format';
import { faDate } from '../../lib/format';
import { MONTH_NAMES, monthKey, parseJalaliDate } from '../../lib/jalali';
import { parseNumber } from '../../lib/text';
import { useUnit } from '../SettingsContext';

const BOX = 'min-h-11 w-full rounded-xl border border-line bg-card px-4 text-ink';

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: ReactNode;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-note font-medium">
        {label}
      </label>
      {children(id)}
      {hint && <p className="mt-1 text-note text-muted">{hint}</p>}
    </div>
  );
}

export function TextField({
  label,
  hint,
  ...props
}: { label: string; hint?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  return <Field label={label} hint={hint}>{(id) => <input id={id} {...props} className={BOX} />}</Field>;
}

/** ورودی عدد: ارقام فارسی و لاتین را می‌پذیرد و با جداکننده نشان می‌دهد. */
function NumberBox({
  id,
  value,
  onChange,
  suffix,
  grouped,
}: {
  id: string;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
  grouped: boolean;
}) {
  const show = (n: number) => (grouped ? faNumber(n) : n.toLocaleString('fa-IR', { useGrouping: false, maximumFractionDigits: 4 }));
  const [text, setText] = useState(show(value));

  useEffect(() => {
    if ((parseNumber(text) ?? 0) !== value) setText(show(value));
  }, [value]);

  return (
    <div className="relative">
      <input
        id={id}
        dir="ltr"
        inputMode="decimal"
        autoComplete="off"
        value={text}
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          const n = parseNumber(e.target.value);
          if (e.target.value.trim() === '') {
            setText('');
            onChange(0);
          } else if (n !== null && n >= 0) {
            setText(grouped ? show(n) : e.target.value);
            onChange(n);
          } else if (!grouped) {
            setText(e.target.value);
          }
        }}
        onBlur={() => setText(show(value))}
        className={`${BOX} ${suffix ? 'ps-16' : ''} text-left`}
      />
      {suffix && (
        <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-note text-muted">{suffix}</span>
      )}
    </div>
  );
}

export function NumberField({
  label,
  hint,
  value,
  onChange,
  suffix,
}: {
  label: string;
  hint?: ReactNode;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      {(id) => <NumberBox id={id} value={value} onChange={onChange} suffix={suffix} grouped={false} />}
    </Field>
  );
}

/** درصد: در پایگاه داده کسر است و اینجا به درصد نشان داده می‌شود. */
export function PercentField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: ReactNode;
  value: number;
  onChange: (fraction: number) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <NumberBox
          id={id}
          value={Math.round(value * 1_000_000) / 10_000}
          onChange={(n) => onChange(n / 100)}
          suffix="٪"
          grouped={false}
        />
      )}
    </Field>
  );
}

/** مبلغ: به ریال ذخیره و با واحد انتخاب‌شده نشان داده می‌شود. */
export function MoneyField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: ReactNode;
  value: number;
  onChange: (rial: number) => void;
}) {
  const unit = useUnit();
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <NumberBox
          key={unit}
          id={id}
          value={fromRial(value, unit)}
          onChange={(n) => onChange(toRial(n, unit))}
          suffix={UNIT_LABEL[unit]}
          grouped
        />
      )}
    </Field>
  );
}

/** تاریخ شمسی به شکل ۱۴۰۵/۰۸/۱۵؛ در پایگاه داده میلادی ذخیره می‌شود. */
export function DateField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: ReactNode;
  value: string | null;
  onChange: (iso: string | null) => void;
}) {
  const [text, setText] = useState(value ? faDate(value) : '');
  const [bad, setBad] = useState(false);

  useEffect(() => {
    if (parseJalaliDate(text) !== value && value) setText(faDate(value));
  }, [value]);

  return (
    <Field label={label} hint={bad ? <span className="text-bad">تاریخ را به شکل ۱۴۰۵/۰۸/۱۵ بنویسید.</span> : hint}>
      {(id) => (
        <input
          id={id}
          dir="ltr"
          inputMode="numeric"
          autoComplete="off"
          placeholder="۱۴۰۵/۰۸/۱۵"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            onChange(parseJalaliDate(e.target.value));
          }}
          onBlur={() => setBad(text.trim() !== '' && parseJalaliDate(text) === null)}
          className={`${BOX} text-left`}
        />
      )}
    </Field>
  );
}

export function SelectBox({
  id,
  value,
  onChange,
  options,
  label,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  label?: string;
}) {
  return (
    <select id={id} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={BOX}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function MonthField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: ReactNode;
  value: string;
  onChange: (month: string) => void;
}) {
  const [y, m] = value.split('-').map(Number);
  const years = Array.from({ length: 16 }, (_, i) => y - 5 + i);
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <div className="grid grid-cols-2 gap-2">
          <SelectBox
            id={id}
            value={String(m)}
            onChange={(v) => onChange(monthKey(y, Number(v)))}
            options={MONTH_NAMES.map((name, i) => ({ value: String(i + 1), label: name }))}
          />
          <SelectBox
            label={`سال ${label}`}
            value={String(y)}
            onChange={(v) => onChange(monthKey(Number(v), m))}
            options={years.map((year) => ({
              value: String(year),
              label: year.toLocaleString('fa-IR', { useGrouping: false }),
            }))}
          />
        </div>
      )}
    </Field>
  );
}

/** تنظیمات کمتر مهم، بسته و در پایین فرم */
export function MoreSettings({ children }: { children: ReactNode }) {
  return (
    <details className="group">
      <summary className="flex min-h-11 items-center text-primary">تنظیمات بیشتر</summary>
      <div className="mt-2 grid gap-4">{children}</div>
    </details>
  );
}
