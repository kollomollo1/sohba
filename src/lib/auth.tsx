import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types';

function isReservedAdminName(value: string) {
  const normalized = value.trim().toLocaleLowerCase('ar-EG')
    .normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  const reservedEnglish = /(^|\s)(admin(?:istrator)?|root|moderator|mod|staff|support)\d*(?=\s|$)/i;
  const reservedArabic = ['ادمن', 'مدير', 'مشرف', 'ادارة', 'مسؤول النظام'];
  return reservedEnglish.test(normalized) || reservedArabic.some((word) => normalized.includes(word));
}

type AuthState = {
  session: Session | null;
  profile: Profile | null;
  accessRestriction: { permanentlyBanned: boolean; bannedUntil: string | null } | null;
  loading: boolean;
  isGuest: boolean;
  guestError: string | null;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const Ctx = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [accessRestriction, setAccessRestriction] = useState<AuthState['accessRestriction']>(null);
  const [loading, setLoading] = useState(true);
  const [guestError, setGuestError] = useState<string | null>(null);

  async function loadProfile(uid: string): Promise<Profile | null> {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', uid)
      .maybeSingle();
    if (error) {
      console.error('loadProfile', error.message);
      return null;
    }
    const prof = data as Profile | null;
    setProfile(prof);
    return prof;
  }

  async function loadAccessRestriction() {
    const { data, error } = await supabase.rpc('my_account_access_status');
    if (error) {
      console.error('load account access status failed', error.message);
      setAccessRestriction(null);
      return;
    }
    const status = (data as Array<{ allowed: boolean; banned_until: string | null; permanently_banned: boolean }> | null)?.[0];
    setAccessRestriction(status && !status.allowed
      ? { permanentlyBanned: status.permanently_banned, bannedUntil: status.banned_until }
      : null);
  }

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      let activeSession = data.session;
      if (!activeSession) {
        const guestTag = String(Math.floor(Math.random() * 900) + 100);
        const { data: guestData, error } = await supabase.auth.signInAnonymously({
          options: { data: { full_name: `مؤقت ${guestTag}`, username: `guest_${guestTag}` } },
        });
        if (error) {
          console.error('anonymous sign-in failed', error.message);
          setGuestError(translateAuthError(error.message));
        } else {
          activeSession = guestData.session;
        }
      }
      if (!mounted) return;
      setSession(activeSession);
      if (activeSession?.user) {
        await loadProfile(activeSession.user.id);
        await loadAccessRestriction();
      }
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mounted) return;
      setSession(newSession);
      if (newSession?.user) {
        // The handle_new_user trigger may not have committed the profile row
        // at the moment the first auth event fires, so retry a few times.
        // Defer database work until after the synchronous auth callback returns;
        // awaiting Supabase requests inside this callback can deadlock its auth lock.
        setTimeout(() => {
          void (async () => {
            await loadAccessRestriction();
            for (let i = 0; i < 5; i++) {
              const prof = await loadProfile(newSession.user.id);
              if (prof || !mounted) break;
              await new Promise((r) => setTimeout(r, 250));
            }
          })();
        }, 0);
      } else {
        setProfile(null);
        setAccessRestriction(null);
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!session?.user.id) return;
    let active = true;
    const checkAccess = async () => {
      const { data, error } = await supabase.rpc('my_account_access_status');
      if (!active || error) return;
      const status = (data as Array<{ allowed: boolean; banned_until: string | null; permanently_banned: boolean }> | null)?.[0];
      setAccessRestriction(status && !status.allowed
        ? { permanentlyBanned: status.permanently_banned, bannedUntil: status.banned_until }
        : null);
    };
    const interval = window.setInterval(() => { void checkAccess(); }, 10000);
    return () => { active = false; window.clearInterval(interval); };
  }, [session?.user.id]);

  const value = useMemo<AuthState>(
    () => ({
      session,
      profile,
      accessRestriction,
      loading,
      // A linked identity means the anonymous account has been converted,
      // even if the current session's anonymous claim has not refreshed yet.
      isGuest: !!session?.user.is_anonymous && !(session.user.identities?.length),
      guestError,
      async signUp(email, password, fullName) {
        if (!fullName.trim()) return { error: 'اكتب اسمك الكامل.' };
        if (isReservedAdminName(fullName) && session?.user.app_metadata?.role !== 'admin') {
          return { error: 'هذا الاسم محجوز لإدارة التطبيق. اختر اسمًا آخر.' };
        }
        if (password.length < 6) return { error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل.' };

        const cleanUsername = `user_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
        const metadata = { full_name: fullName.trim(), username: cleanUsername };
        const convertingGuest = !!session?.user.is_anonymous && !(session.user.identities?.length);
        const { data, error } = convertingGuest
          ? await supabase.auth.updateUser({ email, password, data: metadata })
          : await supabase.auth.signUp({ email, password, options: { data: metadata } });
        if (error) return { error: translateAuthError(error.message) };
        if (data.user) {
          if (convertingGuest) {
            const { error: profileError } = await supabase
              .from('profiles')
              .update(metadata)
              .eq('id', data.user.id);
            if (profileError) return { error: translateAuthError(profileError.message) };

            const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
            if (refreshError) return { error: translateAuthError(refreshError.message) };
            if (refreshed.session) {
              setSession(refreshed.session);
              await loadProfile(refreshed.session.user.id);
            }
            if (refreshed.session?.user.is_anonymous || !refreshed.session?.user.identities?.length) {
              return { error: 'لم يكتمل تحويل حساب الضيف. فعّل Manual Linking وأوقف Confirm email في إعدادات Email داخل Supabase، ثم أعد المحاولة.' };
            }
            return { error: null };
          }
          for (let i = 0; i < 5; i++) {
            const prof = await loadProfile(data.user.id);
            if (prof) break;
            await new Promise((r) => setTimeout(r, 250));
          }
        }
        return { error: null };
      },
      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) return { error: translateAuthError(error.message) };
        return { error: null };
      },
      async signOut() {
        await supabase.auth.signOut();
        setProfile(null);
      },
      async refreshProfile() {
        if (session?.user) await loadProfile(session.user.id);
      },
    }),
    [session, profile, accessRestriction, loading, guestError],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

function translateAuthError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes('user_banned') || m.includes('banned'))
    return 'هذا الحساب موقوف عن الدخول.';
  if (m.includes('already registered') || m.includes('already been registered'))
    return 'هذا البريد مسجّل بالفعل. حاول تسجيل الدخول.';
  if (m.includes('invalid login') || m.includes('invalid credentials'))
    return 'البريد أو كلمة المرور غير صحيحة.';
  if (m.includes('rate limit')) return 'محاولات كثيرة. انتظر قليلاً ثم حاول مجدداً.';
  if (m.includes('anonymous') && (m.includes('disabled') || m.includes('not enabled')))
    return 'الدخول كضيف غير مفعّل في إعدادات Supabase بعد.';
  if (m.includes('duplicate key') || m.includes('unique constraint'))
    return 'اسم المستخدم مستخدم بالفعل. اختر اسمًا آخر.';
  if (m.includes('database error')) return 'قاعدة البيانات غير مجهزة بالكامل. يجب تطبيق ملفات migrations على مشروع Supabase.';
  if (m.includes('email')) return 'البريد الإلكتروني غير صالح.';
  return 'حدث خطأ غير متوقع. حاول مرة أخرى.';
}
