import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './lib/db';
import { useRoute } from './lib/route';
import { SettingsContext } from './components/SettingsContext';
import { Shell } from './components/layout/Shell';
import { ToastProvider } from './components/ui/Toast';
import { PageSkeleton } from './components/ui/basics';
import { Dashboard } from './components/Dashboard';
import { Settings } from './components/Settings';
import { Insurers } from './components/Insurers';
import { ImportHub } from './components/ImportHub';
import { DrugBank } from './components/DrugBank';
import { Invoices } from './components/Invoices';
import { ItemProfit } from './components/ItemProfit';
import { Cheques } from './components/Cheques';
import { Doctors } from './components/Doctors';
import { Cashflow } from './components/Cashflow';
import { Offers } from './components/Offers';

export function App() {
  const settings = useLiveQuery(() => db.settings.get('main'));
  const route = useRoute();

  useEffect(() => {
    if (settings) document.documentElement.dataset.theme = settings.theme;
  }, [settings?.theme]);

  if (!settings) {
    return (
      <div className="mx-auto max-w-[1200px] p-6">
        <PageSkeleton />
      </div>
    );
  }

  return (
    <SettingsContext value={settings}>
      <ToastProvider>
        <Shell route={route}>
          {route === 'dashboard' && <Dashboard />}
          {route === 'settings' && <Settings />}
          {route === 'insurers' && <Insurers />}
          {route === 'import' && <ImportHub />}
          {route === 'drugs' && <DrugBank />}
          {route === 'invoices' && <Invoices />}
          {route === 'profit' && <ItemProfit />}
          {route === 'cheques' && <Cheques />}
          {route === 'doctors' && <Doctors />}
          {route === 'cashflow' && <Cashflow />}
          {route === 'offers' && <Offers />}
        </Shell>
      </ToastProvider>
    </SettingsContext>
  );
}
