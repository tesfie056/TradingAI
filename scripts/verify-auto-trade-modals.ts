/**
 * Verify Auto Trade UI never uses native browser dialogs.
 * Run: npm run verify:auto-trade-modals
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

function assertNoNativeDialogs(rel: string) {
  const src = read(rel);
  assert.ok(
    !/\bwindow\.confirm\s*\(/.test(src),
    `${rel} must not use window.confirm`,
  );
  assert.ok(
    !/\bwindow\.alert\s*\(/.test(src),
    `${rel} must not use window.alert`,
  );
  assert.ok(
    !/\bwindow\.prompt\s*\(/.test(src),
    `${rel} must not use window.prompt`,
  );
  // bare confirm/alert/prompt calls (not property access)
  assert.ok(
    !/(^|[^\w.])confirm\s*\(/.test(src),
    `${rel} must not call confirm(`,
  );
  assert.ok(
    !/(^|[^\w.])alert\s*\(/.test(src),
    `${rel} must not call alert(`,
  );
  assert.ok(
    !/(^|[^\w.])prompt\s*\(/.test(src),
    `${rel} must not call prompt(`,
  );
}

async function main() {
  console.log("verify:auto-trade-modals starting…");

  const autoTradeFiles = [
    "src/components/auto-trade/AutoTradeControlsPanel.tsx",
    "src/components/auto-trade/SafetyActionsCard.tsx",
    "src/components/auto-trade/AutoTradePageView.tsx",
    "src/components/auto-trade/TradingSettingsDrawer.tsx",
    "src/components/ui/ConfirmActionModal.tsx",
    "src/components/ui/Toast.tsx",
    "src/components/ui/PaperOnlyBanner.tsx",
    "src/components/layout/SafetyBanner.tsx",
  ];

  for (const f of autoTradeFiles) {
    assertNoNativeDialogs(f);
  }
  console.log("✓ no Auto Trade action uses window.confirm/alert/prompt");

  const controls = read("src/components/auto-trade/AutoTradeControlsPanel.tsx");
  const safety = read("src/components/auto-trade/SafetyActionsCard.tsx");
  assert.ok(controls.includes("ConfirmActionModal"));
  assert.ok(safety.includes('open={modal === "closeAll"}'));
  assert.ok(safety.includes('requireTypedText="CLOSE ALL"'));
  assert.ok(safety.includes("{ confirm: true }"));
  assert.ok(safety.includes("Close all paper positions?"));
  assert.ok(safety.includes("Keep Positions Open"));
  console.log("✓ Close All modal opens with typed CLOSE ALL confirmation");

  assert.ok(safety.includes('open={modal === "emergency"}'));
  assert.ok(safety.includes("Existing open positions will remain open"));
  assert.ok(safety.includes("Activate Emergency Stop"));
  assert.ok(safety.includes("does not close open positions") || safety.includes("remain open"));
  console.log("✓ Emergency Stop modal explains positions remain open");

  assert.ok(controls.includes('open={modal === "enableExecution"}'));
  assert.ok(controls.includes("Enable paper execution?"));
  assert.ok(controls.includes('open={modal === "enableAuto"}'));
  assert.ok(controls.includes("Enable automatic paper trading?"));
  console.log("✓ Execution and Auto Trading enable modals present");

  const modal = read("src/components/ui/ConfirmActionModal.tsx");
  assert.ok(modal.includes('e.key === "Escape"'));
  assert.ok(modal.includes("handleCancel"));
  assert.ok(modal.includes("allowBackdropClose"));
  assert.ok(modal.includes("FOCUSABLE"));
  assert.ok(modal.includes("aria-modal"));
  assert.ok(modal.includes("loading"));
  assert.ok(modal.includes("error"));
  assert.ok(modal.includes("requireTypedText"));
  assert.ok(modal.includes("Working…"));
  assert.ok(modal.includes("confirmDisabled"));
  console.log("✓ modal supports Escape cancel, focus trap, loading, typed confirm");

  // Escape must cancel, never call onConfirm
  assert.ok(!/Escape[\s\S]{0,120}onConfirm/.test(modal));
  console.log("✓ Escape does not confirm any action");

  const drawer = read("src/components/auto-trade/TradingSettingsDrawer.tsx");
  assert.ok(drawer.includes("Apply Risk Increase"));
  assert.ok(drawer.includes("Review Settings"));
  assert.ok(drawer.includes("detectRiskIncreases"));
  assert.ok(drawer.includes("ConfirmActionModal"));
  assertNoNativeDialogs("src/components/auto-trade/TradingSettingsDrawer.tsx");
  console.log("✓ settings risk-increase uses in-app modal");

  const toast = read("src/components/ui/Toast.tsx");
  assert.ok(toast.includes("pushToast"));
  assert.ok(toast.includes("ToastProvider"));
  assert.ok(!toast.includes("window.alert"));
  console.log("✓ toast system present without browser alerts");

  // Frontend trading ops scan
  const tradingRoots = [
    "src/components/auto-trade",
    "src/components/ui/ConfirmActionModal.tsx",
    "src/components/ui/Toast.tsx",
  ];
  for (const root of tradingRoots) {
    const full = path.join(process.cwd(), root);
    const st = fs.statSync(full);
    if (st.isFile()) {
      assertNoNativeDialogs(root);
      continue;
    }
    for (const name of fs.readdirSync(full)) {
      if (!name.endsWith(".tsx") && !name.endsWith(".ts")) continue;
      assertNoNativeDialogs(path.join(root, name).replace(/\\/g, "/"));
    }
  }
  console.log("✓ trading frontend free of native dialogs");

  console.log("verify:auto-trade-modals passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
