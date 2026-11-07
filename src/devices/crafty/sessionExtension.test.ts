import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSessionExtension } from "./sessionExtension";
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => vi.useRealTimers());
const setup = () => {
  const io = {
    eligible: vi.fn(() => true),
    readRemaining: vi.fn<() => Promise<number | null>>(),
    reapply: vi.fn(async () => {}),
    report: vi.fn(),
  };
  const session = createSessionExtension(io);
  return { io, session };
};
it("confirms resets every 30 seconds, ending attempts at five minutes", async () => {
  const { io, session } = setup();
  let reads = 0;
  io.readRemaining.mockImplementation(async () => (++reads % 2 ? 270 : 300));
  session.start();
  await vi.advanceTimersByTimeAsync(300_000);
  expect(io.reapply).toHaveBeenCalledTimes(9);
  expect(io.report.mock.lastCall?.[0]).toBe(false);
  await vi.advanceTimersByTimeAsync(600_000);
  expect(io.reapply).toHaveBeenCalledTimes(9);
});
it("stops if the official setting write does not reset the timer", async () => {
  const { io, session } = setup();
  io.readRemaining.mockResolvedValueOnce(270).mockResolvedValueOnce(269);
  session.start();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(io.reapply).toHaveBeenCalledTimes(1);
  expect(io.report.mock.lastCall?.[1]).toContain("Kein Timer-Reset");
});
it("does not send writes after cancellation while awaiting a read", async () => {
  const { io, session } = setup();
  let resolve!: (n: number) => void;
  io.readRemaining.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  session.start();
  await vi.advanceTimersByTimeAsync(30_000);
  session.stop();
  resolve(270);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(io.reapply).not.toHaveBeenCalled();
});
it("stops when heating or foreground eligibility is lost", async () => {
  const { io, session } = setup();
  session.start();
  io.eligible.mockReturnValue(false);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(io.reapply).not.toHaveBeenCalled();
  expect(io.report.mock.lastCall?.[0]).toBe(false);
});
it("never extends an expired timer", async () => {
  const { io, session } = setup();
  io.readRemaining.mockResolvedValue(0);
  session.start();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(io.reapply).not.toHaveBeenCalled();
});
it("times out stalled reads without overlapping attempts", async () => {
  const { io, session } = setup();
  io.readRemaining.mockImplementation(() => new Promise(() => {}));
  session.start();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(io.readRemaining).toHaveBeenCalledTimes(1);
  expect(io.report.mock.lastCall?.[0]).toBe(false);
  expect(io.reapply).not.toHaveBeenCalled();
});
it("stops on Bluetooth rejection", async () => {
  const { io, session } = setup();
  io.readRemaining.mockRejectedValue(new Error("disconnected"));
  session.start();
  await vi.advanceTimersByTimeAsync(90_000);
  expect(io.readRemaining).toHaveBeenCalledTimes(1);
  expect(io.report.mock.lastCall?.[0]).toBe(false);
});
