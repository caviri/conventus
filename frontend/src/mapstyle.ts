// The per-user base-map style override for map boards. Kept in its own tiny
// module so Settings can reference it without pulling the (lazy-loaded)
// MapLibre chunk into the main bundle.
export const MAP_STYLE_KEY = "conventus.mapstyle";

export function getMapStyleOverride(): string {
  return localStorage.getItem(MAP_STYLE_KEY) || "";
}

export function saveMapStyleOverride(url: string) {
  const v = url.trim();
  if (v) localStorage.setItem(MAP_STYLE_KEY, v);
  else localStorage.removeItem(MAP_STYLE_KEY);
}
