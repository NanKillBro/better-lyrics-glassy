import assert from "node:assert/strict";
import { disposePlayerPanelRefit, refitPlayerPanel } from "@modules/ui/layout/playerRefit";

interface ScheduledTimer {
  id: number;
  delay: number;
  cleared: boolean;
  run: () => void;
}

interface MockEnvOptions {
  hasMainPanel?: boolean;
  hasSidePanel?: boolean;
}

function createMockEnv(options: MockEnvOptions = {}) {
  const { hasMainPanel = true, hasSidePanel = true } = options;
  const removedProps: string[] = [];
  const dispatchedEvents: string[] = [];
  const timers = new Map<number, ScheduledTimer>();
  let nextTimerId = 1;

  const observerRecords: Array<{
    observed: Element[];
    disconnected: boolean;
    trigger: () => void;
  }> = [];

  class MockEvent {
    readonly type: string;
    constructor(type: string) {
      this.type = type;
    }
  }

  class MockResizeObserver {
    private readonly callback: ResizeObserverCallback;
    private readonly record: {
      observed: Element[];
      disconnected: boolean;
      trigger: () => void;
    };

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
      this.record = {
        observed: [],
        disconnected: false,
        trigger: () => {
          if (!this.record.disconnected) {
            this.callback([], this as unknown as ResizeObserver);
          }
        },
      };
      observerRecords.push(this.record);
    }

    observe(target: Element): void {
      this.record.observed.push(target);
    }

    unobserve(): void {}

    disconnect(): void {
      this.record.disconnected = true;
    }
  }

  const win = {
    Event: MockEvent,
    ResizeObserver: MockResizeObserver,
    dispatchEvent(event: Event): boolean {
      dispatchedEvents.push(event.type);
      return true;
    },
    setTimeout(fn: () => void, delay = 0): number {
      const id = nextTimerId++;
      timers.set(id, { id, delay, cleared: false, run: fn });
      return id;
    },
    clearTimeout(id: number): void {
      const entry = timers.get(id);
      if (entry) entry.cleared = true;
    },
  };

  const doc = {
    defaultView: win,
    querySelector(selector: string): HTMLElement | null {
      if (selector === "ytmusic-player-page #main-panel") return mainPanel;
      if (selector === "ytmusic-player-page #side-panel") return sidePanel;
      return null;
    },
  } as unknown as Document;

  const mainPanel = hasMainPanel
    ? ({
        ownerDocument: doc,
        style: {
          removeProperty(prop: string): string {
            removedProps.push(prop);
            return "";
          },
        },
      } as unknown as HTMLElement)
    : null;

  const sidePanel = hasSidePanel
    ? ({
        ownerDocument: doc,
      } as unknown as HTMLElement)
    : null;

  return {
    doc,
    sidePanel,
    removedProps,
    dispatchedEvents,
    timers,
    observerRecords,
  };
}

// 1. Missing panels should no-op cleanly.
{
  const env = createMockEnv({ hasMainPanel: false });
  refitPlayerPanel(env.doc);
  assert.equal(env.observerRecords.length, 0);
  assert.equal(env.timers.size, 0);
}

// 2. Observing sidePanel removes stale #main-panel padding, dispatches resize, and settles cleanly.
{
  const env = createMockEnv();
  refitPlayerPanel(env.doc);

  assert.equal(env.observerRecords.length, 1);
  assert.deepEqual(env.observerRecords[0].observed, [env.sidePanel]);
  assert.equal(env.timers.size, 1);

  const timer = env.timers.get(1);
  assert.ok(timer);
  assert.equal(timer.delay, 1000);
  assert.equal(timer.cleared, false);

  env.observerRecords[0].trigger();
  assert.deepEqual(env.removedProps, ["padding"]);
  assert.deepEqual(env.dispatchedEvents, ["resize"]);
  assert.equal(env.observerRecords[0].disconnected, false);

  timer.run();
  assert.equal(env.observerRecords[0].disconnected, true);
  disposePlayerPanelRefit();
}

// 3. Re-invoking refitPlayerPanel cleans up the previous observer and timer without disrupting the new refit.
{
  const first = createMockEnv();
  const second = createMockEnv();

  refitPlayerPanel(first.doc);
  refitPlayerPanel(second.doc);

  const firstTimer = first.timers.get(1);
  assert.ok(firstTimer);
  assert.equal(first.observerRecords[0].disconnected, true);
  assert.equal(firstTimer.cleared, true);
  assert.equal(second.observerRecords[0].disconnected, false);

  // Even if the superseded timer callback runs directly, it must not tear down the active refit.
  firstTimer.run();
  assert.equal(second.observerRecords[0].disconnected, false);

  disposePlayerPanelRefit();
  assert.equal(second.observerRecords[0].disconnected, true);
}

// 4. disposePlayerPanelRefit cancels both the observer and pending settle timer.
{
  const env = createMockEnv();
  refitPlayerPanel(env.doc);
  disposePlayerPanelRefit();

  const timer = env.timers.get(1);
  assert.ok(timer);
  assert.equal(timer.cleared, true);
  assert.equal(env.observerRecords[0].disconnected, true);
}

console.log("[selfcheck] playerRefit passed");
