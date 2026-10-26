import React from 'react';

type Props = {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
};

export function BrandTitle({ size = 'sm', className = '' }: Props) {
  const sizeClasses =
    size === 'lg'
      ? 'text-3xl sm:text-4xl'
      : size === 'md'
        ? 'text-2xl sm:text-3xl'
        : 'text-xl sm:text-2xl';

  return (
    <span className={`inline-flex items-center font-black leading-none whitespace-nowrap select-none text-primary font-noto tracking-tight ${sizeClasses} ${className}`}>
      صُحبة
    </span>
  );
}
