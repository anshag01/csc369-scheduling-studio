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

// A From / To / CPU table stays readable in Markdown and becomes a timeline in print.
function schedule(rows, number) {
  const spans = rows.map(([from, to, cpu]) => ({ from: Number(from), to: Number(to), cpu }));
  if (!spans.length || spans.some((span, i) =>
    !Number.isSafeInteger(span.from) || !Number.isSafeInteger(span.to) ||
    span.from < 0 || span.to <= span.from || !span.cpu ||
    (i > 0 && span.from !== spans[i - 1].to)
  )) throw new Error('CPU schedules must contain contiguous, positive whole-tick intervals.');
  const start = spans[0].from;
  const end = spans.at(-1).to;
  const x = time => 16 + (time - start) / (end - start) * 568;
  const cells = spans.map(span => {
    const left = x(span.from);
    const width = x(span.to) - left;
    return `<rect x="${left}" y="8" width="${width}" height="32" fill="white" stroke="#222" stroke-width="0.8"/><text x="${left + width / 2}" y="29" text-anchor="middle">${escape(span.cpu)}</text><text class="tick" x="${left}" y="60" text-anchor="middle">${span.from}</text>`;
  }).join('');
  const description = spans.map(span => `${span.cpu} from ${span.from} to ${span.to}`).join('; ');
  return `<figure><svg viewBox="0 0 600 70" role="img" aria-label="${escape(description)}"><title>${escape(description)}</title>${cells}<text class="tick" x="${x(end)}" y="60" text-anchor="middle">${end}</text></svg><figcaption>Figure ${number}. CPU schedule (time in ticks).</figcaption></figure>`;
}

