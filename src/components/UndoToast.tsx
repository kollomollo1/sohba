import { useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';

type UndoAction = {
  message: string;
  onUndo: () => Promise<void>;
  onTimeout?: () => Promise<void>;
};

export function showUndo(message: string, onUndo: () => Promise<void>, onTimeout?: () => Promise<void>) {
  window.dispatchEvent(new CustomEvent<UndoAction>('sohba:undo', {
    detail: { message, onUndo, onTimeout },
  }));
}

export function UndoToast() {
  const [action, setAction] = useState<UndoAction | null>(null);
  const actionRef = useRef<UndoAction | null>(null);
  const timerRef = useRef<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onUndoEvent = (event: Event) => {
      const next = (event as CustomEvent<UndoAction>).detail;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      if (actionRef.current?.onTimeout) void actionRef.current.onTimeout();
      actionRef.current = next;
      setAction(next);
      timerRef.current = window.setTimeout(() => {
        const expired = actionRef.current;
        actionRef.current = null;
        setAction(null);
        if (expired?.onTimeout) void expired.onTimeout();
      }, 7000);
    };
    window.addEventListener('sohba:undo', onUndoEvent);
    return () => {
      window.removeEventListener('sohba:undo', onUndoEvent);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  async function undo() {
    const current = actionRef.current;
    if (!current || busy) return;
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    actionRef.current = null;
    setAction(null);
    setBusy(true);
    try {
      await current.onUndo();
    } finally {
      setBusy(false);
    }
  }

  if (!action) return null;
  return (
    <div className="fixed bottom-24 left-1/2 z-[60] flex w-[calc(100%-24px)] max-w-[456px] -translate-x-1/2 items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-white shadow-card-raised">
      <p className="flex-1 text-sm font-medium">{action.message}</p>
      <button onClick={() => void undo()} disabled={busy} className="inline-flex shrink-0 items-center gap-1.5 text-sm font-bold text-primary-200 disabled:opacity-60">
        <RotateCcw className="h-4 w-4" />
        تراجع
      </button>
    </div>
  );
}
