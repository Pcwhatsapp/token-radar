// The token radar's fitted value model, version radar-3: every value term is
// fitted to the snapshot's own token protocols, not chosen by hand.
//
// The fit is an ordinary least squares regression of log market cap on the
// protocol's own figures, over the token protocols the snapshot carries:
//
//   log(mcap) = b0 + b1*log(TVL) + b2*log(1 + age_days)
//             + b3*growth_7d + b4*extra_chains + b5*age_unknown
//             + category_offset
//
//   growth_7d  the seven-day TVL change, clamped to -60%..+120%, in units
//              of 100% (so b3 is the log effect of a full doubling)
//   extra_chains  the chains beyond the first, capped at four
//   age_unknown  1 when the snapshot records no listing date (age then
//              takes the median age of the token protocols)
//   category_offset  the shrunken mean residual of the category's token
//              protocols, weight n / (n + 5), so a category with one
//              protocol barely moves the prediction
//
// The fit set excludes the token protocols whose market cap / TVL is over
// 10x (seven of them, up to 400x: aave-v2, anvil, bitway-earn,
// flokifi-locker, mantle-bridge, nexo, rain). They are not comparable
// launches — mostly exchange or locker products with a tiny TVL against a
// large market cap — and leaving them in flips the growth coefficient
// negative, which no reader would believe. The exclusion is stated in the
// dashboard's methodology, with the count.
//
// Validation is out-of-sample, not in-sample: a deterministic 80/20 split
// by slug hash fits the specification on the train set and scores it on the
// held-out set, beside the same split scored by the radar-2 median model
// (per-category median multiple, market median fallback). The dashboard
// shows both, so the fit's gain is a measured number, not a claim.
//
// The fitted multiple is clamped to 0.005x..5x as a safety net only; on
// this snapshot it binds on no board row.

import type { Snapshot, SnapshotProtocol } from './model.ts';

const DAY_MS = 86_400_000;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** The median of a non-empty list, else `fallback`. */
function median(values: number[], fallback: number): number {
  if (values.length === 0) return fallback;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A small deterministic hash: the 80/20 split is the same every run. */
function slugHash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}

/** The six features of one protocol, in the regression's order. */
export function features(p: SnapshotProtocol, asOf: string, medianAge: number): number[] {
  const age = ageDays(asOf, p.listed_at);
  return [
    1,
    Math.log(p.tvl_usd),
    Math.log1p(age === null ? medianAge : age),
    clamp(p.change_7d ?? 0, -60, 120) / 100,
    Math.min(Math.max((p.chains?.length ?? 1) - 1, 0), 4),
    age === null ? 1 : 0,
  ];
}

/** Least squares by the normal equations, solved by Gauss-Jordan with partial pivoting. */
export function ols(rows: number[][], y: number[]): number[] {
  const k = rows[0]!.length;
  const xtx: number[][] = Array.from({ length: k }, () => Array<number>(k).fill(0));
  const xty: number[] = Array<number>(k).fill(0);
  for (let i = 0; i < rows.length; i++) {
    for (let a = 0; a < k; a++) {
      xty[a]! += rows[i]![a]! * y[i]!;
      for (let b = 0; b < k; b++) xtx[a]![b]! += rows[i]![a]! * rows[i]![b]!;
    }
  }
  for (let a = 1; a < k; a++) xtx[a]![a]! += 1e-8;
  const a: number[][] = xtx.map((r, i) => [...r, xty[i]!]);
  for (let col = 0; col < k; col++) {
    let piv = col;
    for (let r = col + 1; r < k; r++) if (Math.abs(a[r]![col]!) > Math.abs(a[piv]![col]!)) piv = r;
    [a[col], a[piv]] = [a[piv]!, a[col]!];
    const d = a[col]![col]!;
    for (let r = 0; r < k; r++) {
      if (r === col) continue;
      const f = a[r]![col]! / d;
      for (let c = col; c <= k; c++) a[r]![c]! -= f * a[col]![c]!;
    }
  }
  return a.map((r, i) => r[k]! / a[i]![i]!);
}

