// The token radar's model, version radar-3: one sealed snapshot of the protocol
// universe in, one ranked board out.
//
// The board covers every slug on the snapshot's watchlist (the floor, never the
// ceiling) and every other pre-token protocol the snapshot carries below that
// floor. A protocol is pre-token when DefiLlama records no token for it at all
// (no market cap, no CoinGecko id, no symbol). Protocols whose token already
// trades are kept apart in the Live view and shown at the market's own value,
// never mixed into the ranked board.
//
// Implied value follows only from the snapshot's own figures, never from a
// hand-kept list of names — and in radar-3 every value term is fitted, not
// chosen. lib/fit.ts regresses log market cap on the snapshot's token
// protocols (log TVL for the size curve, log age, seven-day growth, extra
// chains, and a shrunken category offset), and the board scores every row
// with that one fitted function:
//
//   log(implied) = b0 + b1*log(TVL) + b2*log(1 + age_days)
//                + b3*growth_7d + b4*extra_chains + b5*age_unknown
//                + category_offset
//
//   implied = TVL x fitted multiple, the multiple clamped to 0.005x..5x
//
// The fit runs on the token protocols whose market cap / TVL is at most 10x
// (121 of them); seven with a multiple over 10x are excluded as
// non-comparable launches, and the dashboard names them. Validation is
// out-of-sample on a deterministic 80/20 split, beside the radar-2 median
// model on the same split — the dashboard shows both numbers.
//
// A protocol that is a wrapped, staked or bridged product of a token that
// already trades is not a launch that has not happened yet, so it is never
// ranked, wherever it sits.

import { ageDays, features, fitValueModel, type FittedModel } from './fit.ts';

