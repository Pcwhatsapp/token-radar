# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Pcwhatsapp/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Pcwhatsapp/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks pre-token DeFi protocols by implied value and shows how to farm each one, from a sealed DefiLlama snapshot (14 November 2026). 197 pre-token protocols ranked — all 40 on the watchlist, plus every other rankable one below the floor — with a value model fitted to the snapshot's own token protocols (an OLS regression of log market cap, validated out of sample), a concrete farm plan per protocol, and a Live view kept apart at market values.

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

`log(implied value) = b0 + b1·log(TVL) + b2·log(1 + age) + b3·growth + b4·extra chains + b5·age unknown + category offset`, all fitted by ordinary least squares to the snapshot's token protocols (121 of them; seven with market cap / TVL over 10× are excluded as non-comparable launches). The size curve is the strongest term: the fitted log-TVL coefficient is below 1, so the implied multiple falls as TVL grows. Validation is out of sample on a deterministic 80/20 split, beside the radar-2 median model on the same split — the dashboard shows both. Wrapped, staked and bridged products of a token that already trades are never ranked. See `lib/fit.ts` and `lib/model.ts` — `fitValueModel`, `impliedValue`, `isRankable`, `farmSteps`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=rt8kdhf9&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
