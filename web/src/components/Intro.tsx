import { motion, useMotionValue, useTransform, animate } from "motion/react";
import { useEffect } from "react";
import { ArrowRight } from "lucide-react";
import { Mark } from "./Logo";
import { useStore } from "../store";
import { pct } from "../fmt";

function Counter({ to, suffix = "", decimals = 0, delay = 0 }: { to: number; suffix?: string; decimals?: number; delay?: number }) {
  const v = useMotionValue(0);
  const text = useTransform(v, (x) => x.toFixed(decimals) + suffix);
  useEffect(() => { const c = animate(v, to, { duration: 1.6, delay, ease: [0.2, 0.8, 0.2, 1] }); return () => c.stop(); }, [to]);
  return <motion.span className="num">{text}</motion.span>;
}

/** Flowing "pipe" lines behind the intro: SVG paths with animated dash offsets. */
function FlowLines() {
  const paths = Array.from({ length: 14 }, (_, i) => {
    const y = 40 + i * 62;
    return `M-50 ${y} C 300 ${y - 80 + (i % 3) * 40}, 700 ${y + 90 - (i % 4) * 30}, 1100 ${y - 20} S 1700 ${y + 60}, 2000 ${y}`;
  });
  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 1920 900" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id="fl" x1="0" x2="1"><stop offset="0" stopColor="#22A6F2" stopOpacity="0" /><stop offset=".5" stopColor="#67E8F9" stopOpacity=".55" /><stop offset="1" stopColor="#2546E8" stopOpacity="0" /></linearGradient>
      </defs>
      {paths.map((d, i) => (
        <g key={i}>
          <path d={d} stroke="#12304d" strokeWidth="1" fill="none" />
          <motion.path d={d} stroke="url(#fl)" strokeWidth={i % 5 === 2 ? 2.2 : 1.2} fill="none" strokeDasharray="60 340"
            animate={{ strokeDashoffset: [0, -800] }} transition={{ duration: 6 + (i % 4), repeat: Infinity, ease: "linear", delay: i * 0.3 }} />
        </g>
      ))}
      <motion.circle cx="1560" cy="250" r="6" fill="#FF6B6B" animate={{ opacity: [0, 1, 0.6, 1] }} transition={{ delay: 2.6, duration: 1.2 }} />
      {[0, 1, 2].map((k) => (
        <motion.circle key={k} cx="1560" cy="250" fill="none" stroke="#FF6B6B" strokeWidth="1.5"
          animate={{ r: [6, 70], opacity: [0.8, 0] }} transition={{ duration: 2.4, repeat: Infinity, delay: 2.6 + k * 0.8, ease: "easeOut" }} />
      ))}
    </svg>
  );
}

export default function Intro() {
  const { meta, setView } = useStore();
  const h = meta?.headline;
  return (
    <motion.div className="absolute inset-0 z-50 flex items-center justify-center overflow-hidden noise"
      style={{ background: "radial-gradient(1200px 700px at 50% 40%, rgba(8,32,54,.94), rgba(2,8,14,.98))" }}
      exit={{ opacity: 0, scale: 1.04, filter: "blur(8px)" }} transition={{ duration: 0.9 }}>
      <FlowLines />
      <div className="relative z-10 flex flex-col items-center text-center px-6">
        <Mark size={150} animate pulse />
        <motion.h1 className="font-display font-bold tracking-tight mt-6 text-6xl md:text-7xl"
          initial={{ opacity: 0, y: 18, letterSpacing: "0.2em" }} animate={{ opacity: 1, y: 0, letterSpacing: "-0.02em" }} transition={{ delay: 1.2, duration: 1.1, ease: [0.2, 0.8, 0.2, 1] }}>
          <span className="bg-gradient-to-r from-aqua via-cyan to-azure bg-clip-text text-transparent">Jal</span>Kavach
        </motion.h1>
        <motion.div className="font-hindi text-mist tracking-[.35em] mt-3 text-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.7 }}>
          जलकवच · WATER SHIELD
        </motion.div>
        <motion.p className="mt-6 text-xl md:text-2xl text-slate-200 max-w-2xl font-display"
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2.1, duration: 0.8 }}>
          Find the pipe <span className="text-coral">before</span> the hospital fills.
        </motion.p>
        <motion.p className="mt-3 text-sm text-mist max-w-xl" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.4 }}>
          Complaints, field tests and pharmacy counts that a city already collects, joined into one alert that names the likely pipe and starts the city's own clock.
        </motion.p>
        {h && (
          <motion.div className="mt-9 grid grid-cols-3 gap-3 w-full max-w-2xl" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2.7 }}>
            {[
              { v: <><Counter to={h.lead_days[0]} delay={2.8} /> days</>, l: "earlier than waiting for hospital admissions (median)" },
              { v: <><Counter to={h.detected_F * 100} suffix="%" delay={2.9} /></>, l: `of events detected vs ${pct(h.detected_H)} for the hospital-only baseline` },
              { v: <><Counter to={h.top3_F * 100} suffix="%" delay={3.0} /></>, l: `true pipe in the top 3 vs ${pct(h.top3_CC)} by complaint centroid` },
            ].map((x, i) => (
              <div key={i} className="glass rounded-2xl px-4 py-4 text-left">
                <div className="text-3xl font-display font-bold text-white">{x.v}</div>
                <div className="text-[11.5px] text-mist mt-1 leading-snug">{x.l}</div>
              </div>
            ))}
          </motion.div>
        )}
        <motion.div className="text-[11px] text-mist/80 mt-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 3.1 }}>
          Simulated, held-out, pre-registered evaluation · ≤1 false alarm per ward per quarter
        </motion.div>
        <motion.button onClick={() => setView("command")}
          className="mt-9 group relative inline-flex items-center gap-3 rounded-full px-7 py-3.5 font-display font-semibold text-abyss bg-gradient-to-r from-aqua to-cyan shadow-[0_0_40px_-6px_rgba(103,232,249,.7)]"
          initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 3.3, type: "spring" }}
          whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}>
          Enter the ward command centre <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
        </motion.button>
      </div>
      <div className="absolute bottom-5 left-0 right-0 text-center text-[11px] text-mist/70">
        BUILD 2036 · Frontier 06: The Rise of New India · Indore, Madhya Pradesh
      </div>
    </motion.div>
  );
}
