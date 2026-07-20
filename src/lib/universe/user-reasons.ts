/**
 * User-facing universe rejection messages for Auto Trade UI.
 * Maps internal filter reasons → simple operator copy.
 */

export function toUserFacingUniverseReason(reason: string): string {
  const r = reason.trim();
  if (!r) return "Did not meet Version 1 filters";

  if (/Leveraged or inverse/i.test(r)) {
    return "Leveraged or inverse fund is not allowed";
  }
  if (/Penny stock|below minimum|Price \$/i.test(r) && /below/i.test(r)) {
    return "Price is below the Version 1 range";
  }
  if (/above maximum|above the/i.test(r)) {
    return "Price is above the Version 1 range";
  }
  if (/ADV|volume/i.test(r)) {
    return "Trading volume is too low";
  }
  if (/Spread/i.test(r) && /above max/i.test(r)) {
    return "Bid/ask spread is too wide";
  }
  if (/spread unavailable/i.test(r)) {
    return "Current quote is unavailable";
  }
  if (/Price unavailable|quote unavailable|Current quote/i.test(r)) {
    return "Current quote is unavailable";
  }
  if (/stale/i.test(r)) {
    return "Market data is stale";
  }
  if (/not tradable|Symbol not tradable/i.test(r)) {
    return "Asset is not tradable";
  }
  if (/fractionable|fractional/i.test(r)) {
    return "Asset is not supported for fractional trading";
  }
  if (/Asset status|not active/i.test(r)) {
    return "Asset is not tradable";
  }
  if (/us_equity|Asset class/i.test(r)) {
    return "Asset is not a supported U.S. stock";
  }
  if (/Unsupported or non-equity|Not a tradable U.S/i.test(r)) {
    return "Asset is not a supported U.S. stock";
  }
  if (/Invalid symbol|Duplicate/i.test(r)) {
    return "Symbol is invalid or duplicated";
  }
  if (/metadata|Asset metadata/i.test(r)) {
    return "Asset metadata could not be verified";
  }
  return r;
}

export function toUserFacingUniverseReasons(reasons: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const reason of reasons) {
    const msg = toUserFacingUniverseReason(reason);
    if (seen.has(msg)) continue;
    seen.add(msg);
    out.push(msg);
  }
  return out.length > 0 ? out : ["Did not meet Version 1 filters"];
}
