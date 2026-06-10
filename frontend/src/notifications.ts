// Browser notifications + a title-bar badge for unread @mentions.
const BASE_TITLE = "Conventus";
let unread = 0;

export function notificationsEnabled(): boolean {
  return "Notification" in window && Notification.permission === "granted";
}

export async function requestNotifications(): Promise<NotificationPermission> {
  if (!("Notification" in window)) return "denied";
  if (Notification.permission === "granted") return "granted";
  return Notification.requestPermission();
}

export function notifyMention(author: string, where: string, body: string) {
  bumpTitle();
  if (notificationsEnabled() && document.hidden) {
    const n = new Notification(`${author} mentioned you in ${where}`, {
      body,
      tag: "conventus-mention",
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  }
}

function bumpTitle() {
  unread += 1;
  document.title = `(${unread}) ${BASE_TITLE}`;
}

export function clearBadge() {
  unread = 0;
  document.title = BASE_TITLE;
}

// Reset the badge whenever the user comes back to the tab.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) clearBadge();
  });
}
