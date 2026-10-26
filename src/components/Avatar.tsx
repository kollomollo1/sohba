import { initials, avatarColor } from '@/lib/format';

type Props = {
  name: string;
  src?: string | null;
  size?: number;
  className?: string;
  ring?: boolean;
};

export function Avatar({ name, src, size = 44, className = '', ring = false }: Props) {
  const dim = { width: size, height: size };
  const bg = avatarColor(name);
  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-full ${ring ? 'ring-2 ring-white' : ''} ${className}`}
      style={dim}
    >
      {src ? (
        <img src={src} alt={name} className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center font-semibold text-white"
          style={{ background: bg, fontSize: size * 0.36 }}
        >
          {initials(name)}
        </div>
      )}
    </div>
  );
}