/** The shrunken mean residual per category, weight n / (n + shrink). */
function categoryOffsets(
  rows: SnapshotProtocol[],
  residuals: number[],
  shrink: number,
): Map<string, number> {
  const sums = new Map<string, { sum: number; n: number }>();
  rows.forEach((p, i) => {
    const key = p.category ?? 'Uncategorised';
    const e = sums.get(key) ?? { sum: 0, n: 0 };
    e.sum += residuals[i]!;
    e.n++;
    sums.set(key, e);
  });
  const out = new Map<string, number>();
  for (const [key, e] of sums) out.set(key, (e.sum / e.n) * (e.n / (e.n + shrink)));
  return out;
}

/** R-squared of `predicted` against `actual`. */
function rSquared(actual: number[], predicted: number[]): number {
  const mean = actual.reduce((a, b) => a + b, 0) / actual.length;
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < actual.length; i++) {
    ssTot += (actual[i]! - mean) ** 2;
    ssRes += (actual[i]! - predicted[i]!) ** 2;
  }
  return ssTot === 0 ? 0 : 1 - ssRes / ssTot;
}

/** The median absolute error, in log units. */
function medianAbsError(actual: number[], predicted: number[]): number {
  const errs = actual.map((y, i) => Math.abs(y - predicted[i]!)).sort((a, b) => a - b);
  return errs[Math.floor(errs.length / 2)]!;
}

/** The radar-2 median model, for the out-of-sample comparison: per-category median multiple, market median fallback. */
export function v2MedianLogMcap(p: SnapshotProtocol, train: SnapshotProtocol[]): number {
  const market = median(
    train.map((t) => t.mcap_usd! / t.tvl_usd),
    0.2,
  );
  const inCategory = train.filter((t) => (t.category ?? 'Uncategorised') === (p.category ?? 'Uncategorised'));
  const multiple = inCategory.length >= 3 ? median(inCategory.map((t) => t.mcap_usd! / t.tvl_usd), market) : market;
  return Math.log(p.tvl_usd * multiple);
}

/** One point of the fitted-vs-actual chart: log TVL, log actual mcap, log fitted mcap. */
export interface FitChartPoint {
  tvl: number;
  actual: number;
  fitted: number;
}

/** The fitted model's summary, as the dashboard shows it. */
export interface FittedModel {
  version: string;
  /** The six coefficients, in the features' order. */
  coefficients: number[];
  coefficientNames: string[];
  medianAgeDays: number;
  /** The category offsets, as sorted [category, offset, protocols] rows. */
  categoryOffsets: { category: string; offset: number; protocols: number }[];
  /** The token protocols the fit ran on. */
  fitProtocols: number;
  /** The token protocols excluded for mcap / TVL over 10x. */
  excludedProtocols: number;
  excludedSlugs: string[];
  /** The multiple's safety clamp. */
  multipleClamp: [number, number];
  r2InSample: number;
  /** Out-of-sample (20% held out): the fitted spec vs the radar-2 median model. */
  outOfSample: {
    testProtocols: number;
    fittedR2: number;
    fittedMedianAbsLogError: number;
    v2R2: number;
    v2MedianAbsLogError: number;
  };
  /** A deterministic sample of the fit set for the fitted-vs-actual chart. */
  chart: FitChartPoint[];
  /** The fitted multiples on the token set, for the chart's axis. */
  multipleRange: [number, number];
  /** The median seven-day TVL change of the fit set, in per cent. */
  medianGrowthPct: number;
}

