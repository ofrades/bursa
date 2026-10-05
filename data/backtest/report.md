# PROXY backtest — quality + GARP + momentum (NOT the revision algorithm)

Universe: today's candidates (SURVIVORSHIP BIAS). No consensus data:
revision gate, breadth and SUE are absent; GARP uses REALIZED NI growth.
Coverage gate not enforceable retroactively. Methodology v2 gates only.

Quarter-ends evaluated: 20 (2021-12-31 → 2026-09-30)
Quarters with 63-session outcomes: 15; with 252-session: 12

| Quarter-end | Evaluated | Quality pass | GARP pass | Picks | Win 3M | Avg excess 3M | Win 12M | Avg excess 12M |
|---|---|---|---|---|---|---|---|---|
| 2021-12-31 | 369 | 0 | 0 | 0 | — | — | — | — |
| 2022-03-31 | 369 | 0 | 0 | 0 | — | — | — | — |
| 2022-06-30 | 369 | 0 | 0 | 0 | — | — | — | — |
| 2022-09-30 | 369 | 0 | 0 | 0 | — | — | — | — |
| 2022-12-31 | 369 | 42 | 2 | 9 | 11% | -0.2% | 33% | +8.8% |
| 2023-03-31 | 369 | 49 | 2 | 10 | 40% | -0.7% | 70% | +25.8% |
| 2023-06-30 | 369 | 54 | 3 | 11 | 82% | +6.1% | 82% | +29.8% |
| 2023-09-30 | 369 | 64 | 3 | 13 | 46% | +4.2% | 54% | +17.4% |
| 2023-12-31 | 369 | 64 | 8 | 13 | 77% | +18.1% | 69% | +26.2% |
| 2024-03-31 | 369 | 63 | 8 | 13 | 69% | +9.1% | 69% | +11.8% |
| 2024-06-30 | 369 | 65 | 9 | 13 | 69% | +4.4% | 62% | +15.6% |
| 2024-09-30 | 369 | 62 | 10 | 13 | 62% | +3.8% | 62% | +20.2% |
| 2024-12-31 | 369 | 54 | 5 | 11 | 27% | -2.6% | 18% | +5.8% |
| 2025-03-31 | 369 | 56 | 8 | 12 | 50% | +5.7% | 50% | +13.4% |
| 2025-06-30 | 369 | 56 | 7 | 12 | 58% | +4.3% | 58% | +20.0% |
| 2025-09-30 | 369 | 59 | 6 | 12 | 17% | +0.8% | 33% | -2.6% |
| 2025-12-31 | 369 | 67 | 5 | 14 | 71% | +12.1% | — | — |
| 2026-03-31 | 369 | 60 | 3 | 12 | 58% | +38.0% | — | — |
| 2026-06-30 | 369 | 59 | 4 | 12 | 58% | +2.0% | — | — |
| 2026-09-30 | 369 | 62 | 4 | 13 | — | — | — | — |

## Averages

- Mean win rate 3M: 53% (n=15 quarters)
- Mean excess 3M: +7.0%
- Mean win rate 12M: 55% (n=12 quarters)
- Mean excess 12M: +16.0%

## Biases

- Survivorship: today's universe applied to the past; failures absent.
- No point-in-time consensus: revision/breadth/SUE gates absent by necessity.
- GARP uses realized NI growth (hindsight-observable), not forward consensus.
- Coverage (>=20 analysts) not retroactively checkable.