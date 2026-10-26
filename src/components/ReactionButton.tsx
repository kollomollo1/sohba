import { useEffect, useRef, useState } from 'react';
import { Heart } from 'lucide-react';
import type { LikeReaction } from '@/types';

const reactions: Array<{ value: LikeReaction; emoji: string; label: string }> = [
  { value: 'like', emoji: '❤️', label: 'إعجاب' },
  { value: 'laugh', emoji: '😂', label: 'ضحك' },
  { value: 'angry', emoji: '😡', label: 'غضب' },
  { value: 'surprised', emoji: '😮', label: 'استعجاب' },
];

type Props = {
  reaction: LikeReaction | null;
  count: number;
  disabled?: boolean;
  onToggle: () => void;
  onSelect: (reaction: LikeReaction) => void;
  className?: string;
  iconClassName?: string;
  labelClassName?: string;
  animate?: boolean;
};

export function ReactionButton({
  reaction, count, disabled = false, onToggle, onSelect, className = '',
  iconClassName = '', labelClassName = '', animate = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);

  function clearHold() {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  }

  useEffect(() => {
    if (!open) return;
    const onOutside = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onOutside);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('pointerdown', onOutside);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  function handlePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (disabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
    held.current = false;
    clearHold();
    holdTimer.current = setTimeout(() => {
      held.current = true;
      setOpen(true);
    }, 450);
  }

  function handleClick() {
    if (held.current) {
      held.current = false;
      return;
    }
    onToggle();
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onPointerDown={handlePointerDown}
        onPointerUp={clearHold}
        onPointerCancel={clearHold}
        onPointerLeave={clearHold}
        onContextMenu={(event) => { event.preventDefault(); clearHold(); held.current = true; setOpen(true); }}
        onClick={handleClick}
        disabled={disabled}
        title="اضغط مطولًا لاختيار تفاعل"
        aria-label={reaction ? reactions.find((item) => item.value === reaction)?.label : 'إعجاب'}
        aria-haspopup="menu"
        aria-expanded={open}
        className={className}
      >
        {reaction
          ? <span className={`inline-flex h-5 w-5 items-center justify-center text-lg leading-none ${animate ? 'animate-like-pop' : ''} ${iconClassName}`}>{reactions.find((item) => item.value === reaction)?.emoji}</span>
          : <Heart className={`h-5 w-5 ${animate ? 'animate-like-pop' : ''} ${iconClassName}`} strokeWidth={2} />}
        <span className={labelClassName}>{count > 0 ? count : 'إعجاب'}</span>
      </button>
      {open && (
        <div role="menu" aria-label="اختيار تفاعل" className="absolute bottom-full left-0 z-40 mb-2 flex items-center gap-1 rounded-full border border-surface-dim bg-surface-raised px-2 py-1.5 shadow-card">
          {reactions.map((item) => (
            <button
              key={item.value}
              type="button"
              role="menuitem"
              title={item.label}
              aria-label={item.label}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => { onSelect(item.value); setOpen(false); held.current = false; }}
              className={`flex h-9 w-9 items-center justify-center rounded-full text-2xl transition hover:scale-125 hover:bg-surface-subtle ${reaction === item.value ? 'bg-primary-50' : ''}`}
            >
              {item.emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
