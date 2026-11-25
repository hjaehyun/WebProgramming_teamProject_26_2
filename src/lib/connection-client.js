"use client";

import { useEffect, useRef, useState } from "react";
import { validJournalDate } from "./journal-calendar";

const working = connection => connection && ["queued", "processing"].includes(connection.status);
const emptyView = () => ({ payload: null, error: null, loading: true, posting: false, fetchedAt: 0 });

// Reading can resume an already approved job on the server. Only start() sends
// a new POST; visiting, polling and returning to a tab never approve generation.
export function createConnectionSession({ date, beforeStart, onChange }) {
  let live = true, busy = false, timer, controller, current = null, uncertain = null;
  const schedule = () => {
    clearTimeout(timer);
    if (!live || document.hidden) return;
    if (working(current?.connection)) timer = setTimeout(() => request("GET"), 5000);
    else {
      const delay = new Date(current?.retryAt).getTime() - Date.now();
      if (delay > 0) timer = setTimeout(() => request("GET"), Math.min(delay + 250, 2147483647));
    }
  };
  const request = async (method, regenerate = false) => {
    if (!live || busy) return;
    busy = true;
    clearTimeout(timer);
    let timeout, checkAfterPost = false;
    if (method === "POST") onChange(previous => ({ ...previous, posting: true, error: null }));
    try {
      if (method === "POST") {
        await beforeStart();
        if (!live) return;
        if (!uncertain || uncertain.refresh !== regenerate) {
          uncertain = { requestId: crypto.randomUUID(), refresh: regenerate, attempts: current?.connection?.attempts ?? 0 };
        }
      }
      controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 30000);
      const response = await fetch(method === "GET" ? `/api/connections?date=${encodeURIComponent(date)}` : "/api/connections", {
        method, cache: "no-store", signal: controller.signal,
        ...(method === "POST" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, refresh: regenerate, requestId: uncertain.requestId }) } : {}),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        // A definite rejection did not enqueue this request. A network/5xx failure
        // may have, so retain its id for an explicit retry after checking status.
        if (method === "POST" && response.status < 500) uncertain = null;
        throw new Error(data?.error || "하루연결을 불러오지 못했어요. 잠시 후 다시 확인해 주세요.");
      }
      if (!data || data.date !== date || !validJournalDate(data.today) || !Array.isArray(data.dates) || (data.connection && data.connection.date !== date)) {
        throw new Error("선택한 날짜의 연결 정보를 확인하지 못했어요.");
      }
      if (!live) return;
      if (method === "POST" || working(data.connection) || (data.connection?.attempts ?? 0) > (uncertain?.attempts ?? Infinity)) uncertain = null;
      current = data;
      onChange({ payload: data, error: null, loading: false, posting: false, fetchedAt: Date.now() });
    } catch (error) {
      if (live) {
        onChange(previous => ({ ...previous, loading: false, posting: false, error: error.name === "AbortError" ? "불러오는 데 시간이 걸리고 있어요. 다시 확인해 주세요." : error.message }));
        checkAfterPost = method === "POST" && uncertain !== null;
      }
    } finally {
      clearTimeout(timeout);
      busy = false;
      if (live) {
        if (checkAfterPost && !document.hidden) timer = setTimeout(() => request("GET"), 1000);
        else schedule();
      }
    }
  };
  const visible = () => {
    clearTimeout(timer);
    if (!document.hidden) void request("GET");
  };
  void request("GET");
  document.addEventListener("visibilitychange", visible);
  return {
    refresh: () => request("GET"),
    start: (regenerate = false) => {
      if (current?.enabled && current.consent && current.hasEntries && (regenerate ? current.canRefresh : current.canRequest)) return request("POST", regenerate);
    },
    dispose: () => {
      live = false;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", visible);
    },
  };
}

export function useConnection(date, beforeStart) {
  const [view, setView] = useState(emptyView);
  const actions = useRef(null);
  const prepare = useRef(beforeStart);
  useEffect(() => { prepare.current = beforeStart; }, [beforeStart]);
  useEffect(() => {
    const session = createConnectionSession({ date, beforeStart: () => prepare.current(), onChange: setView });
    actions.current = session;
    return () => { session.dispose(); actions.current = null; };
  }, [date]);
  return { ...view, refresh: () => actions.current?.refresh(), start: (regenerate = false) => actions.current?.start(regenerate) };
}
