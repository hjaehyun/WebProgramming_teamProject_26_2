"use client";

import { useEffect, useRef, useState } from "react";

const pending = cartoon => cartoon && ["queued", "processing"].includes(cartoon.status);
export function validCartoonDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const emptyView = () => ({ payload: null, error: null, loading: true, posting: false, fetchedAt: 0 });

/** One request at a time for one mounted edition; dispose fences every late response. */
export function createEditionSession({ requestedDate, autoRequested, onChange }) {
  let live = true, busy = false, timer, controller, current = null;
  const schedule = () => {
    clearTimeout(timer);
    if (live && !document.hidden && pending(current?.cartoon)) timer = setTimeout(() => request("GET"), 5000);
    else if (live && !document.hidden && (!requestedDate || requestedDate === current?.today)) {
      const wakeAt = current?.cartoon ? current.cartoon.retryAt : current?.availableAt;
      const untilNextCheck = new Date(wakeAt).getTime() - Date.now();
      if (untilNextCheck > 0) timer = setTimeout(() => request("GET"), untilNextCheck + 1000);
    }
  };
  const request = async method => {
    if (!live || busy) return;
    busy = true;
    controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let startAutomatically = false, checkAfterPost = false;
    if (method === "POST") onChange(previous => ({ ...previous, posting: true, error: null }));
    try {
      const url = method === "GET" && requestedDate ? `/api/cartoons?date=${encodeURIComponent(requestedDate)}` : "/api/cartoons";
      const response = await fetch(url, {
        method, cache: "no-store", signal: controller.signal,
        ...(method === "POST" ? { headers: { "Content-Type": "application/json" }, body: "{}" } : {}),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "만평을 불러오지 못했어요. 잠시 후 다시 확인해 주세요.");
      if (!data || !validCartoonDate(data.today) || !Array.isArray(data.dates)) throw new Error("만평 정보를 확인하지 못했어요.");
      if (!live) return;
      // POST always concerns today. A page left open across midnight must not show it as yesterday's.
      if (requestedDate && data.cartoon && data.cartoon.date !== requestedDate) {
        checkAfterPost = method === "POST";
      } else {
        current = data;
        onChange({ payload: data, error: null, loading: false, posting: false, fetchedAt: Date.now() });
        // A server lease/cooldown closes the previous attempt. When it opens again,
        // allow recovery; a failed POST followed by canRequest=true remains latched.
        if (method === "GET" && !data.canRequest && (!requestedDate || requestedDate === data.today)) autoRequested.delete(data.today);
        if (method === "GET" && data.cartoon?.status !== "ready" && data.enabled && data.canRequest &&
            (!requestedDate || requestedDate === data.today) && !document.hidden && !autoRequested.has(data.today)) {
          autoRequested.add(data.today);
          startAutomatically = true;
        }
      }
    } catch (error) {
      if (live) {
        onChange(previous => ({ ...previous, loading: false, posting: false, error: error.name === "AbortError" ? "불러오는 데 시간이 걸리고 있어요. 잠시 후 다시 확인해 주세요." : error.message }));
        // A lost POST response may still have created the shared job. Read before offering another start.
        checkAfterPost = method === "POST";
      }
    } finally {
      clearTimeout(timeout);
      busy = false;
      if (live) {
        if (startAutomatically) void request("POST");
        else if (checkAfterPost && !document.hidden) timer = setTimeout(() => request("GET"), 1000);
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
    start: () => {
      if (current?.enabled && current.canRequest && (!requestedDate || requestedDate === current.today)) {
        autoRequested.add(current.today);
        return request("POST");
      }
    },
    dispose: () => {
      live = false;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", visible);
    },
  };
}

export function useEdition(requestedDate, autoRequested) {
  const [view, setView] = useState(emptyView);
  const actions = useRef(null);
  useEffect(() => {
    const session = createEditionSession({ requestedDate, autoRequested: autoRequested.current, onChange: setView });
    actions.current = session;
    return () => { session.dispose(); actions.current = null; };
  }, [requestedDate, autoRequested]);
  return { ...view, refresh: () => actions.current?.refresh(), start: () => actions.current?.start() };
}
