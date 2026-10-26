import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, UserPlus, Check, X, MessageCircle, Loader2, Users } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Avatar } from '@/components/Avatar';
import { mutualLabel } from '@/lib/format';
import type { FriendRequest, Friend, Person } from '@/types';

type Tab = 'requests' | 'friends' | 'suggestions';

export function FriendsScreen() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('requests');
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [suggestions, setSuggestions] = useState<Person[]>([]);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [req, fr, sug] = await Promise.all([
      supabase.rpc('my_friend_requests'),
      supabase.rpc('my_friends'),
      supabase.rpc('search_people', { p_query: '', p_limit: 12 }),
    ]);
    setRequests((req.data ?? []) as FriendRequest[]);
    setFriends((fr.data ?? []) as Friend[]);
    setSuggestions((sug.data ?? []) as Person[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Debounced search
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc('search_people', { p_query: q, p_limit: 20 });
      setSearchResults((data ?? []) as Person[]);
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  async function respond(requestId: string, accept: boolean) {
    setBusyId(requestId);
    await supabase.rpc('respond_to_request', { p_request_id: requestId, p_accept: accept });
    setBusyId(null);
    setRequests((prev) => prev.filter((r) => r.request_id !== requestId));
    if (accept) void loadAll();
  }

  async function addFriend(personId: string) {
    setBusyId(personId);
    await supabase.rpc('request_friend', { p_target: personId });
    setBusyId(null);
    // update relation in whichever list
    const patch = (p: Person) => (p.id === personId ? { ...p, relation: 'requested' as const } : p);
    setSuggestions((prev) => prev.map(patch));
    setSearchResults((prev) => prev.map(patch));
  }

  async function removeFriend(personId: string) {
    setBusyId(personId);
    await supabase.rpc('cancel_friend', { p_target: personId });
    setBusyId(null);
    setFriends((prev) => prev.filter((f) => f.user_id !== personId));
  }

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'requests', label: 'الطلبات', count: requests.length },
    { key: 'friends', label: 'الأصدقاء', count: friends.length },
    { key: 'suggestions', label: 'اقتراحات' },
  ];

  const searching = query.trim().length >= 2;

  return (
    <div className="app-shell">
      <header className="sticky top-0 z-20 border-b border-surface-dim bg-surface-raised/95 backdrop-blur-md">
        <div className="px-4 py-3">
          <h1 className="text-lg font-extrabold text-primary">الأصدقاء</h1>
          {/* Search */}
          <div className="relative mt-3">
            <Search className="absolute inset-y-0 right-3 my-auto h-5 w-5 text-ink-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ابحث عن أشخاص بالاسم أو اسم المستخدم..."
              className="input-field pr-11"
            />
          </div>
        </div>
      </header>

      <main className="app-body">
        {/* Tabs */}
        {!searching && (
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar px-3 pt-3">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`chip ${tab === t.key ? 'chip-active' : 'chip-inactive'}`}
              >
                {t.label}
                {t.count !== undefined && t.count > 0 && (
                  <span
                    className={`rounded-full px-1.5 text-[10px] ${
                      tab === t.key ? 'bg-white/25' : 'bg-primary-100 text-primary'
                    }`}
                  >
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="space-y-3 p-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="skeleton h-12 w-12 rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="skeleton h-3 w-32" />
                  <div className="skeleton h-2 w-24" />
                </div>
              </div>
            ))}
          </div>
        ) : searching ? (
          <SearchResults results={searchResults} onAdd={addFriend} busyId={busyId} onOpen={(id) => navigate(`/profile/${id}`)} />
        ) : tab === 'requests' ? (
          <RequestsList requests={requests} onRespond={respond} busyId={busyId} onOpen={(id) => navigate(`/profile/${id}`)} />
        ) : tab === 'friends' ? (
          <FriendsList friends={friends} onRemove={removeFriend} busyId={busyId} onOpen={(id) => navigate(`/profile/${id}`)} onMessage={(id) => navigate(`/messages/${id}`)} />
        ) : (
          <SuggestionsList people={suggestions} onAdd={addFriend} busyId={busyId} onOpen={(id) => navigate(`/profile/${id}`)} />
        )}
      </main>
    </div>
  );
}

