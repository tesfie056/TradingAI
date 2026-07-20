/**
 * Version 1 Stage A supervised paper smoke / preflight CLI.
 *
 * NEVER runs from verify:*, install, build, or app startup.
 * Does not place orders unless every deliberate gate passes.
 *
 * Usage:
 *   npm run paper-smoke:v1 -- preflight
 *   npm run paper-smoke:v1 -- preview [--symbol SYM]
 *   npm run paper-smoke:v1 -- submit --symbol SYM --confirm "PAPER SMOKE" --enable-execution-once
 */
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m && process.env[m[1].trim()] === undefined) {
    process.env[m[1].trim()] = m[2].trim();
  }
}

function parseArgs(argv: string[]) {
  const mode = (argv[0] ?? "preflight").toLowerCase();
  let symbol: string | undefined;
  let confirm: string | undefined;
  let enableExecutionOnce = false;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--symbol" && argv[i + 1]) {
      symbol = argv[++i];
    } else if (a === "--confirm" && argv[i + 1]) {
      confirm = argv[++i];
    } else if (a === "--enable-execution-once") {
      enableExecutionOnce = true;
    }
  }
  return { mode, symbol, confirm, enableExecutionOnce };
}

async function main() {
  const { assertPaperTradingOnly } = await import("../src/lib/alpaca/safety");
  const { PAPER_TRADING_BASE_URL } = await import("../src/lib/config");
  assertPaperTradingOnly(
    process.env.ALPACA_BASE_URL?.trim() || PAPER_TRADING_BASE_URL,
  );

  const args = parseArgs(process.argv.slice(2));
  const {
    runV1SmokePreflight,
    runV1SmokeSubmit,
    savePreflightReport,
    saveSmokeResultReport,
    ensureAggregateScaffold,
    V1_SMOKE_PROFILE,
  } = await import("../src/lib/trading/v1-smoke");
  const { V1_STRATEGY_VERSION } = await import(
    "../src/lib/strategy/v1-simple-long"
  );

  await ensureAggregateScaffold(V1_STRATEGY_VERSION);

  if (args.mode === "preflight") {
    console.log("V1 Stage A — read-only preflight (no mutations)");
    console.log(`Smoke profile: ${V1_SMOKE_PROFILE.name}`);
    const report = await runV1SmokePreflight();
    const path = await savePreflightReport(report);
    console.log(JSON.stringify(report, null, 2));
    console.log(`\nSaved: ${path}`);
    console.log(`Readiness verdict: ${report.readinessVerdict}`);
    console.log(
      `Mutations: orders=${report.mutations.ordersSubmitted} canceled=${report.mutations.ordersCanceled} positions=${report.mutations.positionsModified}`,
    );
    if (report.readinessVerdict === "ready_for_operator_preview") {
      console.log(
        '\nNext: npm run paper-smoke:v1 -- preview\nThen (only if you intend a paper order):\n  npm run paper-smoke:v1 -- submit --symbol <SYM> --confirm "PAPER SMOKE" --enable-execution-once',
      );
    } else if (report.readinessVerdict === "safe_no_trade") {
      console.log(
        "\nSafe outcome: no qualified BUY — do not force a trade.",
      );
    } else if (report.readinessVerdict === "rth_required") {
      console.log(
        "\nStage A submission blocked until regular U.S. market hours.",
      );
    }
    process.exit(0);
  }

  if (args.mode === "preview") {
    console.log("V1 Stage A — order preview (no mutations)");
    const result = await runV1SmokeSubmit({
      symbol: args.symbol,
      previewOnly: true,
    });
    const path = await saveSmokeResultReport(result);
    console.log(`Verdict: ${result.verdict}`);
    console.log(`Saved: ${path}`);
    process.exit(result.verdict === "preview_only" ? 0 : 1);
  }

  if (args.mode === "submit") {
    console.log("V1 Stage A — supervised paper submit (gated)");
    console.log(
      "Auto Trading must remain OFF. Execution will be enabled only for this one attempt if flags pass.",
    );
    const result = await runV1SmokeSubmit({
      symbol: args.symbol,
      confirm: args.confirm,
      enableExecutionOnce: args.enableExecutionOnce,
      previewOnly: false,
    });
    const path = await saveSmokeResultReport(result);
    console.log(`\nVerdict: ${result.verdict}`);
    for (const n of result.notes) console.log(`- ${n}`);
    console.log(`Saved: ${path}`);
    console.log(
      `Execution final: ${result.executionFinal ? "ON" : "OFF"} · Auto Trading final: ${result.autoTradingFinal ? "ON" : "OFF"}`,
    );
    process.exit(result.verdict === "pass" || result.verdict === "safe_no_trade" ? 0 : 1);
  }

  console.error(
    `Unknown mode "${args.mode}". Use: preflight | preview | submit`,
  );
  process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
