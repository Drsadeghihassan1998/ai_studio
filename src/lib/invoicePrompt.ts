// متن پرامپت استخراج فاکتور؛ عیناً همان متنی است که در دستور مرحلهٔ ۳ آمده.
export const INVOICE_PROMPT = `فایل پیوست، فاکتور خرید یک داروخانه از یک شرکت پخش داروی ایرانی است (ممکن است اسکن یا عکس باشد). همهٔ اطلاعات را فقط به شکل یک JSON معتبر با ساختار زیر برگردان و هیچ متن دیگری ننویس.
قواعد:
- اعداد بدون کاما و با ارقام لاتین. مبالغ به ریال؛ اگر فاکتور به تومان است، در ۱۰ ضرب کن و در currency_note بنویس.
- تاریخ‌ها شمسی و به شکل YYYY/MM/DD.
- هر چیزی که خوانا نیست null بگذار و در warnings بنویس. هیچ عددی را حدس نزن.
- اگر جایزه، بونوس یا اشانتیون در ستون یا سطر جدا آمده، آن را در bonus_qty همان قلم بگذار.
- در پایان، جمع line_total سطرها را با جمع فاکتور مقایسه کن و هر اختلافی را در warnings بنویس.
{
 "distributor": "", "invoice_no": "", "invoice_date": "",
 "payment": {"type": "cash|cheque|mixed|credit", "cheque_months": null, "due_date": null, "notes": ""},
 "items": [{"row": 1, "name": "", "irc": null, "generic_code": null, "form": null, "strength": null, "batch": null, "expiry": null, "qty": 0, "bonus_qty": 0, "unit_price": 0, "consumer_price": null, "discount_percent": 0, "discount_amount": 0, "tax_amount": 0, "line_total": 0}],
 "totals": {"gross": 0, "discount": 0, "tax": 0, "payable": 0},
 "currency_note": "", "warnings": []
}`;
