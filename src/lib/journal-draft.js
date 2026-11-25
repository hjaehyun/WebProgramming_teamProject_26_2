const entriesFor = (snapshot, date) => snapshot?.artworks?.[date]?.entries ?? snapshot?.drafts?.[date] ?? [];

/** A page-local writer. Keep an uncertain create ID until a server read can reconcile it. */
export function createJournalDraftSaver() {
  let uncertain = null;
  let running = null;

  async function persist({ date, text, editingId, entries }, actions) {
    const { addEntry, editEntry, flushEntries, refresh, isCurrentSession = () => true } = actions;
    let submitted = null;
    try {
      if (!isCurrentSession()) throw new Error("로그인 상태가 바뀌었어요. 다시 확인해 주세요.");
      // A lost response may still have committed. Never create a second note until
      // an authoritative read has established whether the original ID exists.
      if (uncertain) {
        const latest = await refresh(true);
        if (!isCurrentSession()) throw new Error("로그인 상태가 바뀌었어요. 다시 확인해 주세요.");
        if (!latest) throw new Error("저장 상태를 확인하지 못했어요. 입력한 글은 그대로 남아 있어요.");
        const existing = entriesFor(latest, date).find(entry => entry.id === uncertain.id);
        if (existing) editingId = existing.id;
        entries = entriesFor(latest, date);
        uncertain = null;
      }
      if (text) {
        if (editingId) {
          const old = entries.find(entry => entry.id === editingId);
          if (!old) throw new Error("수정 중인 조각을 찾지 못했어요. 입력한 글을 복사한 뒤 기록을 확인해 주세요.");
          submitted = { id: editingId, text };
          if (old.text !== text) {
            uncertain = submitted;
            await editEntry(date, editingId, text);
          }
        } else {
          submitted = { id: addEntry(date, text).id, text };
          uncertain = submitted;
        }
      } else if (editingId) {
        throw new Error("수정할 내용을 입력하거나 수정을 취소해 주세요.");
      }
      await flushEntries();
      uncertain = null;
      return { saved: true, error: null };
    } catch (error) {
      // Another note may have failed while this one succeeded. Only the server
      // snapshot, never the optimistic list, can allow the input to be cleared.
      const latest = await refresh().catch(() => null);
      const saved = !!submitted && !!latest && entriesFor(latest, date)
        .some(entry => entry.id === submitted.id && entry.text === submitted.text);
      if (saved || (latest && uncertain && !entriesFor(latest, date).some(entry => entry.id === uncertain.id))) uncertain = null;
      return { saved, error };
    }
  }

  return {
    save(input, actions) {
      if (running) return running;
      const request = persist(input, actions);
      running = request;
      request.finally(() => { if (running === request) running = null; });
      return request;
    },
  };
}

/** Capture only a navigation that would replace this page, not new-tab/download clicks. */
export function journalLinkDestination(event, location) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const anchor = event.target?.closest?.("a[href]");
  if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return null;
  const destination = new URL(anchor.href, location.href);
  if (destination.origin !== location.origin || !["http:", "https:"].includes(destination.protocol)) return null;
  if (destination.pathname === location.pathname && destination.search === location.search) return null;
  return `${destination.pathname}${destination.search}${destination.hash}`;
}
