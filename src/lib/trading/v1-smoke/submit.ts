/**
 * Stage A supervised paper smoke submit — one bracket BUY max.
 * Requires typed confirmation and temporary execution enable.
 * Auto Trading must remain OFF.
 */

import {
  findOrderByClientOrderId,
  getOpenOrders,
  getOrders,
  getPositions,
  placePaperOrder,
} from "@/lib/alpaca/client";
import {
  getEffectiveRuntimeSettings,
  loadRuntimeSettings,
  setExecutionEnabled,
} from "@/lib/auto-trade/runtime-settings/service";
import {
  selectV1EntryCandidate,
  submitV1BracketEntry,
  syncTradeFromBroker,
  upsertV1LifecycleTrade,
  verifyProtectiveOrders,
  getV1LifecycleTrade,
} from "@/lib/trading/v1-lifecycle";
import { V1_SMOKE_PROFILE } from "@/lib/trading/v1-smoke/profile";
import { runV1SmokePreflight } from "@/lib/trading/v1-smoke/preflight";
import {
  buildV1SmokeOrderPreview,
  printV1SmokePreview,
  type V1SmokeOrderPreview,
} from "@/lib/trading/v1-smoke/preview";
import type { V1SmokeResultReport } from "@/lib/trading/v1-smoke/types";
import { marketDayKey } from "@/lib/market/time";

export type V1SmokeSubmitArgs = {
  symbol?: string;
  confirm?: string;
  enableExecutionOnce?: boolean;
  /** When true, only preview — never mutate. */
  previewOnly?: boolean;
};

function aaplStillUntouched(
  beforeQty: number | null,
  afterQty: number | null,
): boolean {
  if (beforeQty == null && afterQty == null) return true;
  return beforeQty === afterQty;
}

async function finalizeControlsOff(notes: string[]): Promise<{
  executionFinal: boolean;
  autoTradingFinal: boolean;
}> {
  await loadRuntimeSettings();
  let settings = getEffectiveRuntimeSettings();
  if (settings.executionEnabled) {
    const off = await setExecutionEnabled(false, "paper_smoke_v1");
    if (!off.ok) {
      notes.push(
        "CRITICAL: failed to disable paper execution after smoke attempt",
      );
    } else {
      notes.push("Paper execution disabled after smoke attempt");
    }
    await loadRuntimeSettings();
    settings = getEffectiveRuntimeSettings();
  }
  if (settings.autoTradingEnabled) {
    notes.push("WARNING: Auto Trading remained ON (Stage A expected OFF)");
  }
  return {
    executionFinal: settings.executionEnabled,
    autoTradingFinal: settings.autoTradingEnabled,
  };
}

