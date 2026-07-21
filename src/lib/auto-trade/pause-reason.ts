/**
 * Plain-English engine pause reasons for monitor / auto-trade UI.
 * Presentation only — does not change pause semantics.
 */

export type EnginePauseFlags = {
  panicStop?: boolean;
  killSwitch?: boolean;
  runtimeDisabled?: boolean;
};

export function isEnginePaused(flags: EnginePauseFlags): boolean {
  return Boolean(flags.panicStop || flags.killSwitch || flags.runtimeDisabled);
}

/** Specific reason — never the vague "Engine paused" alone when more is known. */
export function describeEnginePauseReason(flags: EnginePauseFlags): string {
  if (flags.panicStop) {
    return "New entries are paused after an emergency stop. Clear emergency stop, then Resume Engine.";
  }
  if (flags.killSwitch) {
    return "New entries are paused by the kill switch. Clear the kill switch, then Resume Engine.";
  }
  if (flags.runtimeDisabled) {
    return "New entries are paused. Resume Engine from Auto Trading to allow scans and proposals.";
  }
  return "New entries are paused.";
}
