// A full dashboard snapshot may replace optimistic/local state only if no write
// or generation update happened after its GET started. One instance per session.
export function createSnapshotSync() {
  let revision = 0;
  let pendingWrites = 0;
  let activeRead = null;
  const idle = new Set();
  const waitForWrites = () => pendingWrites === 0 ? Promise.resolve() : new Promise(resolve => idle.add(resolve));
  return {
    changed() { revision++; },
    beginWrite() {
      revision++; pendingWrites++;
      let finished = false;
      return () => {
        if (finished) return;
        finished = true; revision++; pendingWrites--;
        if (!pendingWrites) { for (const resolve of idle) resolve(); idle.clear(); }
      };
    },
    read(load, accept) {
      if (activeRead) return activeRead;
      const request = (async () => {
        for (;;) {
          await waitForWrites();
          const startedAt = revision;
          let value;
          try { value = await load(); }
          catch (error) {
            if (revision !== startedAt || pendingWrites) continue;
            throw error;
          }
          if (revision !== startedAt || pendingWrites) continue;
          accept(value);
          return value;
        }
      })();
      activeRead = request;
      const finished = () => { if (activeRead === request) activeRead = null; };
      request.then(finished, finished);
      return request;
    },
  };
}
