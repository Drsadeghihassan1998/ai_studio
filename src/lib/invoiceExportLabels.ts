import type { PaymentType } from './db';

export const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  cash: 'نقد',
  cheque: 'چک',
  mixed: 'ترکیبی',
  credit: 'نسیه',
};
