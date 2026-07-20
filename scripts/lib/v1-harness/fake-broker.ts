/**
 * In-memory fake Alpaca paper broker for Version 1 simulations.
 * Captures attempted mutations; never contacts the network.
 */

import type { AlpacaOrder, AlpacaPosition } from "../../../src/lib/alpaca/types";
import { mockOrder, mockPosition } from "../../fixtures/v1-lifecycle-fixtures";

export type BrokerMutation =
  | { kind: "place_order"; body: Record<string, unknown>; at: string }
  | { kind: "cancel_order"; orderId: string; at: string }
  | { kind: "close_position"; symbol: string; at: string };

export type FakeBrokerOptions = {
  /** When true, placeOrder throws (broker unavailable). */
  unavailable?: boolean;
  /** When true, placeOrder returns ambiguous/error-shaped failure without id. */
  ambiguousPlace?: boolean;
  /** Reject next placeOrder with this message. */
  rejectNextPlace?: string | null;
};

export class FakeAlpacaBroker {
  positions: AlpacaPosition[] = [];
  orders: AlpacaOrder[] = [];
  mutations: BrokerMutation[] = [];
  options: FakeBrokerOptions;
  private seq = 0;
  private nowMs: number;

  constructor(options: FakeBrokerOptions = {}, nowMs = Date.parse("2026-07-16T15:00:00.000Z")) {
    this.options = options;
    this.nowMs = nowMs;
  }

  setNow(ms: number) {
    this.nowMs = ms;
  }

  iso() {
    return new Date(this.nowMs).toISOString();
  }

  resetMutations() {
    this.mutations = [];
  }

  assertNoUnexpectedMutations(allowed: BrokerMutation["kind"][] = []) {
    const bad = this.mutations.filter((m) => !allowed.includes(m.kind));
    if (bad.length > 0) {
      throw new Error(
        `Unexpected broker mutations: ${bad.map((m) => m.kind).join(", ")}`,
      );
    }
  }

  seedPosition(input: {
    symbol: string;
    qty: number;
    avgEntry?: number;
    current?: number;
  }) {
    const p = mockPosition(input);
    this.positions = this.positions.filter(
      (x) => x.symbol.toUpperCase() !== input.symbol.toUpperCase(),
    );
    if (Number(p.qty) !== 0) this.positions.push(p);
  }

  seedOrder(order: AlpacaOrder) {
    this.orders = this.orders.filter((o) => o.id !== order.id);
    this.orders.push(order);
  }

  findByClientOrderId = async (
    clientOrderId: string,
  ): Promise<AlpacaOrder | null> => {
    return (
      this.orders.find((o) => o.client_order_id === clientOrderId) ?? null
    );
  };

  placeOrder = async (body: Record<string, unknown>): Promise<AlpacaOrder> => {
    this.mutations.push({
      kind: "place_order",
      body: { ...body },
      at: this.iso(),
    });
    if (this.options.unavailable) {
      throw new Error("Fake broker unavailable");
    }
    if (this.options.ambiguousPlace) {
      throw new Error("Ambiguous broker response — no order id");
    }
    if (this.options.rejectNextPlace) {
      const msg = this.options.rejectNextPlace;
      this.options.rejectNextPlace = null;
      throw new Error(msg);
    }

    this.seq += 1;
    const id = `fake_ord_${this.seq}`;
    const symbol = String(body.symbol ?? "F").toUpperCase();
    const side = (body.side === "sell" ? "sell" : "buy") as "buy" | "sell";
    const qty = Number(body.qty ?? 1);
    const clientOrderId = String(body.client_order_id ?? id);
    const order = mockOrder({
      id,
      symbol,
      side,
      status: "accepted",
      qty,
      clientOrderId,
      orderClass: String(body.order_class ?? "simple"),
      stopPrice: body.stop_loss
        ? Number((body.stop_loss as { stop_price?: string }).stop_price)
        : null,
      limitPrice: body.take_profit
        ? Number((body.take_profit as { limit_price?: string }).limit_price)
        : null,
    });
    order.created_at = this.iso();
    order.submitted_at = this.iso();
    order.updated_at = this.iso();
    this.orders.push(order);

    // Bracket children for protection monitoring
    if (body.order_class === "bracket" && side === "buy") {
      const stop = mockOrder({
        id: `${id}_sl`,
        symbol,
        side: "sell",
        status: "accepted",
        qty,
        type: "stop",
        stopPrice: Number((body.stop_loss as { stop_price?: string })?.stop_price),
        clientOrderId: `${clientOrderId}_sl`,
      });
      const tp = mockOrder({
        id: `${id}_tp`,
        symbol,
        side: "sell",
        status: "accepted",
        qty,
        type: "limit",
        limitPrice: Number(
          (body.take_profit as { limit_price?: string })?.limit_price,
        ),
        clientOrderId: `${clientOrderId}_tp`,
      });
      this.orders.push(stop, tp);
    }

    return order;
  };

  /** Advance entry order to filled and open a long position. */
  fillEntry(clientOrderId: string, filledQty?: number, avg?: number) {
    const entry = this.orders.find((o) => o.client_order_id === clientOrderId);
    if (!entry) throw new Error(`No entry for ${clientOrderId}`);
    const qty = filledQty ?? Number(entry.qty);
    entry.status = qty < Number(entry.qty) ? "partially_filled" : "filled";
    entry.filled_qty = String(qty);
    entry.filled_avg_price = String(avg ?? 20);
    entry.filled_at = this.iso();
    entry.updated_at = this.iso();
    this.seedPosition({
      symbol: entry.symbol,
      qty,
      avgEntry: avg ?? 20,
      current: avg ?? 20,
    });
    return entry;
  }

  /** Fill a protective sell child (TP or SL). */
  fillChildSell(
    parentClientOrderId: string,
    which: "tp" | "sl",
    avg: number,
  ) {
    const suffix = which === "tp" ? "_tp" : "_sl";
    const child = this.orders.find(
      (o) => o.client_order_id === `${parentClientOrderId}${suffix}`,
    );
    if (!child) throw new Error(`Missing ${which} child for ${parentClientOrderId}`);
    const qty = Number(child.qty);
    child.status = "filled";
    child.filled_qty = String(qty);
    child.filled_avg_price = String(avg);
    child.filled_at = this.iso();
    child.updated_at = this.iso();
    // Flatten long
    this.positions = this.positions.filter(
      (p) => p.symbol.toUpperCase() !== child.symbol.toUpperCase(),
    );
    return child;
  }

  snapshot() {
    return {
      positions: [...this.positions],
      openOrders: this.orders.filter(
        (o) =>
          !["filled", "canceled", "expired", "rejected"].includes(o.status),
      ),
      recentOrders: [...this.orders],
      nowMs: this.nowMs,
    };
  }
}
