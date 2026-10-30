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
  const [dismissY, setDismissY] = useState(0); // Swipe-down-to-dismiss tracking
  const [isDismissing, setIsDismissing] = useState(false);

  const dragStartRef = useRef({ x: 0, y: 0 });
  const touchStartPointRef = useRef({ x: 0, y: 0 });
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
    setScale((prev) => Math.min(4, +(prev + 0.5).toFixed(2)));
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
    setDismissY(0);
  };

  // Mobile touch handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // 2 fingers: pinch-to-zoom
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      lastTouchDistanceRef.current = dist;
      setIsDragging(false);
    } else if (e.touches.length === 1) {
      const touch = e.touches[0];
      const now = Date.now();

      // Double tap detector (mobile standard: < 300ms)
      if (now - lastTapTimeRef.current < 300) {
        if (scale > 1) {
          resetZoom();
        } else {
          setScale(2.5);
          setPosition({ x: 0, y: 0 });
        }
        lastTapTimeRef.current = 0;
        return;
      }
      lastTapTimeRef.current = now;

      touchStartPointRef.current = { x: touch.clientX, y: touch.clientY };

      if (scale > 1) {
        setIsDragging(true);
        dragStartRef.current = {
          x: touch.clientX - position.x,
          y: touch.clientY - position.y,
        };
      } else {
        // scale === 1: start tracking potential swipe-down to dismiss
        setIsDismissing(true);
        dragStartRef.current = { x: touch.clientX, y: touch.clientY };
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && lastTouchDistanceRef.current !== null) {
      // Pinch to zoom
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
    } else if (e.touches.length === 1) {
      const touch = e.touches[0];
      if (scale > 1 && isDragging) {
        // Pan image around
        setPosition({
          x: touch.clientX - dragStartRef.current.x,
          y: touch.clientY - dragStartRef.current.y,
        });
      } else if (scale === 1 && isDismissing) {
        // Swipe down to dismiss
        const dy = touch.clientY - dragStartRef.current.y;
        if (dy > 0) {
          setDismissY(dy);
        } else {
          setDismissY(0);
        }
      }
    }
  };

  const handleTouchEnd = () => {
    lastTouchDistanceRef.current = null;
    setIsDragging(false);

    if (scale === 1 && isDismissing) {
      setIsDismissing(false);
      // If swiped down more than 100px, dismiss
      if (dismissY > 100) {
        onClose();
      } else {
        setDismissY(0);
      }
    }
  };

  // Double click for desktop fallback
  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (scale > 1) {
      resetZoom();
    } else {
      setScale(2.5);
    }
  };

  // Wheel zoom fallback
  const handleWheel = (e: React.WheelEvent) => {
    e.stopPropagation();
    const delta = e.deltaY < 0 ? 0.3 : -0.3;
    setScale((prev) => {
      const next = Math.min(Math.max(1, +(prev + delta).toFixed(2)), 4);
      if (next === 1) setPosition({ x: 0, y: 0 });
      return next;
    });
  };

  const backdropOpacity = scale === 1 && dismissY > 0 ? Math.max(0.3, 1 - dismissY / 350) : 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        backgroundColor: `rgba(0, 0, 0, ${0.96 * backdropOpacity})`,
        paddingTop: 'max(1rem, env(safe-area-inset-top))',
        paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
      }}
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center backdrop-blur-md select-none touch-none animate-fade-in"
      onClick={() => {
        if (scale === 1 && dismissY === 0) onClose();
      }}
    >
      {/* Mobile Top Header */}
      <div
        className="absolute top-0 inset-x-0 z-[110] flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 pointer-events-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button (Thumb-friendly touch target) */}
        <button
          type="button"
          onClick={onClose}
          className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-white hover:bg-white/30 active:scale-90 transition shadow-md backdrop-blur-md"
          aria-label="إغلاق"
          title="إغلاق"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Mobile Zoom Controls Pill */}
        <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-white/15 px-2 py-1 backdrop-blur-md shadow-md border border-white/10 text-white">
          <button
            type="button"
            onClick={zoomOut}
            disabled={scale <= 1}
            className="flex h-8 w-8 items-center justify-center rounded-full active:bg-white/25 transition disabled:opacity-30"
            aria-label="تصغير"
          >
            <ZoomOut className="h-4 w-4" />
          </button>

          <span className="min-w-[40px] text-center text-xs font-bold text-white/95">
            {Math.round(scale * 100)}%
          </span>

          <button
            type="button"
            onClick={zoomIn}
            disabled={scale >= 4}
            className="flex h-8 w-8 items-center justify-center rounded-full active:bg-white/25 transition disabled:opacity-30"
            aria-label="تكبير"
          >
            <ZoomIn className="h-4 w-4" />
          </button>

          {scale > 1 && (
            <button
              type="button"
              onClick={resetZoom}
              className="mr-0.5 flex h-8 w-8 items-center justify-center rounded-full active:bg-white/25 transition text-amber-300"
              aria-label="إعادة ضبط"
              title="إعادة ضبط الحجم"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Main Image Container (Mobile Touch Optimized) */}
      <div
        className="relative flex items-center justify-center max-h-full max-w-full overflow-hidden w-full h-full px-2"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onDoubleClick={handleDoubleClick}
        onWheel={handleWheel}
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={getOptimizedPostImageUrl(imageUrl, { width: 2000 })}
          alt={alt}
          draggable={false}
          style={{
            transform: `translate3d(${position.x}px, ${position.y + dismissY}px, 0) scale(${scale})`,
            transition: isDragging || isDismissing ? 'none' : 'transform 0.18s cubic-bezier(0.2, 0.8, 0.2, 1)',
          }}
          className="max-h-[85vh] max-w-[96vw] object-contain rounded-xl select-none pointer-events-auto"
        />
      </div>

      {/* Mobile Gestures Helper Bar */}
      <div
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        className="absolute bottom-2 inset-x-0 text-center pointer-events-none transition-opacity duration-200"
      >
        <span className="inline-block rounded-full bg-black/60 px-3.5 py-1 text-[11px] font-medium text-white/80 backdrop-blur-sm shadow-sm">
          {scale > 1
            ? 'اسحب بإصبعك للتجول · انقر مرتين للرجوع'
            : 'بإصبعين للزووم · انقر مرتين للتكبير · اسحب للأسفل للإغلاق'}
        </span>
      </div>
    </div>
  );
}
