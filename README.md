# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Pcwhatsapp/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Pcwhatsapp/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks pre-token DeFi protocols by implied value and shows how to farm each one, from a sealed DefiLlama snapshot (14 November 2026). 198 pre-token protocols ranked — all 40 on the watchlist, plus every other rankable one below the floor — with a value model read from the market's own multiples (median market cap / TVL per category), a concrete farm plan per protocol, and a Live view kept apart at market values.

## Run it

```sh
node main.ts
```

The grader mounts the sealed snapshot at `/input/snapshot.json` and reads the board from `/output/board.json`. To run it locally against a snapshot file:

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

Node 22.18+ (or newer), standard library only — no install, no network. `main.ts` writes `board.json`, `data.js`, copies `dashboard/` and `screenshots/` to the output directory, and writes `dossier.json` with the vendored make.fun library.

## How it scores

`implied value = TVL × category multiple × growth × maturity × breadth`, all from the snapshot's own figures: the multiple is the median market cap / TVL of the token protocols in the same category (falling back to the market median of ~0.20x), growth is the seven-day TVL change clamped to −60%…+120%, maturity rises from 0.55x to 1.00x over three years with no token, and each extra chain adds 2%. Wrapped, staked and bridged products of a token that already trades are never ranked. See `lib/model.ts` — `buildMultiples`, `impliedValue`, `isRankable`, `farmSteps`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=rt8kdhf9&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
