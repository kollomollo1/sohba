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
  const [dismissY, setDismissY] = useState(0);
  const [isDismissing, setIsDismissing] = useState(false);

  const dragStartRef = useRef({ x: 0, y: 0 });
  const lastTouchDistanceRef = useRef<number | null>(null);

  // Tap tracking
  const lastTapTimeRef = useRef<number>(0);
  const lastTapPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const touchStartTimeRef = useRef<number>(0);
  const touchStartPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const lastZoomToggleTimeRef = useRef<number>(0);

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

  // Core Zoom Toggle with 400ms cooldown to prevent touch + synthetic click duplication
  const handleZoomToggle = (originX?: number, originY?: number) => {
    const now = Date.now();
    if (now - lastZoomToggleTimeRef.current < 400) return;
    lastZoomToggleTimeRef.current = now;

    setIsDragging(false);
    setIsDismissing(false);
    setDismissY(0);

    setScale((prev) => {
      if (prev > 1) {
        setPosition({ x: 0, y: 0 });
        return 1;
      } else {
        if (originX !== undefined && originY !== undefined && typeof window !== 'undefined') {
          const cx = window.innerWidth / 2;
          const cy = window.innerHeight / 2;
          const dx = (cx - originX) * 1.1;
          const dy = (cy - originY) * 1.1;
          setPosition({
            x: Math.max(-180, Math.min(180, dx)),
            y: Math.max(-180, Math.min(180, dy)),
          });
        } else {
          setPosition({ x: 0, y: 0 });
        }
        return 2.5;
      }
    });
  };

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
      setIsDismissing(false);
      setIsDragging(false);
      setDismissY(0);
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      lastTouchDistanceRef.current = dist;
      return;
    }

    if (e.touches.length === 1) {
      const touch = e.touches[0];
      touchStartTimeRef.current = Date.now();
      touchStartPosRef.current = {
        x: touch.clientX,
        y: touch.clientY,
      };

      if (scale > 1) {
        setIsDragging(true);
        dragStartRef.current = {
          x: touch.clientX - position.x,
          y: touch.clientY - position.y,
        };
      } else {
        setIsDismissing(true);
        dragStartRef.current = {
          x: touch.clientX,
          y: touch.clientY,
        };
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
        // Pan zoomed image
        setPosition({
          x: touch.clientX - dragStartRef.current.x,
          y: touch.clientY - dragStartRef.current.y,
        });
      } else if (scale === 1 && isDismissing) {
        // Swipe down to dismiss with 10px deadzone
        const dy = touch.clientY - dragStartRef.current.y;
        if (dy > 10) {
          setDismissY(dy - 10);
        } else {
          setDismissY(0);
        }
      }
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    lastTouchDistanceRef.current = null;
    setIsDragging(false);

    // Verify if this was a clean mobile tap
    if (e.changedTouches.length === 1) {
      const touch = e.changedTouches[0];
      const moveDistance = Math.hypot(
        touch.clientX - touchStartPosRef.current.x,
        touch.clientY - touchStartPosRef.current.y
      );
      const duration = Date.now() - touchStartTimeRef.current;

      // Clean tap: finger moved < 16px and tap duration < 320ms
      if (moveDistance < 16 && duration < 320) {
        const now = Date.now();
        const timeDiff = now - lastTapTimeRef.current;
        const distDiff = Math.hypot(
          touch.clientX - lastTapPosRef.current.x,
          touch.clientY - lastTapPosRef.current.y
        );

        // Double tap: second tap within 450ms and within 45px radius
        if (timeDiff > 40 && timeDiff < 450 && distDiff < 45) {
          lastTapTimeRef.current = 0;
          handleZoomToggle(touch.clientX, touch.clientY);
          return;
        } else {
          lastTapTimeRef.current = now;
          lastTapPosRef.current = { x: touch.clientX, y: touch.clientY };
        }
      }
    }

    if (scale === 1 && isDismissing) {
      setIsDismissing(false);
      if (dismissY > 110) {
        onClose();
      } else {
        setDismissY(0);
      }
    }
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

  const backdropOpacity = scale === 1 && dismissY > 0 ? Math.max(0.3, 1 - dismissY / 320) : 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        backgroundColor: `rgba(0, 0, 0, ${0.96 * backdropOpacity})`,
        paddingTop: 'max(0.75rem, env(safe-area-inset-top))',
        paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
      }}
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center backdrop-blur-md select-none touch-none animate-fade-in"
      onClick={(e) => {
        // Only close if clicking directly on the backdrop background
        if (e.target === e.currentTarget && scale === 1 && dismissY === 0) {
          onClose();
        }
      }}
    >
      {/* Top Mobile Bar */}
      <div
        className="absolute top-0 inset-x-0 z-[110] flex items-center justify-between px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 pointer-events-none"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
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
        <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1.5 backdrop-blur-md shadow-md border border-white/10 text-white">
          <button
            type="button"
            onClick={zoomOut}
            disabled={scale <= 1}
            className="flex h-8 w-8 items-center justify-center rounded-full active:bg-white/25 transition disabled:opacity-30"
            aria-label="تصغير"
          >
            <ZoomOut className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => handleZoomToggle()}
            className="px-2 py-0.5 text-xs font-bold text-white/95 rounded-md active:bg-white/20 transition"
            title="انقر للتبديل"
          >
            {scale > 1 ? `${Math.round(scale * 100)}%` : 'تكبير 2.5x'}
          </button>

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

      {/* Main Image Container */}
      <div
        className="relative flex items-center justify-center max-h-full max-w-full overflow-hidden w-full h-full p-2 touch-none"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onDoubleClick={(e) => {
          e.stopPropagation();
          handleZoomToggle(e.clientX, e.clientY);
        }}
        onWheel={handleWheel}
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={getOptimizedPostImageUrl(imageUrl, { width: 2000 })}
          alt={alt}
          draggable={false}
          style={{
            transform: `translate3d(${position.x}px, ${position.y + dismissY}px, 0) scale(${scale})`,
            transition: isDragging || isDismissing ? 'none' : 'transform 0.22s cubic-bezier(0.2, 0.8, 0.2, 1)',
            willChange: 'transform',
          }}
          className="max-h-[85vh] max-w-[96vw] object-contain rounded-xl select-none touch-none pointer-events-auto shadow-2xl"
        />
      </div>

      {/* Mobile Gestures Helper Bar */}
      <div
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        className="absolute bottom-2 inset-x-0 text-center pointer-events-none transition-opacity duration-200"
      >
        <span className="inline-block rounded-full bg-black/65 px-4 py-1.5 text-xs font-medium text-white/90 backdrop-blur-md shadow-md border border-white/10">
          {scale > 1
            ? 'انقر مرتين للرجوع · اسحب للتجول'
            : 'انقر مرتين للتكبير · بإصبعين للزووم'}
        </span>
      </div>
    </div>
  );
}
