// Bar charts, vertical and horizontal, drawn as a static svg like flow and sequence. The layout runs left to right; a right-to-left page
// draws its mirror image (the first row on the right, horizontal bars growing to the left). Numbers and text anchors keep their names:
// the svg's direction="rtl" turns "start" into the right end of the text, which is the mirror of the left-to-right placement.
import { esc, measure, wrap } from '../svg/text.js';
import { f, svgOpen, mirror } from '../svg/shapes.js';
import { svgLine, svgNumber } from '../bidi.js';
import { niceRange, fmt } from './chart-scale.js';

const PAD = 8;
const FS = { cat: 12, tick: 11, val: 11, legend: 12 }; // chart.css sets the same sizes
const LH = 14;
const GAP = 3; // between the bars of one row
const LEGEND_LH = 18;
const MAX_VALUE_LABELS = 12; // up to this many bars carry their value
const BAR_W = [0, 34, 26, 22, 18, 16, 14]; // vertical bar width by series count
const BAR_H = [0, 20, 15, 12, 10, 9, 8]; // horizontal bar height by series count
const GUTTER = 24; // between the groups of a vertical chart
const MAX_WIDTH = 880; // width the groups of a vertical chart share
const SLOT_MAX = 104;
const PLOT_H = 220;
const PLOT_W = 420;
const CAT_WIDTH = 180; // the label column of a horizontal chart
const SLANT = 40;
const SLANT_MAX = 140;
const [COS, SIN] = [Math.cos((SLANT * Math.PI) / 180), Math.sin((SLANT * Math.PI) / 180)];

// data: { series: [name] | null, rows: [{ label, values, hi }] }; unit is added to the ticks and the value labels.
export function drawBars(data, { horizontal = false, unit = '', dir = 'ltr', label }) {
  const { rows } = data;
  const count = rows[0].values.length;
  const m = {
    rows,
    count,
    names: data.series ?? [],
    range: niceRange(rows.flatMap((r) => r.values)),
    labels: rows.length * count <= MAX_VALUE_LABELS,
    unit,
    rtl: dir === 'rtl',
    dir,
    anyHi: rows.some((r) => r.hi),
  };
  m.tick = (v) => `${fmt(v)}${unit}`;
  const box = horizontal ? horizontalBars(m) : verticalBars(m);
  return `${svgOpen(box.width, box.height, label, dir)}${box.body.join('')}</svg>`;
}

// ── Pieces both directions share ──

// The text cut to fit, with an ellipsis; the whole text is the tooltip of the label.
function shorten(text, max, size) {
  if (measure(text, size) <= max) return text;
  const chars = [...text];
  while (chars.length > 1 && measure(`${chars.join('')}…`, size) > max) chars.pop();
  return `${chars.join('').trimEnd()}…`;
}

// A label in at most maxLines lines of at most maxWidth.
function fitLines(label, maxWidth, maxLines, size) {
  const lines = wrap(label, maxWidth, size);
  const kept = lines.slice(0, maxLines);
  kept[kept.length - 1] = [kept.at(-1), ...lines.slice(maxLines)].join(' ');
  return kept.map((l) => shorten(l, maxWidth, size));
}

// Ticks and values are numbers: they read left to right in every language. Everything else is text and goes through svgLine.
const NUMBERS = new Set(['am-ch-tick', 'am-ch-val']);
const text = (cls, x, y, str, dir, attrs = '') => `<text class="${cls}" x="${f(x)}" y="${f(y)}"${attrs}>${esc(NUMBERS.has(cls) ? svgNumber(str, dir) : svgLine(str, dir))}</text>`;

// The legend: a swatch and a name for each series, wrapped to maxWidth. Positions are relative to the legend's left edge.
function legendLayout(names, maxWidth) {
  if (names.length < 2) return { items: [], height: 0 };
  const items = [];
  let [x, y] = [0, 0];
  for (const [k, name] of names.entries()) {
    const w = 16 + measure(name, FS.legend);
    if (x > 0 && x + w > maxWidth) [x, y] = [0, y + LEGEND_LH];
    items.push({ k, name, x, y, w });
    x += w + 18;
  }
  return { items, height: y + LEGEND_LH + 6, width: Math.max(...items.map((i) => i.x + i.w)) };
}

function legendSvg({ items }, left, top, { rtl, dir }, W) {
  return items.map(({ k, name, x, y, w }) => {
    const sw = rtl ? W - (left + x) - 10 : left + x;
    return `<rect class="am-ch-sw am-ch-s${k + 1}" x="${f(sw)}" y="${f(top + y + 2)}" width="10" height="10" rx="2"/>${text('am-ch-leg', rtl ? W - (left + x + 16) : left + x + 16, top + y + 7, name, dir, ' dominant-baseline="central"')}`;
  }).join('');
}

