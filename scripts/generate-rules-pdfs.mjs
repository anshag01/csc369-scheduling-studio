import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'docs', 'rules');
const preview = path.join(root, 'outputs', 'policy-rules');
const policies = ['FCFS', 'SJF', 'STCF', 'RR', 'MLFQ'];
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const inline = value => escape(value)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

// These controlled source files use headings, paragraphs, lists, and tables.
// Reject unsupported blocks rather than silently dropping document content.
function render(markdown) {
  const source = markdown.replace(/<!-- maintainer-note:start -->[\s\S]*?<!-- maintainer-note:end -->/g, '')
    .replace('## 7. Expiry before boost: retained provisional policy', '## 7. Expiry before boost');
  const lines = source.split(/\r?\n/);
  const html = [];
  let sectionOpen = false;
  let title = '';
  for (let i = 0; i < lines.length;) {
    const line = lines[i].trim();
    if (!line) { i++; continue; }
    if (line.startsWith('# ')) {
      title = line.slice(2);
      html.push(`<h1>${inline(title)}</h1>`); i++; continue;
    }
    if (line.startsWith('## ')) {
      if (sectionOpen) html.push('</section>');
      html.push(`<section class="rule"><h2>${inline(line.slice(3))}</h2>`);
      sectionOpen = true; i++; continue;
    }
    if (line.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(lines[i++].trim().slice(1, -1).split('|').map(cell => cell.trim()));
      if (rows.length < 2 || !rows[1].every(cell => /^:?-+:?$/.test(cell))) throw new Error(`Invalid table: ${line}`);
      const head = rows[0];
      if (rows.some(row => row.length !== head.length)) throw new Error(`Inconsistent table columns: ${line}`);
      html.push(`<table><thead><tr>${head.map(cell => `<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.slice(2).map(row => `<tr>${row.map(cell => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    const ordered = /^\d+\. /.test(line);
    if (ordered || line.startsWith('- ')) {
      const tag = ordered ? 'ol' : 'ul';
      const pattern = ordered ? /^\d+\. / : /^- /;
      const items = [];
      while (i < lines.length && pattern.test(lines[i].trim())) items.push(`<li>${inline(lines[i++].trim().replace(pattern, ''))}</li>`);
      html.push(`<${tag}>${items.join('')}</${tag}>`); continue;
    }
    if (/^(#|>|```|<)/.test(line)) throw new Error(`Unsupported Markdown block: ${line}`);
    const paragraph = [];
    while (i < lines.length && lines[i].trim() && !/^(#|\||- |\d+\. )/.test(lines[i].trim())) paragraph.push(lines[i++].trim());
    html.push(`<p${/^(Example:|Completion example:|Bottom-queue example:|\*\*Example:)/.test(line) ? ' class="example"' : ''}>${inline(paragraph.join(' '))}</p>`);
  }
  if (sectionOpen) html.push('</section>');
  return { title, body: html.join('\n') };
}

const style = `
@page { size: A4; }
* { box-sizing: border-box; }
body { margin: 0; color: #19283d; font: 10pt/1.32 Arial, Helvetica, sans-serif; }
.brand { margin: 0 0 7px; color: #536d98; font-size: 8pt; font-weight: bold; letter-spacing: 1.4px; text-transform: uppercase; }
h1 { margin: 0 0 14px; font-size: 23pt; line-height: 1.13; color: #243d72; }
h2 { margin: 13px 0 6px; padding-bottom: 4px; border-bottom: 1px solid #cbd7eb; font-size: 12pt; line-height: 1.25; break-after: avoid; }
p { margin: 5px 0 7px; orphans: 3; widows: 3; }
.rule { break-inside: avoid; }
ul, ol { margin: 7px 0 10px; padding-left: 21px; }
li { margin: 4px 0; }
code { color: #243d72; font: 9pt/1.45 "DejaVu Sans Mono", monospace; overflow-wrap: anywhere; }
.example { padding: 6px 11px; background: #f0f4fa; border-left: 3px solid #6c86bf; }
table { width: 100%; border-collapse: collapse; margin: 9px 0 12px; font-size: 9pt; line-height: 1.35; }
th { background: #e9eef7; color: #253e70; text-align: left; }
th, td { padding: 5px 8px; border-bottom: 1px solid #dce3ef; vertical-align: top; }
tr { break-inside: avoid; }
`;

await mkdir(output, { recursive: true });
await mkdir(preview, { recursive: true });
const browser = await chromium.launch();
try {
  for (const policy of policies) {
    const markdown = await readFile(path.join(root, `${policy}_RULES.md`), 'utf8');
    const { title, body } = render(markdown);
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(title)} — Rules and Examples</title><style>${style}</style></head><body><p class="brand">Scheduling Studio · Implemented rules</p>${body}</body></html>`;
    await writeFile(path.join(preview, `${policy}_Rules.html`), html);
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'load' });
      await page.pdf({
        path: path.join(output, `${policy}_Rules.pdf`), format: 'A4', printBackground: true,
        tagged: true, outline: true, displayHeaderFooter: true,
        margin: { top: '16mm', right: '17mm', bottom: '19mm', left: '17mm' },
        headerTemplate: '<div></div>',
        footerTemplate: `<div style="font:8px Arial;color:#63718a;width:100%;margin:0 17mm;display:flex;justify-content:space-between"><span>Scheduling Studio · ${policy} · Rules and examples</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
      });
    } finally { await page.close(); }
    console.log(`Created docs/rules/${policy}_Rules.pdf`);
  }
} finally { await browser.close(); }
