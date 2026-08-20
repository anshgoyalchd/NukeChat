import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Bomb, RotateCcw, Home } from "lucide-react";

interface NukeAnimationProps {
  onComplete: () => void;
  onGoHome: () => void;
}

export const NukeAnimation: React.FC<NukeAnimationProps> = ({ onComplete, onGoHome }) => {
  const [stage, setStage] = useState<"warning" | "flash" | "explosion" | "radioactive" | "nuked">("warning");
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    // Check for prefers-reduced-motion
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mediaQuery.matches);

    if (mediaQuery.matches) {
      // If user prefers reduced motion, skip complex animations and jump straight to nuked final screen after a brief fade
      const timer = setTimeout(() => {
        setStage("nuked");
        onComplete();
      }, 500);
      return () => clearTimeout(timer);
    }

    // Sequence timing
    // 1. Warning screen (0 - 800ms)
    const warningTimer = setTimeout(() => {
      setStage("flash");
    }, 800);

    // 2. White flash (800ms - 1000ms)
    const flashTimer = setTimeout(() => {
      setStage("explosion");
    }, 1100);

    // 3. Cartoon explosion (1100ms - 2100ms)
    const explosionTimer = setTimeout(() => {
      setStage("radioactive");
    }, 2400);

    // 4. Radioactive warning & final state (2400ms+)
    const finalTimer = setTimeout(() => {
      setStage("nuked");
      onComplete();
    }, 3200);

    return () => {
      clearTimeout(warningTimer);
      clearTimeout(flashTimer);
      clearTimeout(explosionTimer);
      clearTimeout(finalTimer);
    };
  }, [onComplete]);

  if (stage === "nuked") {
    return (
      <div className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center p-6 text-center select-none">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="max-w-md w-full bg-surface border-2 border-brand-peach p-8 rounded-3xl shadow-sm flex flex-col items-center"
        >
          <div className="w-20 h-20 bg-brand-peach/30 rounded-full flex items-center justify-center mb-6">
            <span className="text-4xl text-brand-coral">☢️</span>
          </div>
          <h1 className="text-3xl font-bold mb-3 tracking-tight">CHAT NUKED</h1>
          <p className="text-secondaryText mb-8 leading-relaxed">
            Everything is gone. The SQLite storage was wiped, active connections were severed, and client caches have been deleted.
          </p>
          <button
            onClick={onGoHome}
            className="flex items-center gap-2 px-6 py-3 bg-brand-coral hover:bg-brand-coral/90 text-white font-medium rounded-full shadow-sm transition-all duration-200"
          >
            <Home className="w-4 h-4" />
            Go Home
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 overflow-hidden flex items-center justify-center">
      {/* 1. WARNING STAGE */}
      {stage === "warning" && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-brand-peach flex flex-col items-center justify-center text-primaryText"
        >
          <motion.div
            animate={{ scale: [1, 1.1, 1] }}
            transition={{ repeat: Infinity, duration: 0.4 }}
            className="text-7xl mb-4"
          >
            ⚠️
          </motion.div>
          <h2 className="text-2xl font-bold tracking-wider text-brand-coral uppercase">
            Nuke Triggered...
          </h2>
        </motion.div>
      )}

      {/* 2. FLASH STAGE */}
      {stage === "flash" && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="absolute inset-0 bg-white"
        />
      )}

      {/* 3. EXPLOSION STAGE */}
      {stage === "explosion" && (
        <div className="absolute inset-0 bg-orange-50 flex items-center justify-center">
          {/* Main Flash */}
          <motion.div
            initial={{ scale: 0.2, opacity: 1 }}
            animate={{ scale: 2.5, opacity: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="absolute w-96 h-96 bg-yellow-300 rounded-full"
          />

          {/* Mushroom Cloud Stem */}
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "40%", opacity: 1 }}
            transition={{ duration: 0.3 }}
            className="absolute bottom-0 w-16 bg-gradient-to-t from-orange-400 to-yellow-200 rounded-t-full"
          />

          {/* Mushroom Cloud Cap */}
          <motion.div
            initial={{ scale: 0.1, y: 100, opacity: 0 }}
            animate={{ scale: 1.2, y: -80, opacity: 1 }}
            transition={{ type: "spring", stiffness: 100, damping: 10 }}
            className="absolute w-64 h-48 bg-gradient-to-b from-orange-500 via-orange-400 to-yellow-300 rounded-full flex items-center justify-center filter blur-sm"
          />

          {/* Blast Particles */}
          {[...Array(12)].map((_, i) => {
            const angle = (i * 30 * Math.PI) / 180;
            const distance = 150 + Math.random() * 80;
            const x = Math.cos(angle) * distance;
            const y = Math.sin(angle) * distance;
            return (
              <motion.div
                key={i}
                initial={{ x: 0, y: 0, scale: 1 }}
                animate={{ x, y, scale: 0, opacity: 0 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="absolute w-6 h-6 bg-orange-400 rounded-full"
              />
            );
          })}
        </div>
      )}

      {/* 4. RADIOACTIVE STATE */}
      {stage === "radioactive" && (
        <motion.div
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-yellow-100 flex flex-col items-center justify-center text-yellow-800"
        >
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 3, ease: "linear" }}
            className="text-9xl text-yellow-600 mb-6"
          >
            ☢️
          </motion.div>
          <h2 className="text-xl font-bold uppercase tracking-widest text-yellow-700">
            Wiping Server Storage
          </h2>
        </motion.div>
      )}
    </div>
  );
};