// The classes of a bar. A highlighted row of a single series takes the accent color; a chart with a highlight mutes its other rows.
const barClass = (m, row, k) => `am-ch-bar ${row.hi && m.count === 1 ? 'am-ch-hi' : `am-ch-s${k + 1}`}`;
const rowClass = (m, row) => `am-ch-row${m.anyHi ? (row.hi ? ' is-hi' : ' is-dim') : ''}`;
const rowGroup = (m, row, i, title, inner) => `<g data-step="${i}" class="${rowClass(m, row)}">${title}${inner}</g>`;
const squash = (s) => s.replace(/\s/g, '');
const tooltip = (label, shown) => (squash(label) === squash(shown) ? '' : `<title>${esc(label)}</title>`);

// ── Vertical bars ──

// The category labels of a vertical chart: flat in at most two lines when the slot holds them (the slot may grow), else slanted and
// cut to SLANT_MAX. The slot is the room of one row.
function planCategories(labels, from, to) {
  for (let slot = from; slot <= to; slot += 6) {
    const lines = labels.map((l) => wrap(l, slot - 8, FS.cat));
    if (lines.every((ls) => ls.length <= 2 && ls.every((l) => measure(l, FS.cat) <= slot - 8 + 0.5))) return { slot, lines };
  }
  return { slot: from, lines: null, shown: labels.map((l) => shorten(l, SLANT_MAX, FS.cat)) };
}

function verticalBars(m) {
  const { rows, count, range, labels, rtl, dir } = m;
  const n = rows.length;
  const valueW = labels ? Math.max(...rows.flatMap((r) => r.values.map((v) => measure(m.tick(v), FS.val)))) : 0;
  const barMax = Math.min(64, Math.max(BAR_W[count], labels ? Math.ceil(valueW) + 4 : 0));
  const budget = Math.floor(MAX_WIDTH / n);
  const natural = Math.min(budget, count * barMax + (count - 1) * GAP + GUTTER);
  const plan = planCategories(rows.map((r) => r.label), natural, Math.max(natural, Math.min(budget, SLOT_MAX)));
  const slot = plan.slot;
  const bw = Math.max(6, Math.min(barMax, Math.floor((slot - Math.min(GUTTER, slot * 0.3) - (count - 1) * GAP) / count)));

  const tickW = Math.max(...range.ticks.map((t) => measure(m.tick(t), FS.tick)));
  // A slanted label ends at its bar and reaches back to the left: make room for the first ones.
  const reach = plan.lines ? 0 : Math.max(...plan.shown.map((l, i) => measure(l, FS.cat) * COS + FS.cat * SIN - ((i + 0.5) * slot + PAD + tickW + 9)));
  const axisX = PAD + Math.max(0, reach) + tickW + 6;
  const legend = legendLayout(m.names, Math.max(n * slot + tickW, 240));
  const W = Math.ceil(Math.max(axisX + n * slot + PAD, (legend.width ?? 0) + 2 * PAD));
  const plotTop = PAD + legend.height + (labels ? 16 : 6);
  const plotBottom = plotTop + PLOT_H;
  const negLabels = labels && range.min < 0;
  const catTop = plotBottom + (negLabels ? 18 : 8);
  const catH = plan.lines ? Math.max(...plan.lines.map((ls) => ls.length)) * LH + 4 : Math.max(...plan.shown.map((l) => measure(l, FS.cat))) * SIN + 12;
  const height = catTop + catH + PAD;

  const X = mirror(W, rtl);
  const rectX = (x, w) => (rtl ? W - x - w : x);
  const y = (v) => plotTop + ((range.max - v) / (range.max - range.min)) * PLOT_H;
  const y0 = y(0);
  const body = [legendSvg(legend, PAD, PAD, m, W)];
  for (const t of range.ticks) {
    const line = t === 0 ? 'am-ch-zero' : 'am-ch-grid';
    body.push(`<line class="${line}" x1="${f(rectX(axisX, n * slot))}" y1="${f(y(t))}" x2="${f(rectX(axisX, n * slot) + n * slot)}" y2="${f(y(t))}"/>`);
    body.push(text('am-ch-tick', X(axisX - 6), y(t), m.tick(t), dir, ' text-anchor="end" dominant-baseline="central"'));
  }
  for (const [i, row] of rows.entries()) {
    const x0 = axisX + i * slot;
    const cx = x0 + slot / 2;
    const gx = x0 + (slot - (count * bw + (count - 1) * GAP)) / 2;
    const parts = row.values.map((v, k) => {
      const x = gx + k * (bw + GAP);
      const h = Math.max(Math.abs(y(v) - y0), v === 0 ? 0 : 1);
      const top = v >= 0 ? y0 - h : y0;
      const bar = `<rect class="${barClass(m, row, k)}" x="${f(rectX(x, bw))}" y="${f(top)}" width="${bw}" height="${f(h)}" rx="2"/>`;
      if (!labels) return bar;
      const at = v >= 0 ? top - 4 : top + h + FS.val + 1;
      return bar + text('am-ch-val', X(x + bw / 2), at, m.tick(v), dir, ' text-anchor="middle"');
    });
    let name;
    let shown = row.label;
    if (plan.lines) {
      name = plan.lines[i].map((l, j) => text('am-ch-cat', X(cx), catTop + 11 + j * LH, l, dir, ' text-anchor="middle"')).join('');
    } else {
      shown = plan.shown[i];
      const [ax, ay] = [X(cx + 3), catTop + 4];
      name = text('am-ch-cat', ax, ay, shown, dir, ` text-anchor="end" transform="rotate(${rtl ? SLANT : -SLANT} ${f(ax)} ${f(ay)})"`);
    }
    body.push(rowGroup(m, row, i, tooltip(row.label, plan.lines ? row.label : shown), parts.join('') + name));
  }
  return { width: W, height, body };
}

