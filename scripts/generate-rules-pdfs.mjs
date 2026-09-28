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
  const source = markdown.replace(/<!-- maintainer-note:start -->[\s\S]*?<!-- maintainer-note:end -->/g, '');
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
body { margin: 0; color: #111; font: 11pt/1.35 Arial, Helvetica, sans-serif; }
h1 { margin: 0 0 18px; font-size: 18pt; line-height: 1.2; }
h2 { margin: 17px 0 7px; font-size: 11pt; line-height: 1.3; break-after: avoid; }
p { margin: 7px 0; orphans: 3; widows: 3; }
ul, ol { margin: 7px 0; padding-left: 22px; }
li { margin: 5px 0; break-inside: avoid; }
code { font: 10pt/1.4 "DejaVu Sans Mono", monospace; }
table { border-collapse: collapse; width: 70%; margin: 10px 0 14px; font-size: 10.5pt; }
th { text-align: left; border-bottom: 1px solid #555; }
th, td { padding: 4px 18px 4px 0; }
tr { break-inside: avoid; }
`;

await mkdir(output, { recursive: true });
await mkdir(preview, { recursive: true });
const browser = await chromium.launch();
try {
  for (const policy of policies) {
    const markdown = await readFile(path.join(root, `${policy}_RULES.md`), 'utf8');
    const { title, body } = render(markdown);
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(title)} — Rules</title><style>${style}</style></head><body>${body}</body></html>`;
    await writeFile(path.join(preview, `${policy}_Rules.html`), html);
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'load' });
      await page.pdf({
        path: path.join(output, `${policy}_Rules.pdf`), format: 'A4', printBackground: true,
        tagged: true, outline: true, displayHeaderFooter: true,
        margin: { top: '18mm', right: '20mm', bottom: '18mm', left: '20mm' },
        headerTemplate: '<div></div>',
        footerTemplate: `<div style="font:9px Arial;color:#666;width:100%;margin:0 20mm;display:flex;justify-content:space-between"><span>${policy}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
      });
    } finally { await page.close(); }
    console.log(`Created docs/rules/${policy}_Rules.pdf`);
  }
} finally { await browser.close(); }
