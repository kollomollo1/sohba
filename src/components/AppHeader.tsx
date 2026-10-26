import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Bell, Home, Search, Settings } from 'lucide-react';
import { TopNav } from '@/components/TopNav';
import { BrandTitle } from '@/components/BrandTitle';

type Props = {
  pendingRequests: number;
  unreadMessages: number;
  unreadNotifications: number;
  unreadAdminAlerts: number;
};

export function AppHeader({ pendingRequests, unreadMessages, unreadNotifications, unreadAdminAlerts }: Props) {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <header className="sticky top-0 z-40 mx-auto flex h-12 w-full max-w-[480px] items-center border-b border-surface-dim bg-surface-raised/95 px-2 backdrop-blur-md">
      <div className="flex shrink-0 items-center px-1">
        <BrandTitle size="sm" />
      </div>

      <div className="mr-auto flex min-w-0 items-center gap-0">
        <NavLink
          to="/"
          end
          aria-label="الرئيسية"
          title="الرئيسية"
          onClick={(event) => {
            if (location.pathname === '/') {
              event.preventDefault();
              window.dispatchEvent(new Event('home-feed-refresh-requested'));
            }
          }}
          className={({ isActive }) =>
            `flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-surface-subtle ${
              isActive ? 'text-primary' : 'text-ink-muted'
            }`
          }
        >
          {({ isActive }) => <Home className="h-[18px] w-[18px]" strokeWidth={isActive ? 2.3 : 1.8} />}
        </NavLink>
        <button onClick={() => navigate('/search')} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-soft hover:bg-surface-subtle" aria-label="بحث" title="بحث">
          <Search className="h-[18px] w-[18px]" />
        </button>
        <TopNav pendingRequests={pendingRequests} unreadMessages={unreadMessages} />
        <button onClick={() => navigate('/settings')} className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-soft hover:bg-surface-subtle" aria-label="الإعدادات" title="الإعدادات">
          <Settings className="h-[18px] w-[18px]" />
          {unreadAdminAlerts > 0 && <span className="badge-dot">{unreadAdminAlerts}</span>}
        </button>
        <button onClick={() => navigate('/notifications')} className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-soft hover:bg-surface-subtle" aria-label={`الإشعارات، ${unreadNotifications} إشعارات جديدة`} title="الإشعارات">
          <Bell className="h-[18px] w-[18px]" />
          {unreadNotifications > 0 && <span className="badge-dot">{unreadNotifications}</span>}
        </button>
      </div>
    </header>
  );
}
