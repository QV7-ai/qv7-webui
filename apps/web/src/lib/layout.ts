export const PHONE_QUERY = "(max-width: 767px)";

export function isPhoneViewport() {
  return typeof window !== "undefined" && window.matchMedia(PHONE_QUERY).matches;
}
