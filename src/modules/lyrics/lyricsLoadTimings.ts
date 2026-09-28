import { LOG_PREFIX } from "@constants";
import { log } from "@utils";

interface LyricsLoadStep {
  name: string;
  ms: number;
  concurrent: boolean;
}

export class LyricsLoadTimer {
  private readonly startTime = performance.now();
  private readonly pendingStarts = new Map<string, number>();
  private readonly steps: LyricsLoadStep[] = [];
  private completed = false;
  private incompleteLogged = false;

  begin(name: string): void {
    this.pendingStarts.set(name, performance.now());
  }

  end(name: string): void {
    const start = this.pendingStarts.get(name);
    if (start === undefined) return;
    this.pendingStarts.delete(name);
    this.add(name, performance.now() - start);
  }

  add(name: string, ms: number, concurrent = false): void {
    this.steps.push({ name, ms, concurrent });
  }

  complete(meta: { source: string; provider?: string; fromCache?: boolean }): void {
    if (this.completed) return;
    this.completed = true;
    const total = Math.round(performance.now() - this.startTime);
    const cache = meta.fromCache === undefined ? "n/a" : meta.fromCache ? "HIT" : "MISS";
    log(
      LOG_PREFIX,
      `Lyrics loaded in ${total}ms from ${meta.source} (provider=${meta.provider ?? "n/a"}, cache=${cache})`
    );
    if (this.steps.length === 0) return;
    log(LOG_PREFIX, `Lyrics timing steps: ${this.formatSteps()}`);
    const slowest = this.sortedSteps()[0];
    const pct = total > 0 ? Math.round((slowest.ms / total) * 100) : 0;
    log(LOG_PREFIX, `Slowest step: ${slowest.name} (${Math.round(slowest.ms)}ms, ${pct}% of total)`);
  }

  incomplete(): void {
    if (this.completed || this.incompleteLogged) return;
    this.incompleteLogged = true;
    const elapsed = Math.round(performance.now() - this.startTime);
    log(LOG_PREFIX, `Lyrics load did not complete after ${elapsed}ms; steps so far: ${this.formatSteps()}`);
  }

  private sortedSteps(): LyricsLoadStep[] {
    return [...this.steps].sort((a, b) => b.ms - a.ms);
  }

  private formatSteps(): string {
    return this.sortedSteps()
      .map(step => `${step.name}${step.concurrent ? " (concurrent)" : ""}=${Math.round(step.ms)}ms`)
      .join(", ");
  }
}
