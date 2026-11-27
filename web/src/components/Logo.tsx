import { motion, useReducedMotion } from "motion/react";

const DROP = "M60 4C60 4 20 51 20 77a40 40 0 0 0 80 0C100 51 60 4 60 4Z";
/** The kavach: a shield whose crown steps up in four tiers like the storeys of Indore's Rajwada,
 *  with rows of arched windows (a civic palace facade, not a religious form). */
const SHIELD = "M37 61V55H42V50H47V45H52V40H68V45H73V50H78V55H83V61V77C83 91 73.5 100.5 60 106C46.5 100.5 37 91 37 77Z";
const WINDOWS = "M53.5 49.7V47.0A1.5 1.5 0 0 1 56.5 47.0V49.7Z M58.5 49.7V47.0A1.5 1.5 0 0 1 61.5 47.0V49.7Z M63.5 49.7V47.0A1.5 1.5 0 0 1 66.5 47.0V49.7Z M44.5 56.7V54.0A1.5 1.5 0 0 1 47.5 54.0V56.7Z M50.0 56.7V54.0A1.5 1.5 0 0 1 53.0 54.0V56.7Z M55.5 56.7V54.0A1.5 1.5 0 0 1 58.5 54.0V56.7Z M61.0 56.7V54.0A1.5 1.5 0 0 1 64.0 54.0V56.7Z M66.5 56.7V54.0A1.5 1.5 0 0 1 69.5 54.0V56.7Z M72.0 56.7V54.0A1.5 1.5 0 0 1 75.0 54.0V56.7Z";;

/** The JalKavach mark: a water droplet holding a kavach (shield, saffron rim); inside, a pipe
 * junction. The junction is saffron at rest and turns coral only while the ward is in ALERT.
 * Below 48 px the pipe lines are dropped and only the junction remains. */
export function Mark({ size = 40, animate = false, alert = false }: { size?: number; animate?: boolean; alert?: boolean }) {
  const still = useReducedMotion();
  const anim = animate && !still;
  const net = size >= 48;
  const dot = alert ? "#FF6B6B" : "#FF9F43";
  const d = (delay: number) => (anim ? { initial: { pathLength: 0, opacity: 0 }, animate: { pathLength: 1, opacity: 1 }, transition: { duration: 1.1, delay, ease: [0.65, 0, 0.35, 1] as const } } : {});
  const pop = (delay: number) => (anim ? { initial: { scale: 0, opacity: 0 }, animate: { scale: 1, opacity: 1 }, transition: { type: "spring" as const, stiffness: 260, damping: 14, delay } } : {});
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label="JalKavach logo">
      <defs>
        <linearGradient id="jk-drop" x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#67E8F9" /><stop offset="0.55" stopColor="#22A6F2" /><stop offset="1" stopColor="#2546E8" />
        </linearGradient>
      </defs>
      <motion.path d={DROP} fill="url(#jk-drop)"
        {...(anim ? { initial: { opacity: 0, scale: 0.6, y: -20 }, animate: { opacity: 1, scale: 1, y: 0 }, transition: { duration: 0.9, ease: [0.2, 0.8, 0.2, 1] } } : {})}
        style={{ transformOrigin: "60px 70px" }} />
      <motion.path d={SHIELD} fill="#061422" stroke="#FF9F43" strokeWidth={net ? 3.4 : 5} strokeLinejoin="round"
        {...(anim ? { initial: { opacity: 0, scale: 0.4 }, animate: { opacity: 1, scale: 1 }, transition: { delay: 0.55, duration: 0.6 } } : {})}
        style={{ transformOrigin: "60px 75px" }} />
      {net && <>
        <motion.path d={WINDOWS} fill="#FF9F43" opacity={0.9} {...(anim ? { initial: { opacity: 0 }, animate: { opacity: 0.9 }, transition: { delay: 0.8, duration: 0.6 } } : {})} />
        <motion.path d="M48 71L60 78l12-7M60 78v13" stroke="#7DE3F4" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" {...d(0.9)} />
        {[[48, 71], [72, 71], [60, 91]].map(([x, y], k) => (
          <motion.circle key={k} cx={x} cy={y} r="3.2" fill="#7DE3F4" {...pop(1.3 + k * 0.12)} style={{ transformOrigin: `${x}px ${y}px` }} />
        ))}
      </>}
      <motion.circle cx="60" cy="78" r={net ? 5 : 8} fill={dot} {...pop(1.75)} style={{ transformOrigin: "60px 78px" }} />
      {alert && !still && (
        <motion.circle cx="60" cy="78" r="5" fill="none" stroke="#FF6B6B" strokeWidth="1.5"
          animate={{ r: [5, 17], opacity: [0.9, 0] }} transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }} />
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
      <div className="font-hindi mt-0.5" style={{ color: "#FFB27A", letterSpacing: 0, fontSize: Math.round(size * 0.86), lineHeight: 1.35 }}>जलकवच</div>
    </div>
  );
}
