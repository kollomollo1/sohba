// Arabic-friendly relative time + friendship context labels.

export function timeAgo(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = Math.max(0, now - then);
  const sec = Math.floor(diff / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);

  if (sec < 60) return 'الآن';
  if (min < 60) return `قبل ${min} دقيقة`;
  if (hr < 24) return `قبل ${hr} ساعة`;
  if (day < 7) return `قبل ${day} يوم`;
  const week = Math.floor(day / 7);
  if (week < 4) return `قبل ${week} أسبوع`;
  const month = Math.floor(day / 30);
  if (month < 12) return `قبل ${month} شهر`;
  const year = Math.floor(day / 365);
  return `قبل ${year} سنة`;
}

export type FriendCtx = {
  kind: 'self' | 'friend' | 'friend_of_friend' | 'community';
  mutualName: string | null;
};

export function friendContextLabel(ctx: FriendCtx): string | null {
  switch (ctx.kind) {
    case 'self':
      return null;
    case 'friend':
      return 'صديق';
    case 'friend_of_friend':
      return ctx.mutualName
        ? `صديق صديقك · ${ctx.mutualName}`
        : 'صديق صديقك';
    case 'community':
      return 'من المجتمع';
  }
}

// "صديق مشترك: أحمد محمد" — used on friend suggestions / requests.
export function mutualLabel(count: number, firstName?: string | null): string | null {
  if (count <= 0) return null;
  if (firstName) {
    return count === 1
      ? `صديق مشترك: ${firstName}`
      : `صديق مشترك: ${firstName} و${count - 1} آخر`;
  }
  return `${count} صديق مشترك`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '؟';
  if (parts.length === 1) return parts[0].slice(0, 2);
  return parts[0][0] + parts[1][0];
}

export function avatarColor(seed: string): string {
  const colors = ['#1877f2', '#0866ff', '#2d88ff', '#4595ff', '#166fe5', '#3b82df'];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return colors[h % colors.length];
}
