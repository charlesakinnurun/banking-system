import type { Clock } from '../../application/ports.js';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** Deterministic clock for tests. */
export class FixedClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return this.current;
  }
  set(date: Date): void {
    this.current = date;
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
