import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import type { CashMonth } from '../lib/cashflow';
import { compactParts, fromRial, fullMoney } from '../lib/format';
import { MONTH_NAMES } from '../lib/jalali';
import { useUnit } from './SettingsContext';

// نمودارهای ساده با SVG. محور زمان راست‌به‌چپ است: ماه اول سمت راست.

const HEIGHT = 240;
const PAD = { top: 16, bottom: 28, start: 16, end: 72 };

export const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)'];

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    if (!ref.current) return;
    setWidth(ref.current.clientWidth || 640);
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width || 640));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

const monthShort = (key: string) => MONTH_NAMES[Number(key.split('-')[1]) - 1];

function niceTicks(low: number, high: number): number[] {
  const span = high - low || 1;
  const raw = span / 4;
  const size = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map((n) => n * size).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = Math.ceil(low / step) * step; v <= high; v += step) ticks.push(v);
  return ticks;
}

function useAxis(months: CashMonth[], width: number) {
  const inner = width - PAD.start - PAD.end;
  const step = months.length > 1 ? inner / (months.length - 1) : inner;
  /** ماه اول سمت راست */
  const x = (i: number) => width - PAD.end - i * step;
  const every = Math.max(1, Math.ceil(months.length / Math.max(2, Math.floor(inner / 72))));
  return { x, step, every };
}

function Tooltip({ x, width, children }: { x: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(x, 96), width - 96);
  return (
    <div
      className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg border border-line bg-card px-2 py-1 text-note whitespace-nowrap shadow-card"
      style={{ left }}
    >
      {children}
    </div>
  );
}

const AxisLabel = ({ x, y, children, anchor = 'middle' }: { x: number; y: number; children: ReactNode; anchor?: 'start' | 'middle' | 'end' }) => (
  <text x={x} y={y} textAnchor={anchor} fontSize={12} fill="var(--muted)" style={{ fontFamily: 'var(--font-sans)' }}>
    {children}
  </text>
);

function useTick() {
  const unit = useUnit();
  return (rial: number) => {
    const { value, scale } = compactParts(Math.abs(fromRial(rial, unit)));
    return `${rial < 0 ? '−' : ''}${value} ${scale}`;
  };
}

