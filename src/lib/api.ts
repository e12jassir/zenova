export const API_BASE = (
  (import.meta.env.VITE_API_URL as string | undefined) ||
  (import.meta.env.VITE_API_BASE as string | undefined) ||
  ""
).replace(/\/+$/, "");

export function apiUrl(path: string): string {
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  const proto = window.location?.protocol ?? "";
  if (proto === "capacitor:" || proto === "file:") return true;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}
