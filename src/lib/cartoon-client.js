"use client";

import { useEffect, useRef, useState } from "react";

const pending = cartoon => cartoon && ["queued", "processing"].includes(cartoon.status);
export function validCartoonDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "") || value < "0001-01-01") return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const emptyView = () => ({ payload: null, error: null, loading: true, posting: false, fetchedAt: 0 });

/** One request at a time for one mounted edition; dispose fences every late response. */
export function createEditionSession({ requestedDate, autoRequested, onChange }) {
  let live = true, busy = false, timer, controller, current = null, awaitingStartUntil = 0;
  const schedule = () => {
    clearTimeout(timer);
    if (live && !document.hidden && awaitingStartUntil > Date.now()) timer = setTimeout(() => request("GET"), Math.min(5000, awaitingStartUntil - Date.now()));
    else if (live && !document.hidden && pending(current?.cartoon)) timer = setTimeout(() => request("GET"), 5000);
    else if (live && !document.hidden) {
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
    const requestDate = requestedDate ?? (method === "POST" ? current?.today : null);
    if (method === "POST") onChange(previous => ({ ...previous, posting: true, error: null }));
    try {
      const url = method === "GET" && requestedDate ? `/api/cartoons?date=${encodeURIComponent(requestedDate)}` : "/api/cartoons";
      const response = await fetch(url, {
        method, cache: "no-store", signal: controller.signal,
        ...(method === "POST" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: requestDate }) } : {}),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "만평을 불러오지 못했어요. 잠시 후 다시 확인해 주세요.");
      if (!data || !validCartoonDate(data.today) || !Array.isArray(data.dates)) throw new Error("만평 정보를 확인하지 못했어요.");
      if (!live) return;
      // Every POST carries the displayed date, including across midnight. Never show another day's result.
      if (requestDate && data.cartoon && data.cartoon.date !== requestDate) throw new Error("선택한 날짜의 만평을 확인하지 못했어요. 다시 불러와 주세요.");
      current = data;
      // after() can start the retry only after POST returns the old failed row.
      // Briefly observe that accepted request without issuing another paid start.
      const waitingForClaim = data.canRequest && !pending(data.cartoon) && !["ready", "unavailable"].includes(data.cartoon?.status);
      if (method === "POST" && waitingForClaim) awaitingStartUntil = Date.now() + 30000;
      else if (!waitingForClaim || Date.now() >= awaitingStartUntil) awaitingStartUntil = 0;
      onChange({ payload: data, error: null, loading: false, posting: awaitingStartUntil > Date.now(), fetchedAt: Date.now() });
      // A server lease/cooldown closes the previous attempt. When it opens again,
      // allow recovery; a failed POST followed by canRequest=true remains latched.
      const day = requestedDate ?? data.today;
      if (method === "GET" && !data.canRequest) autoRequested.delete(day);
      if (method === "GET" && data.cartoon?.status !== "ready" && data.enabled && data.canRequest &&
          validCartoonDate(day) && day <= data.today && (day === data.today || pending(data.cartoon)) &&
          !document.hidden && !autoRequested.has(day)) {
        autoRequested.add(day);
        startAutomatically = true;
      }
    } catch (error) {
      if (live) {
        onChange(previous => ({ ...previous, loading: false, posting: awaitingStartUntil > Date.now(), error: error.name === "AbortError" ? "불러오는 데 시간이 걸리고 있어요. 잠시 후 다시 확인해 주세요." : error.message }));
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
      const day = requestedDate ?? current?.today;
      if (awaitingStartUntil <= Date.now() && current?.enabled && current.canRequest && validCartoonDate(day) && day <= current.today) {
        autoRequested.add(day);
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
