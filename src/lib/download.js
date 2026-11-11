"use client";

// Saves the day's picture as-is: the drawn image, or the example illustration (components/Art.jsx).

function save(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before freeing the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Downloads an image URL (signed Storage URL or a /scenes file) under the given file name. */
export async function downloadImage(url, filename) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  save(await res.blob(), filename);
}