// ── Horizontal bars ──

function horizontalBars(m) {
  const { rows, count, range, labels, rtl, dir } = m;
  const n = rows.length;
  const lines = rows.map((r) => fitLines(r.label, CAT_WIDTH, 3, FS.cat));
  const catW = Math.max(...lines.flat().map((l) => measure(l, FS.cat)));
  const bh = BAR_H[count];
  const rowH = Math.max(count * bh + (count - 1) * GAP + 12, Math.max(...lines.map((ls) => ls.length)) * LH + 6);
  const rel = (v) => ((v - range.min) / (range.max - range.min)) * PLOT_W; // distance from the start of the scale
  const widths = rows.map((r) => r.values.map((v) => (labels ? measure(m.tick(v), FS.val) : 0)));
  // A value label sits past the end of its bar: room for it on the right of the scale, or on the left when the bar is negative.
  const after = labels ? Math.max(0, ...rows.flatMap((r, i) => r.values.map((v, k) => (v >= 0 ? rel(v) + 4 + widths[i][k] - PLOT_W : 0)))) : 0;
  const before = labels ? Math.max(0, ...rows.flatMap((r, i) => r.values.map((v, k) => (v < 0 ? widths[i][k] + 4 - rel(v) : 0)))) : 0;
  const tickHalf = Math.max(...range.ticks.map((t) => measure(m.tick(t), FS.tick))) / 2;
  const catX = PAD + catW;
  const axisX = Math.max(catX + 8 + before, PAD + tickHalf);
  const legend = legendLayout(m.names, Math.max(catW + PLOT_W, 240));
  const W = Math.ceil(Math.max(axisX + PLOT_W + Math.max(after, tickHalf) + PAD, (legend.width ?? 0) + 2 * PAD));
  const plotTop = PAD + legend.height + 4;
  const plotBottom = plotTop + n * rowH;
  const height = plotBottom + 22 + PAD;

  const X = mirror(W, rtl);
  const x = (v) => axisX + rel(v);
  const x0 = x(0);
  const body = [legendSvg(legend, PAD, PAD, m, W)];
  for (const t of range.ticks) {
    const line = t === 0 ? 'am-ch-zero' : 'am-ch-grid';
    body.push(`<line class="${line}" x1="${f(X(x(t)))}" y1="${f(plotTop)}" x2="${f(X(x(t)))}" y2="${f(plotBottom)}"/>`);
    body.push(text('am-ch-tick', X(x(t)), plotBottom + 14, m.tick(t), dir, ' text-anchor="middle"'));
  }
  for (const [i, row] of rows.entries()) {
    const top = plotTop + i * rowH;
    const gy = top + (rowH - (count * bh + (count - 1) * GAP)) / 2;
    const parts = row.values.map((v, k) => {
      const by = gy + k * (bh + GAP);
      const [from, to] = [Math.min(x0, x(v)), Math.max(x0, x(v))];
      const w = Math.max(to - from, v === 0 ? 0 : 1);
      const bar = `<rect class="${barClass(m, row, k)}" x="${f(rtl ? W - from - w : from)}" y="${f(by)}" width="${f(w)}" height="${bh}" rx="2"/>`;
      if (!labels) return bar;
      const end = v >= 0 ? x(v) + 4 : x(v) - 4;
      return bar + text('am-ch-val', X(end), by + bh / 2, m.tick(v), dir, ` text-anchor="${v >= 0 ? 'start' : 'end'}" dominant-baseline="central"`);
    });
    const first = top + rowH / 2 - ((lines[i].length - 1) * LH) / 2;
    const name = lines[i].map((l, j) => text('am-ch-cat', X(catX), first + j * LH, l, dir, ' text-anchor="end" dominant-baseline="central"')).join('');
    body.push(rowGroup(m, row, i, tooltip(row.label, lines[i].join(' ')), parts.join('') + name));
  }
  return { width: W, height, body };
}
