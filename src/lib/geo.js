// Coarse location for the fragment's weather (specs/haru-weather.spl). The browser asks once; refusing
// or any failure just means no weather. Coordinates leave the browser rounded to 2 decimals (~1 km),
// only to look up the weather; the server never stores them.

export const roundCoord = (v) => Math.round(v * 100) / 100;

const TIMEOUT_MS = 3000;
const MAX_AGE_MS = 10 * 60 * 1000; // a position from the last 10 minutes is good enough for weather

export function getCoarseCoords() {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    const done = setTimeout(() => resolve(null), TIMEOUT_MS + 500); // some browsers never call back
    navigator.geolocation.getCurrentPosition(
      (p) => {
        clearTimeout(done);
        resolve({ lat: roundCoord(p.coords.latitude), lon: roundCoord(p.coords.longitude) });
      },
      () => {
        clearTimeout(done);
        resolve(null); // refused or unavailable: save without weather, no alert
      },
      { enableHighAccuracy: false, timeout: TIMEOUT_MS, maximumAge: MAX_AGE_MS },
    );
  });
}

/**
 * Runs fn after the pending save of the same fragment (if any) settles, so an edit or delete made
 * while the add is still waiting for the location can't reach the server before the add.
 */
export function afterPending(pending, id, fn) {
  const before = pending.get(id);
  return before ? before.then(fn, fn) : fn();
}
