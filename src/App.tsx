import { useEffect, useState } from 'react';
import { BrowserRouter, HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/lib/auth';
import { AppHeader } from '@/components/AppHeader';
import { AuthScreen } from '@/screens/AuthScreen';
import { HomeFeedScreen } from '@/screens/HomeFeedScreen';
import { CreatePostScreen } from '@/screens/CreatePostScreen';
import { FriendsScreen } from '@/screens/FriendsScreen';
import { ProfileScreen } from '@/screens/ProfileScreen';
import { PostDetailScreen } from '@/screens/PostDetailScreen';
import { SettingsScreen } from '@/screens/SettingsScreen';
import { MessagesScreen } from '@/screens/MessagesScreen';
import { MessagesInboxScreen } from '@/screens/MessagesInboxScreen';
import { UndoToast } from '@/components/UndoToast';
import { NotificationsScreen } from '@/screens/NotificationsScreen';
import { AdminScreen } from '@/screens/AdminScreen';
import { PostReportsScreen } from '@/screens/PostReportsScreen';
import { ProfileReportsScreen } from '@/screens/ProfileReportsScreen';
import { BlockedUsersScreen } from '@/screens/BlockedUsersScreen';
import { supabase } from '@/lib/supabase';
import type { FriendRequest } from '@/types';
import { Loader2, ShieldAlert } from 'lucide-react';

// HashRouter works reliably in Bolt preview iframes and local static hosts.
const Router = HashRouter;
void BrowserRouter;

function Shell() {
  const { session, loading, guestError, accessRestriction, signOut } = useAuth();
  const [pendingCount, setPendingCount] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [unreadAdminAlerts, setUnreadAdminAlerts] = useState(0);
  const location = useLocation();

  // Hide bottom nav on full-screen routes
  const hideNav =
    location.pathname === '/create' ||
    location.pathname.startsWith('/post/') ||
    location.pathname === '/auth' ||
    location.pathname === '/settings' ||
    location.pathname === '/blocked';
  const fullScreenRoute = hideNav || location.pathname.startsWith('/messages/') || location.pathname.startsWith('/admin');

  useEffect(() => {
    if (!session) {
      setPendingCount(0);
      setUnreadMessages(0);
      return;
    }
    let active = true;
    void supabase
      .rpc('my_friend_requests')
      .then(({ data }) => {
        if (active) setPendingCount((data as FriendRequest[] | null)?.length ?? 0);
      });
    return () => { active = false; };
  }, [session, location.pathname]);

  useEffect(() => {
    if (!session?.user.id) {
      setUnreadMessages(0);
      return;
    }
    let active = true;
    const refreshUnread = async () => {
      const { count, error } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_id', session.user.id)
        .is('read_at', null);
      if (active) {
        if (error) {
          console.error('could not load unread message count', error.message);
          setUnreadMessages(0);
        } else {
          setUnreadMessages(count ?? 0);
        }
      }
    };
    void refreshUnread();
    const interval = window.setInterval(() => { void refreshUnread(); }, 5000);
    window.addEventListener('messages-read', refreshUnread);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('messages-read', refreshUnread);
    };
  }, [session?.user.id]);

  useEffect(() => {
    if (!session?.user.id || session.user.app_metadata?.role !== 'admin') {
      setUnreadAdminAlerts(0);
      return;
    }
    let active = true;
    const refreshAdminAlerts = async () => {
      const { count, error } = await supabase.from('admin_alerts')
        .select('id', { count: 'exact', head: true })
        .eq('admin_id', session.user.id).is('read_at', null);
      if (active) setUnreadAdminAlerts(error ? 0 : count ?? 0);
    };
    void refreshAdminAlerts();
    const interval = window.setInterval(() => { void refreshAdminAlerts(); }, 10000);
    return () => { active = false; window.clearInterval(interval); };
  }, [session?.user.id, session?.user.app_metadata?.role]);

  useEffect(() => {
    if (!session?.user.id) {
      setUnreadNotifications(0);
      return;
    }
    let active = true;
    const refreshNotifications = async () => {
      const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_id', session.user.id)
        .is('read_at', null);
      if (active) {
        if (error) {
          setUnreadNotifications(0);
        } else {
          setUnreadNotifications(count ?? 0);
        }
      }
    };
    void refreshNotifications();
    const interval = window.setInterval(() => { void refreshNotifications(); }, 5000);
    window.addEventListener('notifications-read', refreshNotifications);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('notifications-read', refreshNotifications);
    };
  }, [session?.user.id]);

  useEffect(() => {
    // Purge expired posts (> 24 hours) from Supabase on startup and every 5 minutes
    void supabase.rpc('delete_expired_posts');
    const cleanupInterval = window.setInterval(() => {
      void supabase.rpc('delete_expired_posts');
    }, 5 * 60 * 1000);

    // Publish due scheduled demo post on startup and every 60 seconds
    void supabase.rpc('publish_due_demo_post');
    const demoInterval = window.setInterval(() => {
      void supabase.rpc('publish_due_demo_post');
    }, 60 * 1000);

    return () => {
      window.clearInterval(cleanupInterval);
      window.clearInterval(demoInterval);
    };
  }, []);

  if (loading) {
    return (
      <div className="app-shell flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (accessRestriction) {
    return (
      <div className="app-shell flex flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="rounded-full bg-error-50 p-4 text-error"><ShieldAlert className="h-9 w-9" /></div>
        <h1 className="text-xl font-bold text-ink">تم إيقاف الوصول إلى الحساب</h1>
        <p className="text-sm leading-7 text-ink-muted">
          {accessRestriction.permanentlyBanned
            ? 'تم حظر هذا الحساب نهائياً.'
            : `تم إيقاف الحساب مؤقتاً حتى ${new Date(accessRestriction.bannedUntil ?? '').toLocaleString('ar-EG')}.`}
        </p>
        <button
          onClick={() => void signOut()}
          className="mt-2 rounded-xl bg-surface-subtle px-4 py-2 text-sm font-semibold text-ink hover:bg-surface-dim transition"
        >
          تسجيل الخروج
        </button>
      </div>
    );
  }

  if (!session) {
    if (guestError) return <AuthScreen />;
    return (
      <Routes>
        <Route path="*" element={<AuthScreen />} />
      </Routes>
    );
  }

  return (
    <>
      {!fullScreenRoute && <AppHeader pendingRequests={pendingCount} unreadMessages={unreadMessages} unreadNotifications={unreadNotifications} unreadAdminAlerts={unreadAdminAlerts} />}
      <Routes>
        <Route path="/" element={<HomeFeedScreen />} />
        <Route path="/create" element={<CreatePostScreen />} />
        <Route path="/friends" element={<FriendsScreen />} />
        <Route path="/profile" element={<ProfileScreen />} />
        <Route path="/profile/:userId" element={<ProfileScreen />} />
        <Route path="/post/:postId" element={<PostDetailScreen />} />
        <Route path="/settings" element={<SettingsScreen />} />
        <Route path="/blocked" element={<BlockedUsersScreen />} />
        <Route path="/auth" element={<AuthScreen />} />
        <Route path="/messages/:userId" element={<MessagesScreen />} />
        <Route path="/messages" element={<MessagesInboxScreen />} />
        <Route path="/notifications" element={<NotificationsScreen />} />
        <Route path="/admin" element={<AdminScreen />} />
        <Route path="/admin/post-reports" element={<PostReportsScreen />} />
        <Route path="/admin/profile-reports" element={<ProfileReportsScreen />} />
        <Route path="/search" element={<FriendsScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <UndoToast />
    </>
  );
}

export default function App() {
  return (
    <Router>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </Router>
  );
}
