/**
 * Read-only inspection of Alpaca paper positions and open orders.
 * Does not cancel, close, or modify anything.
 */
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m && process.env[m[1].trim()] === undefined) {
    process.env[m[1].trim()] = m[2].trim();
  }
}

async function main() {
  const {
    getAccount,
    getPositions,
    getOpenOrders,
  } = await import("../src/lib/alpaca/client");
  const { readReconcileState } = await import("../src/lib/trading/reconcile");

  const account = await getAccount();
  const positions = await getPositions();
  const openOrders = await getOpenOrders();
  const reconcile = await readReconcileState();

  const open = positions.filter((p) => Number(p.qty) !== 0);

  console.log(
    JSON.stringify(
      {
        paperOnly: true,
        account: {
          status: account.status,
          equity: account.equity,
          cash: account.cash,
          buying_power: account.buying_power,
        },
        openPositions: open.map((p) => ({
          symbol: p.symbol,
          qty: p.qty,
          avg_entry_price: p.avg_entry_price,
          current_price: p.current_price,
          unrealized_pl: p.unrealized_pl,
          market_value: p.market_value,
          side: p.side,
        })),
        openOrders: openOrders.map((o) => ({
          id: o.id,
          symbol: o.symbol,
          side: o.side,
          type: o.type,
          status: o.status,
          qty: o.qty,
          filled_qty: o.filled_qty,
          order_class: o.order_class,
          limit_price: o.limit_price,
          stop_price: o.stop_price,
          created_at: o.created_at,
        })),
        reconcileOrphans: reconcile.orphanedPositions,
        proposedAction:
          "DO NOT auto-close. Operator should either (A) leave AAPL open and monitor manually, (B) place protective stop/limit on paper via Alpaca UI, or (C) use in-app Close All Positions with typed confirmation when ready to flatten.",
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
