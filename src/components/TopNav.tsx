import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Users, Plus, User, MessageCircle } from 'lucide-react';

type Props = {
  pendingRequests: number;
  unreadMessages: number;
};

export function TopNav({ pendingRequests, unreadMessages }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const itemClass = (active: boolean) =>
    `flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-surface-subtle ${active ? 'text-primary' : 'text-ink-muted'}`;

  return (
    <nav className="flex shrink-0 items-center gap-0.5" aria-label="التنقل الرئيسي">
        <NavLink to="/friends" aria-label="الأصدقاء" title="الأصدقاء" className={({ isActive }) => itemClass(isActive)}>
          {({ isActive }) => (
            <span className="relative">
              <Users className="h-[18px] w-[18px]" strokeWidth={isActive ? 2.3 : 1.8} />
              {pendingRequests > 0 && <span className="badge-dot">{pendingRequests}</span>}
            </span>
          )}
        </NavLink>

        <button
          onClick={() => navigate('/create')}
          className={itemClass(location.pathname === '/create')}
          aria-label="إضافة منشور"
          title="إضافة منشور"
        >
          <Plus className="h-[18px] w-[18px]" strokeWidth={2.5} />
        </button>

        <NavLink to="/profile" end aria-label="حسابي" title="حسابي" className={({ isActive }) => itemClass(isActive)}>
          {({ isActive }) => <User className="h-[18px] w-[18px]" strokeWidth={isActive ? 2.3 : 1.8} />}
        </NavLink>

        <NavLink
          to="/messages"
          aria-label="الرسائل"
          title="الرسائل"
          className={({ isActive }) => `${itemClass(isActive)} ${unreadMessages > 0 ? 'text-urgent' : ''}`}
        >
          {({ isActive }) => (
            <>
              <span className="relative">
                <MessageCircle className="h-[18px] w-[18px]" strokeWidth={isActive ? 2.3 : 1.8} />
                {unreadMessages > 0 && <span className="absolute -right-1 -top-0.5 h-2 w-2 rounded-full border border-surface-raised bg-urgent" />}
              </span>
            </>
          )}
        </NavLink>
    </nav>
  );
}
