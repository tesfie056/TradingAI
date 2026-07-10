/**
 * Quick settings safety check — no secrets in AppSettingsView.
 * Run: npx tsx scripts/verify-settings.ts
 */
import assert from "node:assert/strict";
import { getAppSettingsView } from "../src/lib/settings/view";
import {
  DEFAULT_UI_SETTINGS,
  parseWatchlistDraft,
} from "../src/lib/client/ui-settings";

function main() {
  const v = getAppSettingsView();
  const json = JSON.stringify(v);
  assert.equal(v.secretsExposed, false);
  assert.equal(v.paperOnly, true);
  assert.equal(v.liveTradingAllowed, false);
  assert.equal(v.automaticTradingAllowed, false);
  assert.equal(
    /ALPACA_API_KEY|ALPACA_SECRET|FINNHUB_API_KEY|secretKey|"apiKey"/i.test(
      json,
    ),
    false,
  );
  assert.ok(v.tradingEndpointHost);
  assert.equal(DEFAULT_UI_SETTINGS.preferExecutionEnabled, false);
  assert.deepEqual(
    parseWatchlistDraft("aapl, BTC, MSFT, !!"),
    ["AAPL", "MSFT"],
  );
  console.log("verify:settings passed");
}

main();
