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
  const schedule = (retryRead = false, stopPolling = false) => {
    clearTimeout(timer);
    if (!live || document.hidden || stopPolling) return;
    if (awaitingStartUntil > Date.now()) timer = setTimeout(() => request("GET"), Math.min(5000, awaitingStartUntil - Date.now()));
    else if (pending(current?.cartoon) || retryRead) timer = setTimeout(() => request("GET"), 5000);
    else {
      const wakeAt = current?.cartoon ? current.cartoon.retryAt : current?.availableAt;
      const untilNextCheck = new Date(wakeAt).getTime() - Date.now();
      if (untilNextCheck > 0) timer = setTimeout(() => request("GET"), untilNextCheck + 1000);
    }
  };
  const request = async method => {
    if (!live || busy) return;
    busy = true;
    clearTimeout(timer);
    controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let startAutomatically = false, checkAfterPost = false, mayHaveStarted = method === "POST";
    let retryRead = false, stopPolling = false, transientReadError = true;
    const requestDate = requestedDate ?? (method === "POST" ? current?.today : null);
    if (method === "POST") onChange(previous => ({ ...previous, posting: true, error: null }));
    try {
      const url = method === "GET" && requestedDate ? `/api/cartoons?date=${encodeURIComponent(requestedDate)}` : "/api/cartoons";
      const response = await fetch(url, {
        method, cache: "no-store", signal: controller.signal,
        ...(method === "POST" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: requestDate }) } : {}),
      });
      if (!response.ok && response.status < 500) mayHaveStarted = false;
      transientReadError = response.status >= 500 || response.status === 408 || response.status === 429;
      const data = await response.json().catch(() => { transientReadError = response.ok || transientReadError; return null; });
      if (!response.ok) throw new Error(data?.error || "만평을 불러오지 못했어요. 잠시 후 다시 확인해 주세요.");
      if (!data || !validCartoonDate(data.today) || !Array.isArray(data.dates)) throw new Error("만평 정보를 확인하지 못했어요.");
      if (!live) return;
      // Every POST carries the displayed date, including across midnight. Never show another day's result.
      if (requestDate && data.cartoon && data.cartoon.date !== requestDate) throw new Error("선택한 날짜의 만평을 확인하지 못했어요. 다시 불러와 주세요.");
      current = data;
      // after() can start the retry only after POST returns the old retryable row.
      // Briefly observe that accepted request without issuing another paid start.
      const waitingForClaim = data.canRequest && !pending(data.cartoon) && data.cartoon?.status !== "ready";
      if (method === "POST" && waitingForClaim) awaitingStartUntil = Date.now() + 30000;
      else if (!waitingForClaim || Date.now() >= awaitingStartUntil) awaitingStartUntil = 0;
      onChange({ payload: data, error: null, loading: false, posting: awaitingStartUntil > Date.now(), fetchedAt: Date.now() });
      // A server lease/cooldown closes the previous attempt. When it opens again,
      // allow recovery; a failed POST followed by canRequest=true remains latched.
      const day = requestedDate ?? data.today;
      if (method === "GET" && !data.canRequest) autoRequested.delete(day);
      // An unavailable edition always needs an explicit request to search again,
      // including when today's cooldown expires or the page becomes visible.
      if (method === "GET" && !["ready", "unavailable"].includes(data.cartoon?.status) && data.enabled && data.canRequest &&
          validCartoonDate(day) && day <= data.today && (day === data.today || pending(data.cartoon)) &&
          !document.hidden && !autoRequested.has(day)) {
        autoRequested.add(day);
        startAutomatically = true;
      }
    } catch (error) {
      if (live) {
        // A lost/invalid response can hide an accepted POST before after() claims it.
        // Keep observing the old row briefly; an explicit client rejection needs no wait.
        if (mayHaveStarted) awaitingStartUntil = Date.now() + 30000;
        stopPolling = method === "GET" && !transientReadError;
        if (stopPolling) awaitingStartUntil = 0;
        onChange(previous => ({ ...previous, loading: false, posting: awaitingStartUntil > Date.now(), error: error.name === "AbortError" ? "불러오는 데 시간이 걸리고 있어요. 잠시 후 다시 확인해 주세요." : error.message }));
        // A lost POST response may still have created the shared job. Read before offering another start.
        checkAfterPost = method === "POST";
        // Expired wakeups still need a successful read; transient failures must
        // not leave cooldowns or an uncertain start stuck on the previous row.
        retryRead = method === "GET" && transientReadError && Boolean(awaitingStartUntil ||
          (current?.cartoon ? current.cartoon.retryAt : current?.availableAt));
      }
    } finally {
      clearTimeout(timeout);
      busy = false;
      if (live) {
        if (startAutomatically) void request("POST");
        else if (checkAfterPost && !document.hidden) timer = setTimeout(() => request("GET"), 1000);
        else schedule(retryRead, stopPolling);
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
