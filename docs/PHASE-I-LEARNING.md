# Phase I — Strategy Learning

Milestone I-1: learning dataset, regimes, immutable registry, Strategy Lab.

Milestone I-2: shared evaluator, chronological/walk-forward, synthetic baseline, promotion disabled.

Milestone I-3: real historical validation, stress tests, regime-filter challenger, shadow scaffolding.

Milestone I-4: run fingerprints, live shadow sessions, weakness reports, typed challengers with locked acceptance rules, background jobs. Promotion remains disabled.

## PF reconciliation (I-4)

The I-3 report’s baseline PF **1.07** vs stress base PF **1.19** was **not** the same configuration:
stress used **thinned bars** (every 3rd candle) while baseline used full history with `evalStep=24`.

Comparable stress must use the **same dataset, evalStep, and cost assumptions**. Runs now carry a `runFingerprint.hash`.

## Shadow

```
POST /api/learning/shadow { "action": "start" | "stop" }
GET  /api/learning/shadow
```

Starting shadow does **not** enable execution or auto trading. Challenger never submits broker orders.

## Jobs

```
POST /api/learning/jobs { "type": "weakness" | "reconcile" | "dq_summaries" | "create_experiment", "kind"? }
GET  /api/learning/jobs?id=…
```

## Verify

```
npm run verify:learning-i1
npm run verify:learning-i2
npm run verify:learning-i3
npm run verify:learning-i4
```

Live trading remains blocked. Positive simulations do not prove future profitability.
