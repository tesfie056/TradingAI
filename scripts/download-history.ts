/**
 * CLI: download resumable Alpaca historical bars into data/historical/.
 *
 * Usage:
 *   npm run learning:download-history -- --symbols F,BAC,T,VZ,PFE --start 2024-01-01 --end 2025-06-30 --timeframe 5Min
 */
import fs from "node:fs";
import path from "node:path";
import { downloadHistoricalJob } from "../src/lib/backtest/downloader";
import type { BarTimeframe } from "../src/lib/alpaca/client";

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
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    // optional
  }
}

loadEnvLocal();

function arg(name: string, fallback?: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

async function main() {
  const symbolsRaw =
    arg("symbols") ??
    "F,BAC,T,VZ,PFE,INTC,MO,KMI,KEY,AAL,CCL,WBD";
  const start = arg("start", "2024-07-01")!;
  const end = arg("end", "2025-06-30")!;
  const timeframe = (arg("timeframe", "5Min") ?? "5Min") as BarTimeframe;
  const noResume = process.argv.includes("--no-resume");

  const symbols = symbolsRaw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  console.log("learning:download-history");
  console.log({ symbols, start, end, timeframe, resume: !noResume });

  const result = await downloadHistoricalJob(
    { symbols, start, end, timeframe, adjustment: "raw", feed: "iex" },
    {
      resume: !noResume,
      onProgress: (msg) => console.log(`  ${msg}`),
    },
  );

  console.log("\nCompleted job", result.jobId);
  for (const r of result.results) {
    console.log(
      `  ${r.symbol}: ${r.status} bars=${r.bars} pages=${r.pages}${r.error ? ` ERR=${r.error}` : ""}`,
    );
  }
  console.log(
    "\nCache written under data/historical/ (gitignored). Do not commit.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
