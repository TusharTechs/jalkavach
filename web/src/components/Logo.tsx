import { motion } from "motion/react";

/** The JalKavach mark: a droplet holding a shield; inside, a pipe network with the located
 * ingress point (coral). `animate` plays the draw-on reveal used in the intro. */
export function Mark({ size = 40, animate = false, pulse = false }: { size?: number; animate?: boolean; pulse?: boolean }) {
  const d = (delay: number) => (animate ? { initial: { pathLength: 0, opacity: 0 }, animate: { pathLength: 1, opacity: 1 }, transition: { duration: 1.1, delay, ease: [0.65, 0, 0.35, 1] as const } } : {});
  const pop = (delay: number) => (animate ? { initial: { scale: 0, opacity: 0 }, animate: { scale: 1, opacity: 1 }, transition: { type: "spring" as const, stiffness: 260, damping: 14, delay } } : {});
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-label="JalKavach">
      <defs>
        <linearGradient id="jk-drop" x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#67E8F9" /><stop offset="0.55" stopColor="#22A6F2" /><stop offset="1" stopColor="#2546E8" />
        </linearGradient>
        <radialGradient id="jk-glow" cx="0.5" cy="0.62" r="0.5">
          <stop offset="0" stopColor="#FF6B6B" stopOpacity=".6" /><stop offset="1" stopColor="#FF6B6B" stopOpacity="0" />
        </radialGradient>
      </defs>
      <motion.path d="M60 4C60 4 20 51 20 77a40 40 0 0 0 80 0C100 51 60 4 60 4Z" fill="url(#jk-drop)"
        {...(animate ? { initial: { opacity: 0, scale: 0.6, y: -20 }, animate: { opacity: 1, scale: 1, y: 0 }, transition: { duration: 0.9, ease: [0.2, 0.8, 0.2, 1] } } : {})}
        style={{ transformOrigin: "60px 70px" }} />
      <g transform="translate(60 70) scale(1.12) translate(-60 -70)">
        <motion.path d="M60 43l21 7.5v17.3c0 13.6-9.2 23-21 28.2-11.8-5.2-21-14.6-21-28.2V50.5Z" fill="#061422"
          {...(animate ? { initial: { opacity: 0, scale: 0.4 }, animate: { opacity: 1, scale: 1 }, transition: { delay: 0.55, duration: 0.6 } } : {})}
          style={{ transformOrigin: "60px 70px" }} />
        <circle cx="60" cy="69" r="14" fill="url(#jk-glow)" />
        <motion.path d="M49 63.5L60 69l11-5.5M60 69v13" stroke="#7DE3F4" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" {...d(0.9)} />
        {[[49, 63.5], [71, 63.5], [60, 82]].map(([x, y], k) => (
          <motion.circle key={k} cx={x} cy={y} r="3.3" fill="#7DE3F4" {...pop(1.3 + k * 0.12)} style={{ transformOrigin: `${x}px ${y}px` }} />
        ))}
        <motion.circle cx="60" cy="69" r="4.6" fill="#FF6B6B" {...pop(1.75)} style={{ transformOrigin: "60px 69px" }} />
        {pulse && (
          <motion.circle cx="60" cy="69" r="4.6" fill="none" stroke="#FF6B6B" strokeWidth="1.5"
            animate={{ r: [4.6, 16], opacity: [0.9, 0] }} transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut", delay: 2 }} />
        )}
      </g>
    </svg>
  );
}

export function Wordmark({ size = 22 }: { size?: number }) {
  return (
    <div className="leading-none">
      <div className="font-display font-bold tracking-tight" style={{ fontSize: size }}>
        <span className="bg-gradient-to-r from-aqua to-cyan bg-clip-text text-transparent">Jal</span>Kavach
      </div>
      <div className="font-hindi text-[10px] tracking-[.2em] text-mist mt-1">जलकवच · WATER SHIELD</div>
    </div>
  );
}
