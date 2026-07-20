/**
 * Aggregate Version 1 deterministic verification suite.
 * Run: npm run verify:v1-all
 *
 * Never enables execution/Auto Trading against live Alpaca.
 * Never submits/cancels/modifies broker orders.
 */
import { spawnSync } from "node:child_process";

const STEPS = [
  "verify:v1-safety",
  "verify:universe",
  "verify:v1-strategy",
  "verify:risk-engine",
  "verify:brackets",
  "verify:v1-lifecycle",
  "verify:v1-daily",
  "verify:v1-api",
  "verify:v1-auto-trade-ui",
  "verify:v1-integration",
] as const;

function run(script: string): boolean {
  console.log(`\n======== ${script} ========`);
  const res = spawnSync("npm", ["run", script], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });
  return res.status === 0;
}

async function main() {
  console.log("verify:v1-all starting…");
  console.log(`Steps: ${STEPS.join(", ")}`);
  console.log("Note: there is no npm test script; these tsx verifies are the V1 suite.");

  const failed: string[] = [];
  for (const step of STEPS) {
    if (!run(step)) failed.push(step);
  }

  if (failed.length) {
    console.error("\nverify:v1-all FAILED:", failed.join(", "));
    process.exitCode = 1;
    return;
  }
  console.log("\nverify:v1-all passed — all Version 1 deterministic groups green");
}

main();
