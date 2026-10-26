import React from 'react';

type Props = {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
};

export function BrandTitle({ size = 'sm', className = '' }: Props) {
  const sizeClasses =
    size === 'lg'
      ? 'text-2xl sm:text-3xl gap-2'
      : size === 'md'
        ? 'text-lg sm:text-xl gap-1.5'
        : 'text-sm sm:text-base gap-1.5';

  const gamesStrokeStyle: React.CSSProperties = {
    WebkitTextStroke: size === 'lg' ? '2.8px #334155' : '2px #334155',
    paintOrder: 'stroke fill',
  };

  const mixStrokeStyle: React.CSSProperties = {
    WebkitTextStroke: size === 'lg' ? '0.75px #64748b' : '0.5px #64748b',
    paintOrder: 'stroke fill',
  };

  return (
    <span className={`inline-flex items-center font-extrabold leading-none whitespace-nowrap select-none ${sizeClasses} ${className}`}>
      <span className="text-primary">مجتمع</span>
      <span dir="ltr" className="inline-flex items-center gap-1 font-black">
        <span
          className="text-white"
          style={gamesStrokeStyle}
        >
          Games
        </span>
        <span
          className="text-[#f97316]"
          style={mixStrokeStyle}
        >
          Mix
        </span>
      </span>
    </span>
  );
}
