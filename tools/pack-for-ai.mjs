// همهٔ متن پروژه را در یک فایل جمع می‌کند تا به هوش مصنوعی‌های وبی داده شود.
// خروجی: dist/project-for-ai.txt (این پوشه به مخزن نمی‌رود)
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FIRST = ['AGENTS.md', 'docs/BRIEF.md', 'package.json', 'vite.config.ts', 'tsconfig.json', 'index.html'];
const FOLDERS = ['src', 'tests', 'tools'];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name).replaceAll('\\', '/');
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = [...FIRST, ...FOLDERS.flatMap(walk)];
const parts = [
  'این فایل کل متن پروژهٔ «مالی داروخانه» است. اول بخش AGENTS.md را بخوان و قواعدش را رعایت کن.',
  'هر فایل با خط «===== FILE: مسیر =====» شروع می‌شود. وقتی کدی را تغییر می‌دهی، مسیر فایل و متن کامل آن را برگردان.',
  '',
];
for (const file of files) parts.push(`===== FILE: ${file} =====`, readFileSync(file, 'utf8').trimEnd(), '');

mkdirSync('dist', { recursive: true });
const text = parts.join('\n');
writeFileSync('dist/project-for-ai.txt', text);
console.log(`dist/project-for-ai.txt: ${files.length} فایل، ${Math.round(text.length / 1024)} کیلوبایت`);
