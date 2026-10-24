export type PollController = { abort(): void };

export function pollResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  options: { isTerminal: (value: T) => boolean; onValue?: (value: T) => void; onError?: (error: unknown) => void; activeMs?: number; backgroundMs?: number },
): PollController {
  const controller = new AbortController();
  const activeMs = options.activeMs ?? 2_000;
  const backgroundMs = options.backgroundMs ?? 10_000;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;

  const schedule = () => {
    if (controller.signal.aborted) return;
    const delay = typeof document !== "undefined" && document.visibilityState === "hidden" ? backgroundMs : activeMs;
    timeout = setTimeout(run, delay);
  };
  const run = async () => {
    const current = ++generation;
    try {
      const value = await load(controller.signal);
      if (controller.signal.aborted || current !== generation) return;
      options.onValue?.(value);
      if (!options.isTerminal(value)) schedule();
    } catch (error) {
      if (!controller.signal.aborted) { options.onError?.(error); schedule(); }
    }
  };
  const onVisibility = () => {
    if (timeout) clearTimeout(timeout);
    schedule();
  };
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
  void run();
  return { abort() { generation += 1; controller.abort(); if (timeout) clearTimeout(timeout); if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility); } };
}
