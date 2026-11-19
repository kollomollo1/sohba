import React from 'react';

type Props = {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
};

export function BrandTitle({ size = 'sm', className = '' }: Props) {
  const sizeClasses =
    size === 'lg'
      ? 'text-2xl sm:text-3xl'
      : size === 'md'
        ? 'text-lg sm:text-xl'
        : 'text-sm sm:text-base';

  return (
    <span className={`inline-flex items-center font-extrabold leading-none whitespace-nowrap select-none ${sizeClasses} ${className}`}>
      <span className="text-primary font-noto">صُحبة</span>
    </span>
  );
}