/** نمودار موجودی پایان ماه با خط حداقل امن. نقطهٔ قرمز یعنی زیر حداقل یا منفی. */
export function CashChart({ months, minSafe }: { months: CashMonth[]; minSafe: number }) {
  const unit = useUnit();
  const tick = useTick();
  const { ref, width } = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const { x, step, every } = useAxis(months, width);

  const values = months.map((m) => m.end);
  const low = Math.min(0, minSafe, ...values);
  const high = Math.max(0, minSafe, ...values) || 1;
  const pad = (high - low) * 0.08;
  const top = high + pad;
  const bottom = low - (low < 0 ? pad : 0);
  const y = (v: number) => PAD.top + ((top - v) / (top - bottom)) * (HEIGHT - PAD.top - PAD.bottom);
  const line = months.map((m, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(m.end).toFixed(1)}`).join(' ');
  const limit = Math.max(minSafe, 0);

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left + PAD.start;
    setHover(Math.min(months.length - 1, Math.max(0, Math.round((x(0) - px) / (step || 1)))));
  };
  const active = hover === null ? null : months[hover];

  return (
    <div ref={ref} className="relative" dir="ltr" style={{ contain: 'inline-size' }}>
      <svg width={width} height={HEIGHT} role="img" aria-label="نمودار موجودی نقد ماه‌به‌ماه">
        {niceTicks(bottom, top).map((v) => (
          <g key={v}>
            <line x1={PAD.start} x2={width - PAD.end} y1={y(v)} y2={y(v)} stroke="var(--line)" />
            <AxisLabel x={width - PAD.end + 8} y={y(v) + 4} anchor="start">{tick(v)}</AxisLabel>
          </g>
        ))}
        <line x1={PAD.start} x2={width - PAD.end} y1={y(minSafe)} y2={y(minSafe)} stroke="var(--warn)" strokeWidth={1.5} strokeDasharray="6 4" />
        <path d={line} fill="none" stroke="var(--primary)" strokeWidth={2} strokeLinejoin="round" />
        {months.map((m, i) =>
          m.end < limit ? <circle key={m.key} cx={x(i)} cy={y(m.end)} r={4} fill="var(--bad)" stroke="var(--card)" strokeWidth={2} /> : null,
        )}
        {months.map((m, i) =>
          i % every === 0 ? <AxisLabel key={m.key} x={x(i)} y={HEIGHT - 8}>{monthShort(m.key)}</AxisLabel> : null,
        )}
        {active && (
          <>
            <line x1={x(hover!)} x2={x(hover!)} y1={PAD.top} y2={HEIGHT - PAD.bottom} stroke="var(--muted)" />
            <circle cx={x(hover!)} cy={y(active.end)} r={4} fill="var(--primary)" stroke="var(--card)" strokeWidth={2} />
          </>
        )}
        <rect
          x={PAD.start}
          y={0}
          width={Math.max(0, width - PAD.start - PAD.end)}
          height={HEIGHT}
          fill="transparent"
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      {active && (
        <Tooltip x={x(hover!)} width={width}>
          <span dir="rtl">ماه {active.index.toLocaleString('fa-IR')}، {monthShort(active.key)}: {fullMoney(active.end, unit)}</span>
        </Tooltip>
      )}
      <p dir="rtl" className="mt-1 flex items-center gap-2 text-note text-muted">
        <span className="inline-block h-0 w-6 border-t-2 border-dashed border-warn" aria-hidden />
        حداقل موجودی امن
      </p>
    </div>
  );
}

export interface StackSeries {
  key: number;
  name: string;
  color: string;
}

/** ستون‌های انباشته: هر ماه جمع طلب، به تفکیک بیمه. */
export function StackedBars({
  months,
  series,
  valueOf,
  label,
}: {
  months: CashMonth[];
  series: StackSeries[];
  valueOf: (month: CashMonth, key: number) => number;
  label: string;
}) {
  const unit = useUnit();
  const tick = useTick();
  const { ref, width } = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const { x, step, every } = useAxis(months, width);
  const totals = months.map((m) => series.reduce((s, r) => s + valueOf(m, r.key), 0));
  const top = Math.max(...totals, 1) * 1.05;
  const y = (v: number) => PAD.top + ((top - v) / top) * (HEIGHT - PAD.top - PAD.bottom);
  const bar = Math.max(4, Math.min(28, step - 4));
  const active = hover === null ? null : months[hover];

  return (
    <div ref={ref} className="relative" dir="ltr" style={{ contain: 'inline-size' }}>
      <svg width={width} height={HEIGHT} role="img" aria-label={label}>
        {niceTicks(0, top).map((v) => (
          <g key={v}>
            <line x1={PAD.start} x2={width - PAD.end} y1={y(v)} y2={y(v)} stroke="var(--line)" />
            <AxisLabel x={width - PAD.end + 8} y={y(v) + 4} anchor="start">{tick(v)}</AxisLabel>
          </g>
        ))}
        {months.map((m, i) => {
          let base = 0;
          return (
            <g key={m.key} onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)} onPointerLeave={() => setHover(null)}>
              <rect x={x(i) - step / 2} y={0} width={Math.max(step, 8)} height={HEIGHT} fill="transparent" />
              {series.map((s) => {
                const value = valueOf(m, s.key);
                if (value <= 0) return null;
                const y1 = y(base + value);
                const height = Math.max(1, y(base) - y1 - 2);
                base += value;
                return <rect key={s.key} x={x(i) - bar / 2} y={y1} width={bar} height={height} rx={2} fill={s.color} />;
              })}
              {i % every === 0 && <AxisLabel x={x(i)} y={HEIGHT - 8}>{monthShort(m.key)}</AxisLabel>}
            </g>
          );
        })}
      </svg>
      {active && (
        <Tooltip x={x(hover!)} width={width}>
          <div dir="rtl">
            <div className="font-medium">ماه {active.index.toLocaleString('fa-IR')}، {monthShort(active.key)}</div>
            {series.map((s) => (
              <div key={s.key}>{s.name}: {fullMoney(valueOf(active, s.key), unit)}</div>
            ))}
          </div>
        </Tooltip>
      )}
      <ul dir="rtl" className="mt-2 flex flex-wrap gap-4 text-note">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-1">
            <span className="inline-block size-3 rounded-sm" style={{ background: s.color }} aria-hidden />
            {s.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** نمودار خطی ساده با چند سری؛ مقدار هر سری از ماه صفر شروع می‌شود. */
export function LinesChart({
  series,
  label,
}: {
  series: { name: string; color: string; values: number[] }[];
  label: string;
}) {
  const unit = useUnit();
  const tick = useTick();
  const { ref, width } = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const count = Math.max(...series.map((s) => s.values.length));
  const inner = width - PAD.start - PAD.end;
  const step = count > 1 ? inner / (count - 1) : inner;
  const x = (i: number) => width - PAD.end - i * step;
  const all = series.flatMap((s) => s.values);
  const low = Math.min(0, ...all);
  const high = Math.max(0, ...all) || 1;
  const y = (v: number) => PAD.top + ((high - v) / (high - low || 1)) * (HEIGHT - PAD.top - PAD.bottom);
  const every = Math.max(1, Math.ceil(count / Math.max(2, Math.floor(inner / 48))));

  const onMove = (e: PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left + PAD.start;
    setHover(Math.min(count - 1, Math.max(0, Math.round((x(0) - px) / (step || 1)))));
  };

  return (
    <div ref={ref} className="relative" dir="ltr" style={{ contain: 'inline-size' }}>
      <svg width={width} height={HEIGHT} role="img" aria-label={label}>
        {niceTicks(low, high).map((v) => (
          <g key={v}>
            <line x1={PAD.start} x2={width - PAD.end} y1={y(v)} y2={y(v)} stroke="var(--line)" />
            <AxisLabel x={width - PAD.end + 8} y={y(v) + 4} anchor="start">{tick(v)}</AxisLabel>
          </g>
        ))}
        {series.map((s) => (
          <path
            key={s.name}
            d={s.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinejoin="round"
          />
        ))}
        {Array.from({ length: count }, (_, i) =>
          i % every === 0 ? <AxisLabel key={i} x={x(i)} y={HEIGHT - 8}>{i.toLocaleString('fa-IR')}</AxisLabel> : null,
        )}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={HEIGHT - PAD.bottom} stroke="var(--muted)" />}
        <rect
          x={PAD.start}
          y={0}
          width={Math.max(0, inner)}
          height={HEIGHT}
          fill="transparent"
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      {hover !== null && (
        <Tooltip x={x(hover)} width={width}>
          <div dir="rtl">
            <div className="font-medium">ماه {hover.toLocaleString('fa-IR')}</div>
            {series.map((s) => (
              <div key={s.name}>{s.name}: {fullMoney(s.values[hover] ?? 0, unit)}</div>
            ))}
          </div>
        </Tooltip>
      )}
      <ul dir="rtl" className="mt-2 flex flex-wrap gap-4 text-note">
        {series.map((s) => (
          <li key={s.name} className="flex items-center gap-1">
            <span className="inline-block h-1 w-4 rounded-sm" style={{ background: s.color }} aria-hidden />
            {s.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