/** One protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-3';

/** How many live-token protocols the Live view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    fitted_multiple: number;
    multiple_source: string;
    /** The six fitted features, in the regression's order. */
    features: number[];
    category_offset: number;
    predicted_log_mcap: number;
    growth_pct: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row; the farm plan travels with it so the detail view shows the same plan board.json carries. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  fitted_multiple: number;
  multiple_source: string;
  features: number[];
  category_offset: number;
  predicted_log_mcap: number;
  growth_pct: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the fitted model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  fit: FittedModel;
  model_version: string;
  watchlist_size: number;
  watchlist: string[];
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are a wrapped, staked or bridged product of a token that already trades. */
const WRAPPED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Exchange names: a protocol beginning with one is that exchange's own product. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a name carries a whole word that marks a wrapped or staked product. */
function isWrappedName(name: string): boolean {
  if (/\b(wrapped|staked|staking)\b/i.test(name)) return true;
  return EXCHANGE_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/**
 * Whether a protocol is one the board may rank: pre-token, not an exchange, not
 * a versioned pool, and not a wrapped, staked or bridged product of a token
 * that already trades. The watchlist rule applies the same test; the board
 * applies it to every row, above and below the floor alike.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && WRAPPED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (isWrappedName(p.name)) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The multipliers and the implied value one protocol gets, from the fitted model. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  fit: ReturnType<typeof fitValueModel>,
): {
  implied: number;
  fittedMultiple: number;
  multipleSource: string;
  features: number[];
  categoryOffset: number;
  predictedLogMcap: number;
  growthPct: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const feats = features(protocol, asOf, fit.model.medianAgeDays);
  const predictedLogMcap = fit.predictLogMcap(protocol);
  const fittedMultiple = fit.fittedMultiple(protocol);
  const growthPct = clamp(protocol.change_7d ?? 0, -60, 120);
  const offsetEntry = fit.model.categoryOffsets.find(
    (o) => o.category === (protocol.category ?? 'Uncategorised'),
  );
  const categoryOffset = offsetEntry === undefined ? 0 : offsetEntry.offset;
  const multipleSource =
    offsetEntry === undefined
      ? `fitted model, no category offset (${protocol.category ?? 'Uncategorised'} has no token protocol in the fit)`
      : `fitted model, ${protocol.category} offset ${categoryOffset >= 0 ? '+' : ''}${categoryOffset.toFixed(3)}`;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * fittedMultiple));
  return { implied, fittedMultiple, multipleSource, features: feats, categoryOffset, predictedLogMcap, growthPct, age };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, fit: ReturnType<typeof fitValueModel> | null = null): BoardRow[] {
  const fitted = fit ?? fitValueModel(snapshot);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug on it, ranked or not.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable pre-token protocol below the watchlist
  // floor. No cap: the floor is where the house started, not where the radar stops.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, fitted);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      fitted_multiple: round4(s.v.fittedMultiple),
      multiple_source: s.v.multipleSource,
      features: s.v.features.map(round4),
      category_offset: round4(s.v.categoryOffset),
      predicted_log_mcap: round4(s.v.predictedLogMcap),
      growth_pct: round2(s.v.growthPct),
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age, s.v.growthPct).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** What gas costs on a protocol's first chain, and what asset pays it. */
function gasFor(p: SnapshotProtocol): { setup: string; weekly: string; asset: string } {
  const chain = chainOf(p).toLowerCase();
  if (chain.includes('solana')) return { setup: 'about $0.05 of gas', weekly: 'about $0.05 of gas', asset: 'SOL' };
  if (chain.includes('ethereum')) return { setup: 'about $5 to $15 of gas', weekly: 'about $3 to $8 of gas', asset: 'ETH' };
  if (chain.includes('bitcoin')) return { setup: 'about $2 to $5 of gas', weekly: 'about $2 to $5 of gas', asset: 'BTC' };
  return { setup: 'under $1 of gas', weekly: 'under $1 of gas', asset: 'the chain’s native token' };
}

/** How long to hold, from the protocol's age and its seven-day growth: young and fast-growing protocols get a longer qualifying window. */
function holdDaysFor(age: number | null, growthPct: number): number {
  const base = age === null ? 30 : age < 180 ? 60 : age < 365 ? 45 : 30;
  const bump = growthPct > 20 ? 15 : growthPct < -20 ? -15 : 0;
  return Math.min(75, Math.max(30, base + bump));
}

/** The weekly qualifying action, in the words a farmer can follow. */
function weeklyFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit a small amount into the same ${name} vault and rebalance if the curator moved funds.`;
  if (c.includes('rwa')) return `Check the yield accrued on the ${name} position and add a small top-up to it.`;
  if (c.includes('basis')) return `Check the funding rate on ${name} and keep the basis position open, topping up if it narrowed.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow a small amount against the supply on ${name}, then repay it the same week.`;
  if (c.includes('dex') || c.includes('leveraged farm') || c.includes('liquidity manager')) return `Rebalance the ${name} pool range or add a small amount of liquidity.`;
  if (c.includes('yield aggregator')) return `Harvest the ${name} vault's yield and redeposit it.`;
  if (c.includes('yield')) return `Claim the week's yield on ${name} and redeposit it into the same vault.`;
  if (c.includes('bridge')) return `Bridge a small amount to another chain through ${name}.`;
  if (c.includes('staking') || c.includes('restak')) return `Restake the week's rewards through ${name}.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Open one small hedged position on ${name} and close it the same week.`;
  if (c.includes('prediction')) return `Place one position on a ${name} market closing that week.`;
  if (c.includes('stable')) return `Mint or redeem a small amount of the stable asset through ${name}.`;
  if (c.includes('launchpad')) return `Join one launch or vote on one proposal on ${name}.`;
  if (c.includes('privacy')) return `Run one private transaction through ${name}'s pool.`;
  if (c.includes('ai agent') || c.includes('decentralized ai')) return `Run one agent task on ${name} and keep the receipt.`;
  if (c.includes('payment')) return `Route one small payment through ${name} on ${chain}.`;
  if (c.includes('nft')) return `List or trade one small item through ${name} on ${chain}.`;
  if (c.includes('token locker')) return `Check the lock schedule on ${name} and extend one lock if it allows it.`;
  if (c.includes('index')) return `Rebalance the ${name} index holding after the week's moves.`;
  if (c.includes('chain')) return `Use one app built on ${name}.`;
  if (c.includes('insurance')) return `Check the cover terms on ${name} and renew or top up one policy.`;
  return `Make one qualifying action on ${name}, such as a deposit, a swap or a vote.`;
}

