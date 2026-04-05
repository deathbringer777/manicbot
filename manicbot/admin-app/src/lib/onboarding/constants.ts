export const TOUR_VERSION = "v1";

export function tourStorageKey(role: string): string {
  return `manicbot_tour_${TOUR_VERSION}_${role}`;
}

/** `window.dispatchEvent(new CustomEvent(TOUR_REPLAY_EVENT))` */
export const TOUR_REPLAY_EVENT = "manicbot-tour-replay";
