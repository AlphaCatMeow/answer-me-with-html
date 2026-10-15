// The value axis of a chart. It always includes 0 (no broken axis) and ends on a tick: the first nice tick at or above the peak. limits has its
// own scale (niceScale, with 40% room above the peak, for a bar against a limit); a chart leaves no more room than its value labels need, and
// chart-bar.js reserves that in pixels.

// Large finite numbers are already integers; multiplying them by 1000 can overflow.
const round = (n) => (Number.isInteger(n) ? n : Math.round(n * 1000) / 1000) || 0;
const MANTISSAS = [1, 2, 2.5, 5];
// A chart reads well with up to this many steps from the bottom of the axis to the top.
const MAX_STEPS = 7;

// A number as written on a tick or a bar: no float noise, no sign on zero.
export const fmt = (n) => String(round(n));

// Nice steps, smallest first: 1, 2, 2.5, 5 times a power of ten. Whole numbers only get whole steps.
function* steps(peak, whole) {
  for (let power = Math.floor(Math.log10(peak)) - 2; ; power++) {
    for (const m of MANTISSAS) {
      const step = round(m * 10 ** power);
      if (!whole || Number.isInteger(step)) yield step;
    }
  }
}

// { min, max, step, ticks } for a list of values.
export function niceRange(values) {
  if (values.some((value) => !Number.isFinite(value))) throw new RangeError('chart values must be finite');
  const hi = Math.max(0, ...values);
  const lo = Math.min(0, ...values);
  const peak = Math.max(hi, -lo);
  if (peak === 0) return { min: 0, max: 1, step: 1, ticks: [0, 1] };
  const count = (value, step) => value === 0 ? 0 : Math.max(1, Math.ceil(value / step - 1e-9));
  const whole = values.every(Number.isInteger);
  let step;
  for (step of steps(peak, whole)) if (count(hi, step) + count(-lo, step) <= MAX_STEPS) break;
  const down = count(-lo, step);
  const up = count(hi, step);
  const min = round(-down * step);
  const max = round(up * step);
  if (!Number.isFinite(max - min)) throw new RangeError('chart values are too large to scale');
  const ticks = Array.from({ length: down + up + 1 }, (_, i) => round((i - down) * step));
  return { min, max, step, ticks };
}
