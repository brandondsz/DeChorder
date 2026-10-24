/**
 * Debounces frame-by-frame guesses: a chord is only reported once it has been the top
 * guess for `holdFrames` consecutive frames, so the half-fretted moment mid-change
 * doesn't flash up as a wrong chord. The last committed chord is kept through silence.
 */
export class ChordStabilizer {
  private candidateId: string | null = null;
  private count = 0;
  private committedId: string | null = null;
  private freshCommit = false;

  constructor(private readonly holdFrames: number) {}

  push(topId: string | null): string | null {
    if (topId === this.candidateId) {
      this.count++;
    } else {
      this.candidateId = topId;
      this.count = 1;
    }
    this.freshCommit = topId !== null && this.count === this.holdFrames;
    if (topId !== null && this.count >= this.holdFrames) this.committedId = topId;
    return this.committedId;
  }

  /**
   * True on the push where a chord has just been held for the full hold period, including
   * the same chord as before when it comes back after silence (or a different chord).
   */
  get justCommitted(): boolean {
    return this.freshCommit;
  }

  get committed(): string | null {
    return this.committedId;
  }

  reset(): void {
    this.candidateId = null;
    this.count = 0;
    this.committedId = null;
  }
}
