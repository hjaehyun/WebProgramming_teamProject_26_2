// A selected picture can be taken down even if a redraw is pending or failed.
export function canChooseExhibitionArtwork(artwork, selectedDates) {
  return artwork.status === "ready" || selectedDates.includes(artwork.date);
}

export function nextExhibitionDates(selectedDates, artworks, toggledDate) {
  const next = selectedDates.includes(toggledDate)
    ? selectedDates.filter(date => date !== toggledDate)
    : [...selectedDates, toggledDate];
  // The API accepts a complete list of ready pictures. Remove every unavailable
  // selection together so another failed redraw cannot prevent this removal.
  return next.filter(date => artworks[date]?.status === "ready");
}
