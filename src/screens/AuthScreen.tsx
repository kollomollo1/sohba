import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Users } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { BrandTitle } from '@/components/BrandTitle';

export function AuthScreen() {
  const { signIn, signUp, guestError, session } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const requestedMode = (location.state as { mode?: 'login' | 'register' } | null)?.mode;
  const [mode, setMode] = useState<'login' | 'register'>(requestedMode ?? 'login');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res =
      mode === 'login'
        ? await signIn(email.trim(), password)
        : await signUp(email.trim(), password, fullName);
    setLoading(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    navigate('/');
  }

  function switchMode(next: 'login' | 'register') {
    setMode(next);
    setError(null);
  }

  return (
    <div className="app-shell px-6 pt-12 pb-10">
      <div className="flex flex-1 flex-col">
        {/* Brand */}
        <div className="mb-10 flex flex-col items-center text-center slide-up">
          <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-primary shadow-fab">
            <Users className="h-10 w-10 text-white" strokeWidth={2.2} />
          </div>
          <BrandTitle size="lg" />
          <p className="mt-2 text-sm text-ink-soft">
            {mode === 'login' ? 'مرحباً بعودتك إلى أصدقائك' : 'انضم إلى صُحبتك الآن'}
          </p>
        </div>

        {/* Tabs */}
        <div className="mb-6 grid grid-cols-2 gap-1 rounded-full bg-surface-subtle p-1">
          <button
            type="button"
            onClick={() => switchMode('login')}
            className={`rounded-full py-2.5 text-sm font-semibold transition-all ${
              mode === 'login' ? 'bg-surface-raised text-primary shadow-card' : 'text-ink-soft'
            }`}
          >
            تسجيل الدخول
          </button>
          <button
            type="button"
            onClick={() => switchMode('register')}
            className={`rounded-full py-2.5 text-sm font-semibold transition-all ${
              mode === 'register' ? 'bg-surface-raised text-primary shadow-card' : 'text-ink-soft'
            }`}
          >
            حساب جديد
          </button>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4 slide-up">
          {guestError && !session && (
            <p className="rounded-xl bg-error-50 px-4 py-2.5 text-sm font-medium text-error">
              {guestError}
            </p>
          )}
          {mode === 'register' && (
            <>
              <div className="relative">
                <input
                  className="input-field pr-4"
                  placeholder="الاسم الكامل"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  autoComplete="name"
                />
              </div>
            </>
          )}

          <div className="relative">
            <input
              className="input-field pr-4"
              type="email"
              placeholder="البريد الإلكتروني"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              dir="ltr"
            />
          </div>

          <div className="relative">
            <input
              className="input-field pr-12"
              type={showPw ? 'text' : 'password'}
              placeholder="كلمة المرور"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              dir="ltr"
            />
            <button
              type="button"
              onClick={() => setShowPw((s) => !s)}
              className="absolute inset-y-0 left-3 my-auto flex h-8 w-8 items-center justify-center text-ink-muted hover:text-primary"
              aria-label={showPw ? 'إخفاء' : 'إظهار'}
            >
              {showPw ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
          </div>

          {error && (
            <p className="rounded-xl bg-error-50 px-4 py-2.5 text-sm font-medium text-error animate-pop">
              {error}
            </p>
          )}

          <button type="submit" disabled={loading} className="btn-primary mt-2 w-full py-3.5">
            {loading
              ? 'جارٍ...'
              : mode === 'login'
                ? 'دخول'
                : 'إنشاء الحساب'}
          </button>
        </form>

        <div className="mt-auto pt-10 text-center">
          <p className="text-xs text-ink-muted">
            {mode === 'login' ? 'ليس لديك حساب بعد؟ ' : 'لديك حساب بالفعل؟ '}
            <button
              onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
              className="font-semibold text-primary hover:underline"
              type="button"
            >
              {mode === 'login' ? 'أنشئ حساباً' : 'سجّل الدخول'}
            </button>
          </p>
          <p className="mt-4 text-[11px] text-ink-faint">
            شروط الاستخدام · سياسة الخصوصية · ميثاق المجتمع
          </p>
        </div>
      </div>
    </div>
  );
}