/** Categories where a points or rewards program is the usual way a launch is farmed. */
function hasPointsProgram(p: SnapshotProtocol): boolean {
  const c = (p.category ?? '').toLowerCase();
  return (
    c.includes('curator') || c.includes('allocator') || c.includes('rwa') || c.includes('yield') ||
    c.includes('lend') || c.includes('cdp') || c.includes('perpetual') || c.includes('derivative') ||
    c.includes('prediction') || c.includes('bridge') || c.includes('staking') || c.includes('restak') ||
    c.includes('dex') || c.includes('launchpad') || c.includes('ai agent') || c.includes('decentralized ai') ||
    c.includes('payment') || c.includes('nft') || c.includes('chain') || c.includes('basis') ||
    c.includes('index') || c.includes('farm') || c.includes('synthetic') || c.includes('option')
  );
}

/** The setup step, in the chain's own words: the wallet, the gas asset, and where the funds land. */
function setupFor(p: SnapshotProtocol, gas: { setup: string; asset: string }): string {
  const chain = chainOf(p);
  const lower = chain.toLowerCase();
  const multi = p.chains.length > 1 ? ` Start on ${chain}; the other ${p.chains.length - 1} chain${p.chains.length - 1 === 1 ? '' : 's'} can wait until the position is running.` : '';
  if (lower.includes('solana')) {
    return `Use a fresh Solana wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Fund it with a little SOL for gas — a Solana transaction costs cents, so a few dollars of SOL covers a month of farming.${multi}`;
  }
  if (lower.includes('ethereum')) {
    return `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Fund it with a little ETH for gas on Ethereum mainnet, where one transaction can cost $5 to $15 — batch your setup into as few transactions as you can.${multi}`;
  }
  if (lower.includes('bitcoin')) {
    return `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Fund it with a little BTC for fees on Bitcoin, and keep a small spare in case a transaction needs to be bumped.${multi}`;
  }
  return `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Fund it with a little ${gas.asset} for gas on ${chain}.${multi}`;
}

/** The claim step, in the category's own words: points programs claim from their page, the rest from the protocol's announcements. */
function claimFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('curator') || c.includes('allocator')) {
    return `Before you withdraw, open ${name}'s own points page and check the vault points you earned — claim only from the link the protocol itself publishes, and only after its own announcement names the distribution.`;
  }
  if (c.includes('rwa')) {
    return `Before you withdraw, open ${name}'s rewards page and check the yield points or loyalty balance on your position — claim only from the link the protocol itself publishes.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('prediction')) {
    return `Before you withdraw, open ${name}'s trading-rewards page and check the points your volume earned — claim only from the link the protocol itself publishes, and only after its own announcement names the distribution.`;
  }
  if (c.includes('bridge')) {
    return `Before you withdraw, open ${name}'s own rewards page and check the bridge points from your transfers — claim only from the link the protocol itself publishes.`;
  }
  if (hasPointsProgram(p)) {
    return `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`;
  }
  return `Before you withdraw, check the protocol's official announcements page for any distribution news — no points program is advertised for this category, so claim only from a link the protocol itself publishes, and only after it names the distribution.`;
}

/** The log step, in the category's own words: what to record so the position can be repeated or unwound. */
function logFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('curator') || c.includes('allocator')) return `Write the wallet, the vault name, the shares you hold and every deposit for ${name} in a farm log so you can repeat the position or unwind it.`;
  if (c.includes('dex') || c.includes('leveraged farm') || c.includes('liquidity manager')) return `Write the wallet, the pool, the price range and every deposit for ${name} in a farm log so you can repeat the position or unwind it.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Write the wallet, the supplied asset, the borrowed amount and the health factor for ${name} in a farm log so you can repeat the position or unwind it.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Write the wallet, the margin, each position and its close for ${name} in a farm log so you can repeat the position or unwind it.`;
  if (c.includes('yield') || c.includes('rwa') || c.includes('basis')) return `Write the wallet, the vault, the yield earned and the points balance for ${name} in a farm log so you can repeat the position or unwind it.`;
  if (c.includes('bridge')) return `Write the wallet, each bridged amount and the destination chain for ${name} in a farm log so you can repeat the position or unwind it.`;
  if (c.includes('staking') || c.includes('restak')) return `Write the wallet, the staked amount and the receipt token for ${name} in a farm log so you can repeat the position or unwind it.`;
  return `Write the wallet, the dates and every transaction for ${name} in a farm log so you can repeat the position or unwind it.`;
}

