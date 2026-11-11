// Mock songs (backend MUSIC_PROVIDER=mock) have fake ids starting with "MOCK_".
// The UI shows them as text instead of a YouTube player.
// Same rule as the backend's src/server/music/mock.ts; keep the prefix in sync.

export const isMockVideo = (videoId) => videoId.startsWith("MOCK_");
