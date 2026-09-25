export interface AssistantWorkerCycleDependencies {
  enabled: boolean;
  extractionEnabled: boolean;
  operationsEnabled: boolean;
  nowMs: number;
  nextCleanupAt: number;
  cleanup: () => Promise<void>;
  extract: () => Promise<boolean>;
  operate: () => Promise<boolean>;
}

/** La retención sigue su cadencia; los flags controlan únicamente el consumo. */
export async function runAssistantWorkerCycle(deps: AssistantWorkerCycleDependencies) {
  let nextCleanupAt = deps.nextCleanupAt;
  if (deps.nowMs >= nextCleanupAt) {
    await deps.cleanup();
    nextCleanupAt = deps.nowMs + 3_600_000;
  }
  if (!deps.enabled) return { worked: false, nextCleanupAt };
  const extracted = deps.extractionEnabled ? await deps.extract() : false;
  const operated = deps.operationsEnabled ? await deps.operate() : false;
  return { worked: extracted || operated, nextCleanupAt };
}
