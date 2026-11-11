/**
 * Runs fn once per key at a time: a call made while the same key is still pending gets that
 * request's promise instead of starting another. Used so the song requested right after closing a
 * day and a "노래 추천받기" tap that lands before it returns don't both pick (and pay for) a song.
 */
export function shareInflight(pending, key, fn) {
  const running = pending.get(key);
  if (running) return running;
  const p = fn().finally(() => pending.delete(key));
  pending.set(key, p);
  return p;
}
