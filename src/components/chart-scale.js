// The value axis of a chart. It always includes 0 (no broken axis) and ends on a tick. niceScale (limits.js) gives the scale for values
// of 0 or more; with negative values one step serves both sides of the zero line.
import { niceScale } from './limits.js';

const round = (n) => Math.round(n * 1000) / 1000 || 0;

// A number as written on a tick or a bar: no float noise, no sign on zero.
export const fmt = (n) => String(round(n));

// { min, max, step, ticks } for a list of values. Values of 0 or more give exactly the scale limits draws.
export function niceRange(values) {
  const hi = Math.max(0, ...values);
  const lo = Math.min(0, ...values);
  let min = 0;
  let max;
  let step;
  if (lo === 0) {
    ({ max, step } = niceScale(hi));
  } else {
    // niceScale leaves 40% room above its peak; the whole span is the peak here, so the room is already counted.
    const peak = (hi - lo) / 1.4;
    ({ step } = niceScale(values.every(Number.isInteger) ? Math.ceil(peak) : peak));
    min = round(-Math.ceil(-lo / step - 1e-9) * step);
    max = round(Math.ceil(hi / step - 1e-9) * step);
  }
  const ticks = [];
  for (let i = 0; min + i * step <= max + 1e-9; i++) ticks.push(round(min + i * step));
  return { min, max, step, ticks };
}
