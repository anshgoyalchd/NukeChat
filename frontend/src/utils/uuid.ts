/**
 * Safe UUID Generator
 * 
 * Standard crypto.randomUUID() is restricted to Secure Contexts (HTTPS and localhost).
 * When accessed via local LAN IP (e.g. http://192.168.x.x:8787), crypto.randomUUID is undefined.
 * This helper falls back seamlessly to Math.random() based RFC4122 v4 UUID so the app never crashes.
 */
export function safeRandomUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