export async function runV1SmokeSubmit(
  args: V1SmokeSubmitArgs,
): Promise<V1SmokeResultReport> {
  await loadRuntimeSettings();
  const tradingDate = marketDayKey(new Date().toISOString());
  const notes: string[] = [];

  const mk = (
    partial: Partial<V1SmokeResultReport> &
      Pick<V1SmokeResultReport, "verdict">,
  ): V1SmokeResultReport => ({
    paperOnly: true,
    stage: "A_smoke_result",
    tradingDate,
    generatedAt: new Date().toISOString(),
    symbol: null,
    aaplShortUntouched: true,
    shortCreated: false,
    unrelatedMutations: false,
    executionFinal: getEffectiveRuntimeSettings().executionEnabled,
    autoTradingFinal: getEffectiveRuntimeSettings().autoTradingEnabled,
    notes,
    ...partial,
  });

  const preflight = await runV1SmokePreflight();
  const aaplBefore =
    preflight.legacyAaplShort.qty != null
      ? preflight.legacyAaplShort.qty
      : null;

  if (preflight.autoTradingEnabled) {
    notes.push("Auto Trading is ON — Stage A refuses to submit");
    return mk({ verdict: "aborted_not_ready" });
  }

  if (
    preflight.readinessVerdict === "rth_required" ||
    preflight.readinessVerdict === "not_ready"
  ) {
    notes.push(...preflight.blockingReasons);
    notes.push(`Readiness: ${preflight.readinessVerdict}`);
    return mk({ verdict: "aborted_not_ready" });
  }

  if (preflight.readinessVerdict === "safe_no_trade") {
    notes.push(
      "No qualified BUY was available during the supervised smoke-test window.",
    );
    return mk({ verdict: "safe_no_trade" });
  }

  const previewResult = await buildV1SmokeOrderPreview({
    preflight,
    symbol: args.symbol,
  });

  if (!previewResult.ok) {
    if (previewResult.code === "safe_no_trade") {
      notes.push(previewResult.reason);
      return mk({ verdict: "safe_no_trade" });
    }
    notes.push(previewResult.reason);
    return mk({ verdict: "aborted_not_ready" });
  }

  const preview = previewResult.preview;
  printV1SmokePreview(preview);

  if (args.previewOnly) {
    notes.push("Preview only — no order submitted");
    return mk({
      verdict: "preview_only",
      symbol: preview.symbol,
      entry: preview as unknown as Record<string, unknown>,
    });
  }

  if (args.confirm?.trim() !== V1_SMOKE_PROFILE.typedConfirmation) {
    notes.push(
      `Typed confirmation missing or incorrect. Required exactly: "${V1_SMOKE_PROFILE.typedConfirmation}"`,
    );
    return mk({
      verdict: "aborted_not_ready",
      symbol: preview.symbol,
    });
  }

  if (!args.enableExecutionOnce) {
    notes.push(
      "Refusing submit: pass --enable-execution-once to deliberately enable paper execution for this one order",
    );
    return mk({
      verdict: "aborted_not_ready",
      symbol: preview.symbol,
    });
  }

  if (!args.symbol || args.symbol.trim().toUpperCase() !== preview.symbol) {
    notes.push(
      `Refusing submit: --symbol must match preview symbol ${preview.symbol}`,
    );
    return mk({
      verdict: "aborted_not_ready",
      symbol: preview.symbol,
    });
  }

  const again = await runV1SmokePreflight();
  if (
    again.readinessVerdict !== "ready_for_operator_preview" ||
    again.autoTradingEnabled ||
    again.strategy.buyCandidates.every(
      (c) => c.symbol.toUpperCase() !== preview.symbol,
    )
  ) {
    notes.push("Pre-submission revalidation failed — no order submitted");
    notes.push(...again.blockingReasons);
    return mk({
      verdict: "aborted_not_ready",
      symbol: preview.symbol,
    });
  }

  let enabledForSubmit = false;
  try {
    const enable = await setExecutionEnabled(true, "paper_smoke_v1");
    if (!enable.ok) {
      notes.push(`Failed to enable execution: ${enable.errors?.join(", ")}`);
      const controls = await finalizeControlsOff(notes);
      return mk({
        verdict: "fail",
        symbol: preview.symbol,
        ...controls,
      });
    }
    enabledForSubmit = true;

    const candidate = await selectV1EntryCandidate({
      symbol: preview.symbol,
      strategyVersion: preview.strategyVersion,
      scanId: `paper_smoke_${tradingDate}`,
      decisionId: preview.stableTradeId,
      entryDecisionId: preview.stableTradeId,
      requestedQty: preview.quantity,
      plannedEntry: preview.expectedEntryPrice,
      stopLoss: preview.stopLoss,
      takeProfit: preview.takeProfit,
      expectedRisk: preview.maximumExpectedLoss,
      rewardToRisk: preview.rewardToRisk,
    });

    if (!candidate.ok) {
      notes.push(`Candidate rejected: ${candidate.reason}`);
      const controls = await finalizeControlsOff(notes);
      return mk({
        verdict: "fail",
        symbol: preview.symbol,
        entry: { rejected: true, reason: candidate.reason },
        ...controls,
      });
    }

    let trade = candidate.trade;

    const submitted = await submitV1BracketEntry({
      trade,
      placeOrder: async ({
        symbol,
        qty,
        takeProfit,
        stopLoss,
        clientOrderId,
      }) =>
        placePaperOrder({
          symbol,
          qty,
          side: "buy",
          type: "market",
          time_in_force: "day",
          order_class: "bracket",
          take_profit: { limit_price: takeProfit },
          stop_loss: { stop_price: stopLoss },
          client_order_id: clientOrderId,
        }),
      findByClientOrderId: (id) => findOrderByClientOrderId(id),
    });

    if (!submitted.ok) {
      notes.push(`Entry submit failed: ${submitted.reason}`);
      const controls = await finalizeControlsOff(notes);
      return mk({
        verdict: "fail",
        symbol: preview.symbol,
        entry: {
          ok: false,
          code: submitted.code,
          reason: submitted.reason,
          lifecycleState: submitted.trade.lifecycleState,
        },
        ...controls,
      });
    }

    trade = submitted.trade;
    notes.push(
      submitted.duplicate
        ? "Adopted existing broker order by client_order_id (idempotent)"
        : "Submitted one Version 1 paper bracket BUY",
    );

    await sleep(2500);
    const [positions, openOrders, recentOrders] = await Promise.all([
      getPositions(),
      getOpenOrders(100),
      getOrders(100),
    ]);
    trade = syncTradeFromBroker(trade, {
      positions,
      openOrders,
      recentOrders,
      nowMs: Date.now(),
    });
    await upsertV1LifecycleTrade(trade);

    const protection =
      trade.filledEntryQty > 0
        ? verifyProtectiveOrders({ trade, openOrders, recentOrders })
        : {
            ok: false,
            status: "pending" as const,
            stopOrderId: null,
            takeProfitOrderId: null,
            warnings: [
              "Entry not filled yet — protection confirmation deferred",
            ],
          };

    if (trade.filledEntryQty > 0 && !protection.ok) {
      notes.push("CRITICAL: protection missing or invalid after fill");
    }

    const aaplAfterPos = positions.find(
      (p) => p.symbol.toUpperCase() === "AAPL",
    );
    const aaplAfter = aaplAfterPos ? Number(aaplAfterPos.qty) : null;
    const shortCreated = positions.some(
      (p) =>
        p.symbol.toUpperCase() === preview.symbol && Number(p.qty) < 0,
    );

    const stored = await getV1LifecycleTrade(trade.tradeId);
    const completed = stored?.lifecycleState === "COMPLETED";
    const passEntryPath =
      !shortCreated &&
      aaplStillUntouched(aaplBefore, aaplAfter) &&
      (trade.filledEntryQty <= 0 || protection.ok);

    let verdict: V1SmokeResultReport["verdict"] = "fail";
    if (completed && passEntryPath) {
      verdict = "pass";
      notes.push("Completed lifecycle observed in this run");
    } else if (passEntryPath && trade.lifecycleState === "ENTRY_ACCEPTED") {
      notes.push(
        "Entry accepted but Stage A pass requires confirmed fill, protection, exit, and COMPLETED lifecycle — continue supervised monitoring",
      );
    } else if (passEntryPath && trade.filledEntryQty > 0) {
      notes.push(
        "Entry filled and protection checked — await approved exit for Stage A pass",
      );
    }

    const controls = await finalizeControlsOff(notes);
    enabledForSubmit = false;

    return mk({
      verdict,
      symbol: preview.symbol,
      entry: {
        submittedAt: trade.entrySubmittedAt,
        alpacaOrderId: trade.entryOrderId,
        clientOrderId: trade.clientOrderId,
        tradeId: trade.tradeId,
        requestedQty: trade.requestedQty,
        plannedStop: trade.stopLoss,
        plannedTake: trade.takeProfit,
        brokerStatus: submitted.order.status,
        lifecycleState: trade.lifecycleState,
        duplicate: submitted.duplicate,
      },
      fill: {
        filledQty: trade.filledEntryQty,
        avgEntry: trade.actualAvgEntry,
        filledAt: trade.entryFilledAt,
      },
      protection: {
        ok: protection.ok,
        status: protection.status,
        stopOrderId: protection.stopOrderId,
        takeProfitOrderId: protection.takeProfitOrderId,
        warnings: protection.warnings,
      },
      exit: {
        state: trade.lifecycleState,
        exitReason: trade.exitReason,
        filledExitQty: trade.filledExitQty,
      },
      realized: {
        realizedGrossPnL: trade.realizedGrossPnL,
        realizedNetPnL: trade.realizedNetPnL,
      },
      dailyCount: {
        note: "Confirm via inspect:v1-daily-status after COMPLETED exit",
      },
      aaplShortUntouched: aaplStillUntouched(aaplBefore, aaplAfter),
      shortCreated,
      unrelatedMutations: false,
      ...controls,
    });
  } catch (err) {
    notes.push(err instanceof Error ? err.message : "Submit failed");
    const controls = enabledForSubmit
      ? await finalizeControlsOff(notes)
      : {
          executionFinal: getEffectiveRuntimeSettings().executionEnabled,
          autoTradingFinal: getEffectiveRuntimeSettings().autoTradingEnabled,
        };
    return mk({
      verdict: "fail",
      symbol: preview.symbol,
      ...controls,
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type { V1SmokeOrderPreview };
