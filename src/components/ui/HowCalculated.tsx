import { useState, type ReactNode } from 'react';
import { CircleHelp } from 'lucide-react';
import { Drawer } from './Drawer';

/** نشانهٔ «این عدد چطور حساب شد؟» کنار عددهای مهم */
export function HowCalculated({
  title,
  formula,
  inputs,
  result,
}: {
  title: string;
  formula: string;
  inputs: [string, ReactNode][];
  result?: [string, ReactNode];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={`این عدد چطور حساب شد؟ ${title}`}
        title="این عدد چطور حساب شد؟"
        onClick={() => setOpen(true)}
        className="-m-3 flex size-11 shrink-0 items-center justify-center text-muted hover:text-primary"
      >
        <CircleHelp size={16} aria-hidden />
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title="این عدد چطور حساب شد؟">
        <h3 className="font-medium">{title}</h3>
        <p className="mt-4 rounded-xl bg-app p-4">{formula}</p>
        <dl className="mt-4">
          {inputs.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 border-b border-line py-2">
              <dt className="text-muted">{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
          {result && (
            <div className="flex justify-between gap-4 py-2 font-bold">
              <dt>{result[0]}</dt>
              <dd>{result[1]}</dd>
            </div>
          )}
        </dl>
      </Drawer>
    </>
  );
}
