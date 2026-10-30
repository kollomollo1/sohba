import React, { useEffect, useRef, useState } from 'react';
import { X, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { getOptimizedPostImageUrl } from '@/lib/cloudinary';

type Props = {
  imageUrl: string;
  alt?: string;
  onClose: () => void;
};

export function ImageZoomModal({ imageUrl, alt = 'صورة المنشور', onClose }: Props) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const lastTouchDistanceRef = useRef<number | null>(null);
  const lastTapTimeRef = useRef<number>(0);

  // Lock body scroll while modal is active
  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const zoomIn = () => {
    setScale((prev) => {
      const next = Math.min(4, +(prev + 0.5).toFixed(2));
      return next;
    });
  };

  const zoomOut = () => {
    setScale((prev) => {
      const next = Math.max(1, +(prev - 0.5).toFixed(2));
      if (next === 1) setPosition({ x: 0, y: 0 });
      return next;
    });
  };

  const resetZoom = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  // Wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.stopPropagation();
    const delta = e.deltaY < 0 ? 0.3 : -0.3;
    setScale((prev) => {
      const next = Math.min(Math.max(1, +(prev + delta).toFixed(2)), 4);
      if (next === 1) setPosition({ x: 0, y: 0 });
      return next;
    });
  };

  // Double click / double tap toggle
  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (scale > 1) {
      resetZoom();
    } else {
      setScale(2.5);
    }
  };

  // Mouse drag handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale <= 1) return;
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || scale <= 1) return;
    e.preventDefault();
    setPosition({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Touch handlers (drag + pinch-to-zoom + double tap)
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      lastTouchDistanceRef.current = dist;
    } else if (e.touches.length === 1) {
      const now = Date.now();
      if (now - lastTapTimeRef.current < 300) {
        // Double tap
        if (scale > 1) {
          resetZoom();
        } else {
          setScale(2.5);
        }
        lastTapTimeRef.current = 0;
        return;
      }
      lastTapTimeRef.current = now;

      if (scale > 1) {
        setIsDragging(true);
        dragStartRef.current = {
          x: e.touches[0].clientX - position.x,
          y: e.touches[0].clientY - position.y,
        };
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && lastTouchDistanceRef.current !== null) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const ratio = dist / lastTouchDistanceRef.current;
      setScale((prev) => {
        const next = Math.min(Math.max(1, +(prev * ratio).toFixed(2)), 4);
        if (next === 1) setPosition({ x: 0, y: 0 });
        return next;
      });
      lastTouchDistanceRef.current = dist;
    } else if (e.touches.length === 1 && isDragging && scale > 1) {
      setPosition({
        x: e.touches[0].clientX - dragStartRef.current.x,
        y: e.touches[0].clientY - dragStartRef.current.y,
      });
    }
  };

  const handleTouchEnd = () => {
    lastTouchDistanceRef.current = null;
    setIsDragging(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/95 backdrop-blur-md select-none touch-none animate-fade-in"
      onClick={() => {
        if (scale === 1) onClose();
      }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Top Floating Controls Bar */}
      <div
        className="absolute top-4 inset-x-4 z-[110] flex items-center justify-between pointer-events-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/30 transition shadow-lg backdrop-blur-md active:scale-95"
          aria-label="إغلاق"
          title="إغلاق (Esc)"
        >
          <X className="h-6 w-6" />
        </button>

        {/* Zoom Controls */}
        <div className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1.5 backdrop-blur-md shadow-lg border border-white/10 text-white">
          <button
            type="button"
            onClick={zoomOut}
            disabled={scale <= 1}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/20 transition disabled:opacity-30 disabled:hover:bg-transparent"
            title="تصغير (-)"
            aria-label="تصغير"
          >
            <ZoomOut className="h-4 w-4" />
          </button>

          <span className="min-w-[42px] text-center text-xs font-bold text-white/90">
            {Math.round(scale * 100)}%
          </span>

          <button
            type="button"
            onClick={zoomIn}
            disabled={scale >= 4}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/20 transition disabled:opacity-30 disabled:hover:bg-transparent"
            title="تكبير (+)"
            aria-label="تكبير"
          >
            <ZoomIn className="h-4 w-4" />
          </button>

          {scale > 1 && (
            <button
              type="button"
              onClick={resetZoom}
              className="mr-1 flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/20 transition text-amber-300"
              title="إعادة ضبط الحجم"
              aria-label="إعادة ضبط"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Main Image Container */}
      <div
        className={`relative flex items-center justify-center max-h-full max-w-full overflow-hidden ${
          scale > 1 ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-in'
        }`}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={getOptimizedPostImageUrl(imageUrl, { width: 2400 })}
          alt={alt}
          draggable={false}
          style={{
            transform: `translate3d(${position.x}px, ${position.y}px, 0) scale(${scale})`,
            transition: isDragging ? 'none' : 'transform 0.18s ease-out',
          }}
          className="max-h-[88vh] max-w-[94vw] object-contain rounded-xl shadow-2xl select-none pointer-events-auto"
        />
      </div>

      {/* Helper hint for mobile and desktop */}
      <div className="absolute bottom-4 inset-x-0 text-center pointer-events-none">
        <span className="rounded-full bg-black/60 px-3.5 py-1 text-[11px] font-medium text-white/75 backdrop-blur-sm">
          {scale > 1
            ? 'اسحب للتحريك · انقر نقرتين لإعادة الضبط'
            : 'عجلة الماوس أو اللمس للزووم · انقر نقرتين للتكبير'}
        </span>
      </div>
    </div>
  );
}
