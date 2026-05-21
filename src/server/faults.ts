/**
 * Named crash points for tests. In normal runs nothing is armed and hit() is a no-op.
 * A SimulatedCrash models the process dying: callers must let it propagate without cleaning up,
 * exactly as a SIGKILL would leave things.
 */
export class SimulatedCrash extends Error {
  constructor(public readonly point: string) {
    super(`simulated crash at ${point}`);
    this.name = "SimulatedCrash";
  }
}

const armed = new Map<string, number>();

export const faults = {
  arm(point: string, times = 1) {
    armed.set(point, times);
  },
  reset() {
    armed.clear();
  },
  hit(point: string) {
    const n = armed.get(point);
    if (!n) return;
    if (n <= 1) armed.delete(point);
    else armed.set(point, n - 1);
    throw new SimulatedCrash(point);
  },
};
