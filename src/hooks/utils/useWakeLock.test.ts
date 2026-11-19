import { createRoot, createSignal } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { useWakeLock } from "./useWakeLock";

afterEach(() => vi.unstubAllGlobals());

it("releases when disabled and reacquires when the app becomes visible", async () => {
  const visibilityListeners = new Map<string, EventListener>();
  const documentMock = {
    visibilityState: "visible",
    addEventListener: (type: string, listener: EventListener) =>
      visibilityListeners.set(type, listener),
    removeEventListener: (type: string) => visibilityListeners.delete(type),
  };
  const makeLock = () => {
    const listeners = new Map<string, EventListener>();
    return {
      release: vi.fn(async () => {}),
      addEventListener: (type: string, listener: EventListener) =>
        listeners.set(type, listener),
      emitRelease: () => listeners.get("release")?.(new Event("release")),
    } as unknown as WakeLockSentinel & {
      emitRelease: () => void;
    };
  };
  const firstLock = makeLock();
  const secondLock = makeLock();
  const request = vi
    .fn<() => Promise<WakeLockSentinel>>()
    .mockResolvedValueOnce(firstLock)
    .mockResolvedValueOnce(secondLock);
  vi.stubGlobal("document", documentMock as unknown as Document);
  vi.stubGlobal("navigator", { wakeLock: { request } });

  let setEnabled!: (enabled: boolean) => boolean;
  const dispose = createRoot((dispose) => {
    const [enabled, set] = createSignal(false);
    setEnabled = set;
    useWakeLock(enabled);
    return dispose;
  });

  setEnabled(true);
  await Promise.resolve();
  expect(request).toHaveBeenCalledOnce();

  documentMock.visibilityState = "hidden";
  firstLock.emitRelease();
  documentMock.visibilityState = "visible";
  visibilityListeners.get("visibilitychange")?.(new Event("visibilitychange"));
  await Promise.resolve();
  expect(request).toHaveBeenCalledTimes(2);

  setEnabled(false);
  await Promise.resolve();
  expect(secondLock.release).toHaveBeenCalledOnce();
  dispose();
});
