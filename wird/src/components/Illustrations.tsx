import React from 'react';
import { motion } from 'motion/react';
import { PALETTE_SWATCHES } from '../design/tokens';

export const WIRD_ASSETS = {
  logo: '/wird-logo-cropped.png',
  morningWindow: '/assets/aistudio/__________________________7b238392.png',
  eveningWindow: '/assets/aistudio/_________________________________80204d67.png',
};

export const WirdLogoMark: React.FC<{ className?: string }> = ({ className = 'h-12 w-auto' }) => (
  <img
    src={WIRD_ASSETS.logo}
    alt="وِرد"
    referrerPolicy="no-referrer"
    className={`object-contain select-none ${className}`}
  />
);

export const MorningIllustration: React.FC<{ className?: string }> = ({ className = '' }) => (
  <img
    src={WIRD_ASSETS.morningWindow}
    alt="نافذة الصباح"
    referrerPolicy="no-referrer"
    className={`w-full h-auto max-h-64 md:max-h-72 object-contain mx-auto select-none ${className}`}
  />
);

export const EveningIllustration: React.FC<{ className?: string }> = ({ className = '' }) => (
  <img
    src={WIRD_ASSETS.eveningWindow}
    alt="نافذة المساء"
    referrerPolicy="no-referrer"
    className={`w-full h-auto max-h-64 md:max-h-72 object-contain mx-auto select-none ${className}`}
  />
);

const PAPER_SHAPES = [
  { w: 10, h: 18, radius: '2px' },
  { w: 14, h: 8, radius: '2px' },
  { w: 9, h: 9, radius: '2px' },
  { w: 7, h: 16, radius: '3px' },
];

// Deterministic colorful paper confetti pieces using the 36-swatch palette
const PAPER_PIECES = Array.from({ length: 64 }, (_, i) => {
  const swatch = PALETTE_SWATCHES[i % PALETTE_SWATCHES.length];
  const shape = PAPER_SHAPES[i % PAPER_SHAPES.length];
  // Distribute smoothly across full viewport width
  const leftPercent = ((i * 37 + 11) % 96) + 2;
  const driftX = ((i % 9) - 4) * 32;
  const startRotate = (i * 43) % 360;
  const endRotate = startRotate + (i % 2 === 0 ? 540 : -540);
  const delay = (i % 16) * 0.09;
  const duration = 2.9 + (i % 5) * 0.45;

  return {
    id: i,
    color: swatch.hex,
    w: shape.w,
    h: shape.h,
    radius: shape.radius,
    leftPercent,
    driftX,
    startRotate,
    endRotate,
    delay,
    duration,
  };
});

/**
 * Full-screen colorful paper confetti celebration scattering across the viewport.
 * Uses pure CSS transform tween animations (no multi-keyframe springs).
 */
export const PaperConfettiBurst: React.FC<{ reducedMotion?: boolean }> = ({ reducedMotion }) => {
  if (reducedMotion) return null;

  return (
    <div
      aria-hidden="true"
      className="fixed inset-0 pointer-events-none overflow-hidden z-50"
    >
      {PAPER_PIECES.map((piece) => (
        <motion.span
          key={piece.id}
          style={{
            position: 'absolute',
            top: '-6vh',
            left: `${piece.leftPercent}%`,
            width: piece.w,
            height: piece.h,
            borderRadius: piece.radius,
            backgroundColor: piece.color,
            boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
          }}
          initial={{
            y: '-6vh',
            x: 0,
            rotate: piece.startRotate,
            scaleY: 1,
            opacity: 0,
          }}
          animate={{
            y: '112vh',
            x: [0, piece.driftX * 0.5, piece.driftX, piece.driftX * 0.65],
            rotate: piece.endRotate,
            scaleY: [1, 0.35, 1, 0.4, 1],
            opacity: [0, 1, 1, 1, 0],
          }}
          transition={{
            duration: piece.duration,
            delay: piece.delay,
            ease: 'linear',
          }}
        />
      ))}
    </div>
  );
};
