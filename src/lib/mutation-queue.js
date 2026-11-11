// Serialize changes to each fragment and make closing wait for every write.
export function createMutationQueue() {
  const pending = new Map();
  const failures = new Map();
  let failureVersion = 0;
  return {
    enqueue(id, operation) {
      const previous = pending.get(id) ?? Promise.resolve();
      const request = previous.then(operation);
      pending.set(id, request);
      const finish = () => { if (pending.get(id) === request) pending.delete(id); };
      request.then(
        () => { failures.delete(id); finish(); },
        error => { failureVersion++; failures.set(id, error); finish(); },
      );
      return request;
    },
    async flush() {
      const version = failureVersion;
      const alreadyFailed = failures.size > 0;
      // Writes queued while an earlier write is settling also belong to this
      // close operation (e.g. a fast edit/delete immediately after adding).
      while (pending.size) await Promise.allSettled([...pending.values()]);
      // A fresh dashboard can acknowledge failures while this flush is waiting,
      // but that must not hide a write which failed during this close attempt.
      if (alreadyFailed || failures.size || version !== failureVersion) {
        throw new Error("저장하지 못한 조각이 있어요. 화면의 기록을 확인한 뒤 다시 마감해 주세요.");
      }
    },
    acknowledgeFailures() {
      if (pending.size) return false;
      failures.clear();
      return true;
    },
  };
}
