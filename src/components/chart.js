// A chart from a table of numbers: the chart type follows the fence name, the data is `label | value | value`, like limits.
// This file reads the table and writes the data table under the drawing; chart-bar.js draws it.
import { esc } from '../svg/text.js';
import { diagramLabel } from '../svg/shapes.js';
import { parseAttrs } from '../parse.js';
import { ComponentError, contentLines, fields } from './error.js';
import { drawBars } from './chart-bar.js';
import { fmt } from './chart-scale.js';

const NUMBER = /^[+-]?\d+(?:\.\d+)?$/;
const MAX_ROWS = 24;
const MAX_SERIES = 6;
// Types the next release adds: named here so the error says what to use today.
const LATER = new Set(['line', 'pie']);
// The labels in the page language (src/languages/<id>.js sets its own). Without a context (component unit tests) they are English.
const EN_WORDS = { name: 'Chart', data: 'Data' };

export default {
  name: 'chart',
  summary: 'Bar chart from a table of numbers',
  syntax: `\`\`\`chart bar [horizontal] [unit=ms]
          | p50 | p95   ← names the series; needed for 2+ numbers
* Redis    | 12  | 40    ← * highlights the row
Memcached  | 9   | 31
\`\`\`
- Types: bar (vertical bars) and bar horizontal. Each line is a label and one number for each series.
- A first line whose values are not numbers names the series; its label cell may be empty. With more than one number on a row this line is required. Write 1 to 6 series and up to ${MAX_ROWS} rows.
- Numbers are plain: an optional + or -, digits, an optional decimal point. A negative value draws below the zero line. The axis starts at 0.
- unit=% (or ms, KB) is added to the axis and the value labels as it is; unit=" ms" gives a space. The panel title is the chart title, so there is no title=.
- * before a label highlights the row: with one series its bar uses the accent color, with several it keeps its series colors. The other rows turn gray.
- With more than one series the chart has a legend. Up to 12 bars carry their value; a collapsed table under the chart holds all the numbers.`,
  example: '```chart bar unit=ms\n       | p50 | p95\n* Redis     | 12  | 40\nMemcached   | 9   | 31\nPostgres    | 28  | 95\n```',
  render(text, { args = '', dir = 'ltr', ui, video } = {}) {
    const options = parseOptions(args);
    const data = parseChart(text);
    const words = { ...EN_WORDS, ...ui?.chart };
    const label = diagramLabel({ ...ui, chart: words.name }, 'chart', data.rows.map((r) => r.label));
    const svg = drawBars(data, { horizontal: options.horizontal, unit: options.unit, dir, label });
    // A video has no use for a collapsed table: nobody opens it.
    return `<figure class="am-diagram am-chart">${svg}${video ? '' : dataTable(data, options.unit, words.data)}</figure>`;
  },
};

// { type, horizontal, unit } from the words after chart: bar, horizontal, unit=ms.
export function parseOptions(args) {
  const attrs = parseAttrs(args);
  const words = Object.keys(attrs).filter((k) => attrs[k] === true);
  const [type, ...modifiers] = words;
  if (!type) throw new ComponentError('chart needs a type: write ```chart bar', 0);
  if (LATER.has(type)) throw new ComponentError(`chart ${type} is not supported yet; use bar`, 0);
  if (type !== 'bar') throw new ComponentError(`unknown chart type "${type}"; use bar`, 0);
  const unknown = modifiers.find((w) => w !== 'horizontal');
  if (unknown) throw new ComponentError(`chart bar has no "${unknown}" option; use horizontal`, 0);
  const extra = Object.keys(attrs).find((k) => attrs[k] !== true && k !== 'unit');
  if (extra) throw new ComponentError(`chart has no ${extra}= option; the only option is unit= (the panel title is the chart title)`, 0);
  return { type, horizontal: modifiers.includes('horizontal'), unit: typeof attrs.unit === 'string' ? attrs.unit : '' };
}

// { series: [name] | null, rows: [{ label, values, hi, line }] } from the lines of the table.
export function parseChart(text) {
  const lines = contentLines(text);
  if (!lines.length) throw new ComponentError('chart needs a table: a label and a number on each line', 1);
  const head = fields(lines[0].text).slice(1);
  const named = head.length > 0 && head.every((cell) => !NUMBER.test(cell));
  const series = named ? head : null;
  if (named && head.includes('')) throw new ComponentError(`chart: a series name is empty: "${lines[0].text}"`, lines[0].line);
  const body = named ? lines.slice(1) : lines;
  if (!body.length) throw new ComponentError('chart needs at least one row of numbers under the series names', lines[0].line);
  const width = series ? series.length : fields(body[0].text).length - 1;
  const where = series ? lines[0] : body[0];
  if (!series && width > 1) {
    throw new ComponentError(`chart: a row with ${width} numbers needs a first line that names the series, like "| ${Array.from({ length: width }, (_, i) => `name ${i + 1}`).join(' | ')}": "${where.text}"`, where.line);
  }
  if (width < 1) throw new ComponentError(`chart line needs a label and a number: "${where.text}"`, where.line);
  if (width > MAX_SERIES) throw new ComponentError(`chart takes up to ${MAX_SERIES} series, not ${width}: "${where.text}"`, where.line);
  const rows = body.map(({ text: t, line }, i) => {
    if (i >= MAX_ROWS) throw new ComponentError(`chart takes up to ${MAX_ROWS} rows; this is row ${i + 1}`, line);
    return parseRow(t, line, width, series);
  });
  return { series, rows };
}

function parseRow(t, line, width, series) {
  const [first, ...cells] = fields(t);
  const hi = first.startsWith('*');
  const label = hi ? first.slice(1).trim() : first;
  if (!label) throw new ComponentError(`chart line needs a label before the first |: "${t}"`, line);
  if (cells.length !== width) {
    const shape = series ? `label | ${series.map(() => 'number').join(' | ')}` : `label${' | number'.repeat(width)}`;
    throw new ComponentError(`chart line has ${cells.length} value${cells.length === 1 ? '' : 's'}, expected ${width} (${shape}): "${t}"`, line);
  }
  const bad = cells.find((c) => !NUMBER.test(c));
  if (bad !== undefined) {
    throw new ComponentError(`chart value "${bad}" is not a number: "${t}"; write plain numbers like 12, -3 or 4.5 and put the unit in unit=`, line);
  }
  return { label, values: cells.map(Number), hi, line };
}

// The numbers as a table, collapsed under the chart: a screen reader reads it and a reader can copy the numbers.
function dataTable({ series, rows }, unit, summary) {
  const head = series ? `<thead><tr><td></td>${series.map((s) => `<th scope="col">${esc(s)}</th>`).join('')}</tr></thead>` : '';
  const body = rows.map((r) => `<tr><th scope="row">${esc(r.label)}</th>${r.values.map((v) => `<td dir="ltr">${esc(fmt(v) + unit)}</td>`).join('')}</tr>`);
  return `<details class="am-ch-data"><summary>${esc(summary)}</summary><div class="am-table-wrap"><table>${head}<tbody>${body.join('')}</tbody></table></div></details>`;
}