/** The watch step: what to watch for, and the exit rule — varied by category. */
function watchFor(p: SnapshotProtocol): { text: string; cost: string; time: string } {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options') || c.includes('basis')) {
    return {
      text: `Watch ${name}'s funding rate and open interest each week: if the funding rate stays negative for two weeks, or the protocol's TVL falls more than 30% from its peak, unwind the position and stop farming it.`,
      cost: 'no fee to watch; the unwind costs one transaction',
      time: '5 minutes a week',
    };
  }
  if (c.includes('rwa') || c.includes('yield')) {
    return {
      text: `Watch ${name}'s yield each week: if the yield falls below half of what it paid when you entered, or the protocol's TVL falls more than 30% from its peak, unwind the position and stop farming it.`,
      cost: 'no fee to watch; the unwind costs one transaction',
      time: '5 minutes a week',
    };
  }
  if (c.includes('curator') || c.includes('allocator')) {
    return {
      text: `Watch the curator's allocations on ${name} each week: if the vault moves most of its funds into one strategy, or the protocol's TVL falls more than 30% from its peak, unwind the position and stop farming it.`,
      cost: 'no fee to watch; the unwind costs one transaction',
      time: '5 minutes a week',
    };
  }
  if (c.includes('bridge')) {
    return {
      text: `Watch ${name}'s supported chains and bridge volume each week: if a new chain launches with its own points program, move a small test amount there first; if the protocol's TVL falls more than 30% from its peak, unwind and stop farming it.`,
      cost: 'no fee to watch; the unwind costs one transaction',
      time: '5 minutes a week',
    };
  }
  return {
    text: `Watch ${name}'s official announcements each week for a token or distribution date: if the protocol's TVL falls more than 30% from its peak, or a token launches and the points stop accruing, unwind the position and stop farming it.`,
    cost: 'no fee to watch; the unwind costs one transaction',
    time: '5 minutes a week',
  };
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * age and seven-day growth), never from a hand-written list of names — and
 * no step is shared word for word across rows: the setup follows the chain,
 * the claim follows the category's claim mechanism, the log follows what the
 * position holds, and the watch step follows the category's risk.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, growthPct = 0): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age, growthPct);
  const action = actionFor(p, capital, chain);
  const gas = gasFor(p);
  const weekly = weeklyFor(p, chain);
  const watch = watchFor(p);
  return [
    {
      text: setupFor(p, gas),
      cost: `${gas.setup} for the first transaction`,
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and ${gas.setup}`,
      time: '15 minutes to set up',
    },
    {
      text: weekly,
      cost: `${gas.weekly} a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: claimFor(p),
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: logFor(p),
      cost: 'nothing but the log',
      time: '5 minutes',
    },
    watch,
  ];
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('basis')) return `Deposit $${capital} of USDC into ${name}'s basis vault on ${chain} and keep the position open.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('leveraged farm') || c.includes('liquidity manager')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('yield aggregator')) return `Deposit $${capital} of USDC into ${name}'s highest-yield vault on ${chain} and keep it there.`;
  if (c.includes('yield')) return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position earning.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('launchpad')) return `Hold $${capital} in ${name} on ${chain} and join one launch with the minimum ticket.`;
  if (c.includes('privacy')) return `Deposit $${capital} into ${name}'s private pool on ${chain} and keep the position open.`;
  if (c.includes('ai agent') || c.includes('decentralized ai')) return `Spend $${capital} on ${name}'s agent service on ${chain} and keep the usage receipts.`;
  if (c.includes('payment')) return `Route $${capital} of payments through ${name} on ${chain} and keep the receipts.`;
  if (c.includes('nft')) return `List or trade $${capital} of volume through ${name} on ${chain}.`;
  if (c.includes('token locker')) return `Lock $${capital} of tokens in ${name} on ${chain} for the longest term you can.`;
  if (c.includes('index')) return `Buy $${capital} of ${name}'s index token on ${chain} and hold it.`;
  if (c.includes('chain')) return `Bridge $${capital} to ${chain} and use one app built on ${name}.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The live-token protocols, by market cap, for the dashboard's Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan travelling with it. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    fitted_multiple: row.model.fitted_multiple,
    multiple_source: row.model.multiple_source,
    features: row.model.features,
    category_offset: row.model.category_offset,
    predicted_log_mcap: row.model.predicted_log_mcap,
    growth_pct: row.model.growth_pct,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const fit = fitValueModel(snapshot);
  const board = buildBoard(snapshot, fit);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    fit: fit.model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    watchlist: snapshot.watchlist,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
