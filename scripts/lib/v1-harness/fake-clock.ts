/**
 * Controllable clock for Version 1 simulations (max-hold / EOD).
 */

export class FakeClock {
  private ms: number;

  constructor(iso = "2026-07-16T15:00:00.000Z") {
    this.ms = Date.parse(iso);
  }

  nowMs() {
    return this.ms;
  }

  iso() {
    return new Date(this.ms).toISOString();
  }

  set(iso: string) {
    this.ms = Date.parse(iso);
  }

  advanceMinutes(mins: number) {
    this.ms += mins * 60_000;
  }

  /** Minutes since 09:30 ET on a fixed RTH day fixture (approx for tests). */
  minutesSinceOpen(openIso = "2026-07-16T13:30:00.000Z") {
    return Math.floor((this.ms - Date.parse(openIso)) / 60_000);
  }

  minutesToClose(closeIso = "2026-07-16T20:00:00.000Z") {
    return Math.floor((Date.parse(closeIso) - this.ms) / 60_000);
  }
}
