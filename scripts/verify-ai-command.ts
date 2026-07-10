/**
 * AI Command Center verification:
 * - scope questions do not inject random stocks
 * - historical / trade intents behave correctly
 * - secrets scrubbed; never submits orders
 *
 * Run: npm run verify:ai-command
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  classifyIntent,
  runAiCommand,
  scrubSecrets,
} from "../src/lib/ai/command";
import {
  APP_SCOPE_ANSWER,
  OUT_OF_SCOPE_ANSWER,
} from "../src/lib/ai/command-intent";
import type { AiCommandRequest } from "../src/lib/ai/command-types";
import { isPaperOrderExecutionEnabled } from "../src/lib/config";

function loadEnvLocal() {
  try {
    const raw = fs.readFileSync(
      path.join(process.cwd(), ".env.local"),
      "utf8",
    );
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] == null) process.env[key] = val;
    }
  } catch {
    // optional
  }
}

loadEnvLocal();

const sampleContext: NonNullable<AiCommandRequest["context"]> = {
  watchlist: ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL"],
  marketOpen: false,
  orderExecutionEnabled: false,
  decisions: [
    {
      symbol: "GOOGL",
      action: "HOLD",
      confidence: 0.4,
      riskLevel: "medium",
      finalScore: 0.42,
      readyForManualPaperTrade: false,
      tradeBlockReasons: ["Market closed"],
      summary: "GOOGL is mixed and not a trade setup.",
      technicalReason: "Flat trend.",
    },
    {
      symbol: "AAPL",
      action: "HOLD",
      confidence: 0.41,
      riskLevel: "medium",
      finalScore: 0.44,
      readyForManualPaperTrade: false,
      tradeBlockReasons: ["HOLD action", "Market closed"],
      summary: "Mixed technicals keep AAPL on HOLD.",
    },
    {
      symbol: "NVDA",
      action: "BUY",
      confidence: 0.78,
      riskLevel: "medium",
      finalScore: 0.74,
      readyForManualPaperTrade: false,
      tradeBlockReasons: ["Market closed"],
      summary: "Strong technical momentum.",
    },
  ],
};

async function main() {
  console.log("verify:ai-command starting…");
  assert.equal(isPaperOrderExecutionEnabled(), false);

  assert.equal(classifyIntent("what can you answer?"), "app_scope_question");
  assert.equal(
    classifyIntent("do you answer any question?"),
    "app_scope_question",
  );
  assert.equal(
    classifyIntent("do answer any question or just market related", "GOOGL"),
    "app_scope_question",
  );
  assert.equal(
    classifyIntent("what was AAPL high yesterday?"),
    "historical_price_question",
  );
  assert.equal(
    classifyIntent("what about NVDA?", null, {
      lastInstruction: "what was AAPL high yesterday?",
      lastIntentHint: "historical",
    }),
    "historical_price_question",
  );
  assert.equal(
    classifyIntent("why are trades blocked?"),
    "blocked_trade_question",
  );
  assert.equal(classifyIntent("buy AAPL"), "trade_execution");
  console.log("✓ intent classification");

  process.env.AI_PROVIDER = "heuristic";

  const scope = await runAiCommand({
    userInstruction: "what can you answer?",
    selectedSymbol: "GOOGL",
    context: sampleContext,
  });
  assert.equal(scope.answer, APP_SCOPE_ANSWER);
  assert.equal(scope.relatedSymbols.length, 0);
  assert.doesNotMatch(scope.answer, /GOOGL|Mixed technicals|flat trend/i);
  console.log("✓ scope question ignores selectedSymbol");

  const anyQ = await runAiCommand({
    userInstruction: "do you answer any question?",
    selectedSymbol: "GOOGL",
    context: sampleContext,
  });
  assert.match(anyQ.answer, /watchlist|paper trade|do not place trades/i);
  assert.doesNotMatch(anyQ.answer, /GOOGL is mixed/i);
  console.log("✓ capability question does not dump a stock");

  const out = await runAiCommand({
    userInstruction: "tell me a joke",
    selectedSymbol: "GOOGL",
    context: sampleContext,
  });
  assert.equal(out.answer, OUT_OF_SCOPE_ANSWER);
  assert.equal(out.relatedSymbols.length, 0);
  console.log("✓ out-of-scope stays trading-focused");

  const blocked = await runAiCommand({
    userInstruction: "why are trades blocked?",
    context: sampleContext,
  });
  assert.match(blocked.answer, /market is closed|Order execution is OFF/i);
  console.log("✓ blocked trades explained");

  const buy = await runAiCommand({
    userInstruction: "buy AAPL",
    selectedSymbol: "AAPL",
    context: sampleContext,
  });
  assert.equal(buy.suggestedAction, "preview_only");
  assert.match(buy.answer, /cannot buy|cannot.*submit|I cannot/i);
  assert.equal(buy.tradePreviewAllowed, false);
  console.log("✓ buy does not execute");

  if (process.env.ALPACA_API_KEY && process.env.ALPACA_SECRET_KEY) {
    const hist = await runAiCommand({
      userInstruction: "what was AAPL high yesterday?",
      selectedSymbol: "GOOGL",
      context: sampleContext,
    });
    assert.match(hist.answer, /AAPL/);
    assert.match(hist.answer, /high/i);
    assert.doesNotMatch(hist.answer, /GOOGL on /i);
    console.log("✓ AAPL yesterday high (ignores GOOGL selection)");

    const follow = await runAiCommand({
      userInstruction: "what about NVDA?",
      selectedSymbol: "GOOGL",
      conversation: {
        lastInstruction: "what was AAPL high yesterday?",
        lastIntentHint: "historical",
      },
      context: sampleContext,
    });
    assert.match(follow.answer, /NVDA/);
    assert.match(follow.answer, /high|open|close|low/i);
    console.log("✓ what about NVDA follow-up returns NVDA historical");
  } else {
    console.log("⚠ skip live historical (no Alpaca keys)");
  }

  assertNoSecrets(scrubSecrets("ALPACA_API_KEY=abc FINNHUB_API_KEY=xyz"));
  const commandSrc = fs.readFileSync(
    path.join(process.cwd(), "src/lib/ai/command.ts"),
    "utf8",
  );
  assert.doesNotMatch(commandSrc, /submit-paper|placePaperOrder|submitPaper/);
  console.log("✓ never submits orders");

  console.log("verify:ai-command passed");
}

function assertNoSecrets(text: string) {
  assert.doesNotMatch(text, /ALPACA_API_KEY=abc|FINNHUB_API_KEY=xyz/);
  assert.match(text, /\[redacted\]/);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