function PersonRow({
  name,
  username,
  avatar,
  mutual,
  onOpen,
  action,
}: {
  name: string;
  username: string;
  avatar: string | null;
  mutual: { count: number; firstName?: string | null };
  onOpen: () => void;
  action: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <button onClick={onOpen}>
        <Avatar name={name} src={avatar} size={52} />
      </button>
      <div className="min-w-0 flex-1">
        <button onClick={onOpen} className="block truncate font-bold text-ink hover:text-primary">
          {name}
        </button>
        <p className="truncate text-xs text-ink-muted">@{username}</p>
        {mutual.count > 0 && (
          <p className="mt-0.5 text-[11px] font-medium text-primary">
            {mutualLabel(mutual.count, mutual.firstName)}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

function RequestsList({
  requests,
  onRespond,
  busyId,
  onOpen,
}: {
  requests: FriendRequest[];
  onRespond: (id: string, accept: boolean) => void;
  busyId: string | null;
  onOpen: (id: string) => void;
}) {
  if (requests.length === 0)
    return (
      <EmptyState
        icon={<UserPlus className="h-8 w-8 text-primary" />}
        title="لا توجد طلبات صداقة"
        subtitle="عندما يرسل لك أحدهم طلباً سيظهر هنا."
      />
    );
  return (
    <div className="divide-y divide-surface-dim">
      {requests.map((r) => (
        <PersonRow
          key={r.request_id}
          name={r.full_name}
          username={r.username}
          avatar={r.avatar_url}
          mutual={{ count: r.mutual_count }}
          onOpen={() => onOpen(r.user_id)}
          action={
            <div className="flex items-center gap-2">
              <button
                onClick={() => onRespond(r.request_id, true)}
                disabled={busyId === r.request_id}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-white shadow-fab transition active:scale-90 disabled:opacity-50"
                aria-label="قبول"
              >
                <Check className="h-5 w-5" />
              </button>
              <button
                onClick={() => onRespond(r.request_id, false)}
                disabled={busyId === r.request_id}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-subtle text-ink-soft transition active:scale-90 disabled:opacity-50"
                aria-label="رفض"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          }
        />
      ))}
    </div>
  );
}

function FriendsList({
  friends,
  onRemove,
  busyId,
  onOpen,
  onMessage,
}: {
  friends: Friend[];
  onRemove: (id: string) => void;
  busyId: string | null;
  onOpen: (id: string) => void;
  onMessage: (id: string) => void;
}) {
  if (friends.length === 0)
    return (
      <EmptyState
        icon={<Users className="h-8 w-8 text-primary" />}
        title="لا يوجد أصدقاء بعد"
        subtitle="ابحث عن أشخاص أو أضف اقتراحات لنبدأ صُحبتك."
      />
    );
  return (
    <div className="divide-y divide-surface-dim">
      {friends.map((f) => (
        <PersonRow
          key={f.user_id}
          name={f.full_name}
          username={f.username}
          avatar={f.avatar_url}
          mutual={{ count: 0 }}
          onOpen={() => onOpen(f.user_id)}
          action={
            <div className="flex items-center gap-2">
              <button
                onClick={() => onMessage(f.user_id)}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-primary transition active:scale-90"
                aria-label="رسالة"
              >
                <MessageCircle className="h-5 w-5" />
              </button>
              <button
                onClick={() => onRemove(f.user_id)}
                disabled={busyId === f.user_id}
                className="rounded-full px-3 py-2 text-xs font-medium text-ink-muted hover:bg-surface-subtle disabled:opacity-50"
              >
                إلغاء
              </button>
            </div>
          }
        />
      ))}
    </div>
  );
}

function SuggestionsList({
  people,
  onAdd,
  busyId,
  onOpen,
}: {
  people: Person[];
  onAdd: (id: string) => void;
  busyId: string | null;
  onOpen: (id: string) => void;
}) {
  const addable = people.filter((p) => p.relation === 'none');
  if (addable.length === 0)
    return (
      <EmptyState
        icon={<Users className="h-8 w-8 text-primary" />}
        title="لا توجد اقتراحات الآن"
        subtitle="عندما يصبح لأصدقائك أصدقاء مشتركون سيظهر هنا."
      />
    );
  return (
    <div className="divide-y divide-surface-dim">
      {addable.map((p) => (
        <PersonRow
          key={p.id}
          name={p.full_name}
          username={p.username}
          avatar={p.avatar_url}
          mutual={{ count: p.mutual_count }}
          onOpen={() => onOpen(p.id)}
          action={
            <button
              onClick={() => onAdd(p.id)}
              disabled={busyId === p.id}
              className="btn-secondary px-4 py-2 text-xs disabled:opacity-50"
            >
              {p.relation === 'requested' ? 'طلبت' : 'إضافة'}
            </button>
          }
        />
      ))}
    </div>
  );
}

function SearchResults({
  results,
  onAdd,
  busyId,
  onOpen,
}: {
  results: Person[];
  onAdd: (id: string) => void;
  busyId: string | null;
  onOpen: (id: string) => void;
}) {
  if (results.length === 0)
    return (
      <EmptyState
        icon={<Search className="h-8 w-8 text-primary" />}
        title="لا توجد نتائج"
        subtitle="جرّب اسماً أو اسم مستخدم آخر."
      />
    );
  return (
    <div className="divide-y divide-surface-dim">
      {results.map((p) => (
        <PersonRow
          key={p.id}
          name={p.full_name}
          username={p.username}
          avatar={p.avatar_url}
          mutual={{ count: p.mutual_count }}
          onOpen={() => onOpen(p.id)}
          action={
            p.relation === 'friend' ? (
              <span className="chip chip-inactive">صديق</span>
            ) : p.relation === 'requested' ? (
              <span className="chip chip-inactive">طلبت</span>
            ) : p.relation === 'incoming' ? (
              <span className="chip chip-active">طلب وارد</span>
            ) : (
              <button
                onClick={() => onAdd(p.id)}
                disabled={busyId === p.id}
                className="btn-secondary px-4 py-2 text-xs disabled:opacity-50"
              >
                {busyId === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'إضافة'}
              </button>
            )
          }
        />
      ))}
    </div>
  );
}

function EmptyState({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent-soft">{icon}</div>
      <div>
        <p className="font-bold text-ink">{title}</p>
        <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>
      </div>
    </div>
  );
}