/** The fitted value model, derived from the snapshot's own token protocols. */
export function fitValueModel(snapshot: Snapshot): {
  model: FittedModel;
  predictLogMcap: (p: SnapshotProtocol) => number;
  fittedMultiple: (p: SnapshotProtocol) => number;
} {
  const token = snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  const excluded = token.filter((p) => p.mcap_usd! / p.tvl_usd > 10);
  const fitSet = token.filter((p) => p.mcap_usd! / p.tvl_usd <= 10);
  const knownAges = fitSet
    .map((p) => ageDays(snapshot.as_of, p.listed_at))
    .filter((a): a is number => a !== null)
    .sort((a, b) => a - b);
  const medianAge = knownAges[Math.floor(knownAges.length / 2)] ?? 365;

  const beta = ols(
    fitSet.map((p) => features(p, snapshot.as_of, medianAge)),
    fitSet.map((p) => Math.log(p.mcap_usd!)),
  );
  const basePredict = (p: SnapshotProtocol): number =>
    features(p, snapshot.as_of, medianAge).reduce((s, x, j) => s + x * beta[j]!, 0);
  const residuals = fitSet.map((p) => Math.log(p.mcap_usd!) - basePredict(p));
  const offsets = categoryOffsets(fitSet, residuals, 5);
  const predictLogMcap = (p: SnapshotProtocol): number =>
    basePredict(p) + (offsets.get(p.category ?? 'Uncategorised') ?? 0);
  const fittedMultiple = (p: SnapshotProtocol): number => {
    const mult = Math.exp(predictLogMcap(p)) / p.tvl_usd;
    return Math.min(5, Math.max(0.005, mult));
  };

  // In-sample fit quality.
  const actualAll = fitSet.map((p) => Math.log(p.mcap_usd!));
  const predictedAll = fitSet.map((p) => predictLogMcap(p));
  const r2InSample = rSquared(actualAll, predictedAll);

  // Out-of-sample: the same specification, fitted on the 80% train split.
  const train = fitSet.filter((p) => slugHash(p.slug) % 5 !== 0);
  const test = fitSet.filter((p) => slugHash(p.slug) % 5 === 0);
  const trainBeta = ols(
    train.map((p) => features(p, snapshot.as_of, medianAge)),
    train.map((p) => Math.log(p.mcap_usd!)),
  );
  const trainBase = (p: SnapshotProtocol): number =>
    features(p, snapshot.as_of, medianAge).reduce((s, x, j) => s + x * trainBeta[j]!, 0);
  const trainResiduals = train.map((p) => Math.log(p.mcap_usd!) - trainBase(p));
  const trainOffsets = categoryOffsets(train, trainResiduals, 5);
  const trainPredict = (p: SnapshotProtocol): number =>
    trainBase(p) + (trainOffsets.get(p.category ?? 'Uncategorised') ?? 0);
  const testActual = test.map((p) => Math.log(p.mcap_usd!));
  const outOfSample = {
    testProtocols: test.length,
    fittedR2: rSquared(testActual, test.map((p) => trainPredict(p))),
    fittedMedianAbsLogError: medianAbsError(testActual, test.map((p) => trainPredict(p))),
    v2R2: rSquared(testActual, test.map((p) => v2MedianLogMcap(p, train))),
    v2MedianAbsLogError: medianAbsError(testActual, test.map((p) => v2MedianLogMcap(p, train))),
  };

  // A deterministic sample for the fitted-vs-actual chart: every third
  // protocol by slug, at most 40 points, values rounded to two decimals.
  const sorted = [...fitSet].sort((a, b) => (a.slug < b.slug ? -1 : 1));
  const chart: FitChartPoint[] = [];
  for (let i = 0; i < sorted.length && chart.length < 40; i += 3) {
    const p = sorted[i]!;
    chart.push({
      tvl: Math.round(Math.log(p.tvl_usd) * 100) / 100,
      actual: Math.round(Math.log(p.mcap_usd!) * 100) / 100,
      fitted: Math.round(predictLogMcap(p) * 100) / 100,
    });
  }
  const multiples = fitSet.map((p) => Math.exp(predictLogMcap(p)) / p.tvl_usd).sort((a, b) => a - b);
  const growths = fitSet.map((p) => p.change_7d ?? 0).sort((a, b) => a - b);
  const medianGrowthPct = Math.round(growths[Math.floor(growths.length / 2)]! * 10) / 10;
  const categoryRows = [...offsets.entries()]
    .map(([category, offset]) => ({
      category,
      offset: Math.round(offset * 1000) / 1000,
      protocols: fitSet.filter((p) => (p.category ?? 'Uncategorised') === category).length,
    }))
    .sort((a, b) => b.offset - a.offset);

  const model: FittedModel = {
    version: 'radar-3',
    coefficients: beta.map((b) => Math.round(b * 10000) / 10000),
    coefficientNames: [
      'intercept',
      'log TVL',
      'log(1 + age in days)',
      '7-day TVL growth (per 100%)',
      'extra chains (capped at 4)',
      'listing date unknown',
    ],
    medianAgeDays: medianAge,
    categoryOffsets: categoryRows,
    fitProtocols: fitSet.length,
    excludedProtocols: excluded.length,
    excludedSlugs: excluded.map((p) => p.slug).sort(),
    multipleClamp: [0.005, 5],
    r2InSample,
    outOfSample,
    chart,
    multipleRange: [multiples[0]!, multiples[multiples.length - 1]!],
    medianGrowthPct,
  };
  return { model, predictLogMcap, fittedMultiple };
}