// Support only the Markdown used by these documents; reject unsupported blocks.
function render(markdown) {
  const source = markdown.replace(/<!-- maintainer-note:start -->[\s\S]*?<!-- maintainer-note:end -->/g, '');
  if (source.includes('\u2014')) throw new Error('Use sentences or ordinary punctuation, not em dashes.');
  const lines = source.split(/\r?\n/);
  const html = [];
  let sectionOpen = false;
  let subsectionOpen = false;
  let title = '';
  let figureNumber = 0;
  const closeSubsection = () => {
    if (subsectionOpen) html.push('</div>');
    subsectionOpen = false;
  };
  for (let i = 0; i < lines.length;) {
    const line = lines[i].trim();
    if (!line) { i++; continue; }
    if (line === '```text') {
      const diagram = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '```') diagram.push(lines[i++]);
      if (i === lines.length) throw new Error('Unclosed ASCII diagram.');
      if (diagram.some(row => /[^\x20-\x7e]/.test(row))) throw new Error('Diagrams must use printable ASCII characters and spaces.');
      html.push(`<pre class="ascii-diagram"><code>${escape(diagram.join('\n'))}</code></pre>`);
      i++;
      continue;
    }
    if (line.startsWith('# ')) {
      title = line.slice(2);
      html.push(`<h1>${inline(title)}</h1>`); i++; continue;
    }
    if (line.startsWith('## ')) {
      closeSubsection();
      if (sectionOpen) html.push('</section>');
      const sectionClass = line.includes('Worked example') ? 'worked-example'
        : line.includes('Events at a tick boundary') ? 'boundary-order' : '';
      html.push(`<section${sectionClass ? ` class="${sectionClass}"` : ''}><h2>${inline(line.slice(3))}</h2>`);
      sectionOpen = true; i++; continue;
    }
    if (line.startsWith('### ')) {
      closeSubsection();
      const heading = line.slice(4);
      html.push(`<div class="${heading.startsWith('Rule ') ? 'rule' : 'subsection'}"><h3>${inline(heading)}</h3>`);
      subsectionOpen = true; i++; continue;
    }
    if (line.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(lines[i++].trim().slice(1, -1).split('|').map(cell => cell.trim()));
      if (rows.length < 2 || !rows[1].every(cell => /^:?-+:?$/.test(cell))) throw new Error(`Invalid table: ${line}`);
      const head = rows[0];
      if (rows.some(row => row.length !== head.length)) throw new Error(`Inconsistent table columns: ${line}`);
      if (head.join('|') === 'From|To|CPU') {
        html.push(schedule(rows.slice(2), ++figureNumber));
      } else {
        html.push(`<table><thead><tr>${head.map(cell => `<th scope="col">${inline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.slice(2).map(row => `<tr>${row.map(cell => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      }
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
    while (i < lines.length && lines[i].trim() && !/^(#|\||```|- |\d+\. )/.test(lines[i].trim())) paragraph.push(lines[i++].trim());
    html.push(`<p>${inline(paragraph.join(' '))}</p>`);
  }
  closeSubsection();
  if (sectionOpen) html.push('</section>');
  return { title, body: html.join('\n') };
}

const style = `
@page { size: A4; }
* { box-sizing: border-box; }
body { margin: 0; color: #171717; font: 11pt/1.4 "TeX Gyre Pagella", "Palatino Linotype", "Book Antiqua", "Liberation Serif", serif; }
h1 { margin: 0 0 14pt; font-size: 23pt; line-height: 1.18; font-weight: normal; text-wrap: balance; }
h2 { margin: 15pt 0 7pt; font-size: 14pt; line-height: 1.25; break-after: avoid; }
h3 { margin: 9pt 0 4pt; font-size: 11pt; line-height: 1.35; break-after: avoid; }
p { margin: 0 0 6pt; orphans: 3; widows: 3; break-inside: avoid; }
.rule, .subsection, .worked-example, .boundary-order { break-inside: avoid; }
h2 + p, p:has(+ ol), p:has(+ ul), p:has(+ figure), p:has(+ table), p:has(+ pre) { break-after: avoid; }
ul, ol { margin: 6pt 0 10pt; padding-left: 20pt; break-inside: avoid; }
li { margin: 4pt 0; padding-left: 2pt; break-inside: avoid; }
code { font: 9pt/1.4 "DejaVu Sans Mono", monospace; }
.ascii-diagram { margin: 8pt 0 10pt; padding: 5pt 0 5pt 10pt; border-left: 0.7pt solid #aaa; white-space: pre; break-inside: avoid; }
.ascii-diagram code { font: 9.5pt/1.4 "DejaVu Sans Mono", monospace; font-variant-ligatures: none; }
table { border-collapse: collapse; width: 100%; margin: 12pt 0; border-top: 1pt solid #222; border-bottom: 1pt solid #222; font-size: 10.5pt; line-height: 1.3; break-inside: avoid; }
th { text-align: left; border-bottom: 0.6pt solid #555; font-weight: normal; font-style: italic; }
th, td { padding: 4pt 8pt; vertical-align: top; }
tr { break-inside: avoid; }
figure { margin: 10pt 0 10pt; break-inside: avoid; }
svg { display: block; width: 100%; font: 15px "TeX Gyre Pagella", "Liberation Serif", serif; overflow: visible; }
svg .tick { font-size: 13px; }
figcaption { margin-top: 3pt; text-align: center; font-size: 9.5pt; font-style: italic; }
`;

await mkdir(output, { recursive: true });
await mkdir(preview, { recursive: true });
const browser = await chromium.launch();
try {
  for (const policy of policies) {
    const markdown = await readFile(path.join(root, `${policy}_RULES.md`), 'utf8');
    const { title, body } = render(markdown);
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(title)}</title><style>${style}</style></head><body>${body}</body></html>`;
    await writeFile(path.join(preview, `${policy}_Rules.html`), html);
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      // Check diagrams at the actual printable A4 width before producing a PDF.
      await page.setViewportSize({ width: Math.floor((210 - 46) * 96 / 25.4), height: 1000 });
      const overflow = await page.locator('.ascii-diagram').evaluateAll(nodes =>
        nodes.filter(node => node.scrollWidth > node.clientWidth + 1).map(node => node.textContent));
      if (overflow.length) throw new Error(`${policy}: ASCII diagram exceeds the printable width: ${overflow[0]}`);
      await page.pdf({
        path: path.join(output, `${policy}_Rules.pdf`), format: 'A4', printBackground: true,
        tagged: true, outline: true, displayHeaderFooter: true,
        margin: { top: '22mm', right: '23mm', bottom: '22mm', left: '23mm' },
        headerTemplate: `<div style="font:9px 'Times New Roman',serif;color:#555;width:100%;margin:0 23mm;padding-bottom:5px;border-bottom:0.5px solid #aaa;display:flex;justify-content:space-between"><span>CSC369 · CPU Scheduling</span><span>${policy}</span></div>`,
        footerTemplate: '<div style="font:10px \'Times New Roman\',serif;color:#333;width:100%;text-align:center"><span class="pageNumber"></span></div>',
      });
    } finally { await page.close(); }
    console.log(`Created docs/rules/${policy}_Rules.pdf`);
  }
} finally { await browser.close(); }
