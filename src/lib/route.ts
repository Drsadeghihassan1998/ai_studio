import { useEffect, useState } from 'react';

// مسیر صفحه در نشانی بعد از # نگه داشته می‌شود تا برنامه از روی فایل هم درست باز شود.

export const ROUTES = [
  'dashboard', 'cashflow', 'offers', 'invoices', 'profit', 'cheques', 'drugs', 'doctors', 'insurers', 'import', 'settings',
] as const;

export type Route = (typeof ROUTES)[number];

function read(): Route {
  const hash = location.hash.replace(/^#\/?/, '') as Route;
  return ROUTES.includes(hash) ? hash : 'dashboard';
}

export const go = (route: Route) => {
  location.hash = `/${route}`;
};

export function useRoute(): Route {
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => {
      setRoute(read());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
