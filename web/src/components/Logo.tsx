import { motion } from "motion/react";

/** The JalKavach mark: a water droplet holding a cusped Rajwada-style arch (the kavach, with a
 * saffron rim); inside, a pipe network with the located ingress point (coral). Below 34 px the
 * network is dropped and only the coral node remains. `animate` plays the intro reveal. */
export function Mark({ size = 40, animate = false, pulse = false }: { size?: number; animate?: boolean; pulse?: boolean }) {
  const tiny = size < 34;
  const d = (delay: number) => (animate ? { initial: { pathLength: 0, opacity: 0 }, animate: { pathLength: 1, opacity: 1 }, transition: { duration: 1.1, delay, ease: [0.65, 0, 0.35, 1] as const } } : {});
  const pop = (delay: number) => (animate ? { initial: { scale: 0, opacity: 0 }, animate: { scale: 1, opacity: 1 }, transition: { type: "spring" as const, stiffness: 260, damping: 14, delay } } : {});
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-label="JalKavach">
      <defs>
        <linearGradient id="jk-drop" x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#67E8F9" /><stop offset="0.55" stopColor="#22A6F2" /><stop offset="1" stopColor="#2546E8" />
        </linearGradient>
        <radialGradient id="jk-glow" cx="0.5" cy="0.66" r="0.5">
          <stop offset="0" stopColor="#FF6B6B" stopOpacity=".6" /><stop offset="1" stopColor="#FF6B6B" stopOpacity="0" />
        </radialGradient>
      </defs>
      <motion.path d="M60 4C60 4 20 51 20 77a40 40 0 0 0 80 0C100 51 60 4 60 4Z" fill="url(#jk-drop)"
        {...(animate ? { initial: { opacity: 0, scale: 0.6, y: -20 }, animate: { opacity: 1, scale: 1, y: 0 }, transition: { duration: 0.9, ease: [0.2, 0.8, 0.2, 1] } } : {})}
        style={{ transformOrigin: "60px 70px" }} />
      <defs><clipPath id="jk-clip"><path d="M60 4C60 4 20 51 20 77a40 40 0 0 0 80 0C100 51 60 4 60 4Z" /></clipPath></defs>
      <motion.path d="M39 100L39 72A6 6 0 0 0 41.5 61A6 6 0 0 0 47 52A6 6 0 0 0 54 45.5A6 6 0 0 0 60 41.5A6 6 0 0 0 66 45.5A6 6 0 0 0 73 52A6 6 0 0 0 78.5 61A6 6 0 0 0 81 72A6 6 0 0 0 81 72L81 100Z" fill="#061422" stroke="#FF9F43" strokeWidth="2" strokeLinejoin="round" clipPath="url(#jk-clip)"
        {...(animate ? { initial: { opacity: 0, scale: 0.4 }, animate: { opacity: 1, scale: 1 }, transition: { delay: 0.55, duration: 0.6 } } : {})}
        style={{ transformOrigin: "60px 72px" }} />
      {!tiny && <>
        <circle cx="60" cy="79" r="13" fill="url(#jk-glow)" />
        <motion.path d="M49 74L60 79l11-5M60 79v12" stroke="#7DE3F4" strokeWidth="2.8" fill="none" strokeLinecap="round" strokeLinejoin="round" {...d(0.9)} />
        {[[49, 74], [71, 74], [60, 91]].map(([x, y], k) => (
          <motion.circle key={k} cx={x} cy={y} r="3" fill="#7DE3F4" {...pop(1.3 + k * 0.12)} style={{ transformOrigin: `${x}px ${y}px` }} />
        ))}
      </>}
      <motion.circle cx="60" cy="79" r={tiny ? 9 : 4.6} fill="#FF6B6B" {...pop(1.75)} style={{ transformOrigin: "60px 79px" }} />
      {pulse && (
        <motion.circle cx="60" cy="79" r="4.6" fill="none" stroke="#FF6B6B" strokeWidth="1.5"
          animate={{ r: [4.6, 16], opacity: [0.9, 0] }} transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut", delay: 2 }} />
      )}
    </svg>
  );
}

export function Wordmark({ size = 22 }: { size?: number }) {
  return (
    <div className="leading-none">
      <div className="font-display font-bold tracking-tight" style={{ fontSize: size }}>
        <span className="bg-gradient-to-r from-aqua to-cyan bg-clip-text text-transparent">Jal</span>Kavach
      </div>
      <div className="font-hindi text-[15px] leading-5 mt-0.5" style={{ color: "#FFB27A", letterSpacing: 0 }}>जलकवच</div>
    </div>
  );
}
