import { AnimatePresence, motion, useMotionValue, useTransform, animate } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useFitScale } from "../fit";
import { ArrowRight, SkipForward } from "lucide-react";
import { Mark } from "./Logo";
import { useStore } from "../store";
import { pct } from "../fmt";

function Counter({ to, prefix = "", suffix = "", decimals = 0, delay = 0 }: { to: number; prefix?: string; suffix?: string; decimals?: number; delay?: number }) {
  const v = useMotionValue(0);
  const text = useTransform(v, (x) => prefix + x.toFixed(decimals) + suffix);
  useEffect(() => { const c = animate(v, to, { duration: 1.6, delay, ease: [0.2, 0.8, 0.2, 1] }); return () => c.stop(); }, [to]);
  return <motion.span className="num">{text}</motion.span>;
}

function FlowLines() {
  const paths = Array.from({ length: 14 }, (_, i) => {
    const y = 40 + i * 62;
    return `M-50 ${y} C 300 ${y - 80 + (i % 3) * 40}, 700 ${y + 90 - (i % 4) * 30}, 1100 ${y - 20} S 1700 ${y + 60}, 2000 ${y}`;
  });
  return (
    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 1920 900" preserveAspectRatio="xMidYMid slice" aria-hidden
      style={{ maskImage: "radial-gradient(ellipse 34% 46% at 50% 50%, transparent 0%, transparent 62%, #000 100%)", WebkitMaskImage: "radial-gradient(ellipse 34% 46% at 50% 50%, transparent 0%, transparent 62%, #000 100%)" }}>
      <defs><linearGradient id="fl" x1="0" x2="1"><stop offset="0" stopColor="#22A6F2" stopOpacity="0" /><stop offset=".5" stopColor="#67E8F9" stopOpacity=".55" /><stop offset="1" stopColor="#2546E8" stopOpacity="0" /></linearGradient></defs>
      {paths.map((d, i) => (
        <g key={i}>
          <path d={d} stroke="#12304d" strokeWidth="1" fill="none" />
          <motion.path d={d} stroke="url(#fl)" strokeWidth={i % 5 === 2 ? 2.2 : 1.2} fill="none" strokeDasharray="60 340"
            animate={{ strokeDashoffset: [0, -800] }} transition={{ duration: 6 + (i % 4), repeat: Infinity, ease: "linear", delay: i * 0.3 }} />
        </g>
      ))}
    </svg>
  );
}

export default function Intro() {
  const { meta, setView } = useStore();
  const h = meta?.headline;
  const box = useRef<HTMLDivElement>(null);
  const k = useFitScale(box, 76);
  return (
    <motion.div className="absolute inset-0 z-50 flex items-center justify-center overflow-hidden noise"
      style={{ background: "radial-gradient(1200px 700px at 50% 40%, rgba(8,32,54,.96), rgba(2,8,14,.99))" }}
      exit={{ opacity: 0, filter: "blur(6px)" }} transition={{ duration: 0.7 }}>
      <FlowLines />
      <div ref={box} className="relative z-10 flex flex-col items-center text-center px-6 shrink-0" style={{ transform: `scale(${k})`, transformOrigin: "50% 50%" }}>
        <Mark size={146} animate />
        <motion.h1 className="font-display font-bold tracking-tight mt-5 text-6xl md:text-7xl"
          initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.1, duration: 1 }}>
          <span className="bg-gradient-to-r from-aqua via-cyan to-azure bg-clip-text text-transparent">Jal</span>Kavach
        </motion.h1>
        <motion.div className="font-hindi mt-1 text-[50px] leading-[64px]" style={{ color: "#FFB27A", letterSpacing: 0 }}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5 }}>जलकवच</motion.div>
        <motion.p className="mt-5 text-2xl md:text-[28px] text-slate-100 max-w-3xl font-display font-medium"
          initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.9 }}>
          Join the warnings. Rank the pipes. Start the city's clock.
        </motion.p>
        <motion.p className="mt-3 text-[15px] text-mist max-w-2xl leading-relaxed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.2 }}>
          Complaints and field tests the city collects, plus pharmacy counts shared by agreement, joined into one alert that ranks the most likely pipe junctions to test first.
        </motion.p>
        {h && (
          <motion.div className="mt-8 grid grid-cols-3 gap-3 w-full max-w-3xl" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2.5 }}>
            {[
              { v: <Counter to={100 * h.det_gain_vs_CC[0]} prefix="+" suffix=" pts" delay={2.6} />, l: "more events caught than a simple complaint-count alarm (≤1 false alarm per ward per quarter; at a monthly budget the gain is not significant)" },
              { v: <Counter to={100 * h.top3_F} suffix="%" delay={2.7} />, l: `true junction in the top 3 of ${h.n_junctions}, three days after the alert (complaints only: ${pct(h.top3_C)}; centroid: ${pct(h.top3_CC)})` },
              { v: <><Counter to={h.lead_days[0]} delay={2.8} /> days</>, l: "median lead over a hospital-only baseline (its misses counted at day 21)" },
            ].map((x, i) => (
              <div key={i} className="glass rounded-2xl px-4 py-4 text-left">
                <div className="text-[34px] font-display font-bold text-white leading-none">{x.v}</div>
                <span className="inline-block mt-2 text-[10.5px] tracking-wider uppercase text-mist border border-white/15 rounded-full px-2 py-0.5">in simulation</span>
                <div className="text-[12.5px] text-mist mt-2 leading-snug">{x.l}</div>
              </div>
            ))}
          </motion.div>
        )}
        <motion.div className="text-[11.5px] text-mist mt-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 3 }}>
          {h?.n_scenarios.toLocaleString("en-IN")} held-out simulated scenarios · evaluation pre-registered · ≤1 false alarm per ward per quarter
        </motion.div>
        <motion.button onClick={() => setView("prologue")}
          className="mt-8 group relative inline-flex items-center gap-3 rounded-full px-8 py-4 font-display font-semibold text-lg text-abyss bg-gradient-to-r from-aqua to-cyan shadow-[0_0_40px_-6px_rgba(103,232,249,.7)]"
          initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 3.1, type: "spring" }}
          whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}>
          Follow the water <ArrowRight size={19} className="transition-transform group-hover:translate-x-1" />
        </motion.button>
        <motion.div className="mt-6 rounded-2xl border border-[#FF9F43]/30 bg-[#FF9F43]/5 px-6 py-3 flex items-center gap-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 3.3 }}>
          <span className="font-hindi text-[20px] text-[#FFB27A]" style={{ letterSpacing: 0 }}>स्वच्छता में नंबर 1; अब सुरक्षा में भी।</span>
          <span className="w-px h-6 bg-white/15" />
          <span className="font-display text-[15px] text-slate-200">From <b className="text-mint">Swachh</b> to <b className="text-aqua">Surakshit</b></span>
        </motion.div>
        <div className="mt-6 text-[11.5px] text-mist/70">BUILD 2036 · Frontier 06: The Rise of New India · Indore, Madhya Pradesh</div>
      </div>
    </motion.div>
  );
}

/** Narmada → Indore → ward schematic (not to scale), then hand over to the 3D ward. */
export function Prologue() {
  const { setView } = useStore();
  const [step, setStep] = useState(0);
  useEffect(() => {
    const ts = [1700, 3500, 5300, 7000].map((ms, i) => window.setTimeout(() => (i < 3 ? setStep(i + 1) : setView("command")), ms));
    return () => ts.forEach(clearTimeout);
  }, []);
  const captions = [
    "Narmada water is lifted at Jalud and pumped about 70 km to Indore.",
    "It reaches the city's wards for an hour or two a day, often on alternate days: intermittent supply.",
    "Between supply windows, pipes sit at low pressure. That is when sewage can get in.",
    "One ward. Watch closely.",
  ];
  const wards = Array.from({ length: 85 }, (_, i) => {
    const a = i * 2.39996, r = 11 * Math.sqrt(i + 1);
    return { x: 1300 + r * Math.cos(a), y: 420 + r * Math.sin(a), i };
  });
  return (
    <motion.div className="absolute inset-0 z-50 bg-abyss/95 overflow-hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.6 }}>
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 1920 900" preserveAspectRatio="xMidYMid meet">
        <defs><linearGradient id="riv" x1="0" x2="1"><stop offset="0" stopColor="#1d4ed8" /><stop offset="1" stopColor="#22a6f2" /></linearGradient></defs>
        <motion.path d="M80 760 C 300 720, 420 780, 600 740 S 900 700, 1100 760 S 1500 800, 1850 760" stroke="url(#riv)" strokeWidth="14" fill="none" strokeLinecap="round"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.4, ease: "easeInOut" }} />
        <text x="110" y="812" fill="#8fb3d1" fontSize="22" fontFamily="Space Grotesk Variable">Narmada · माँ नर्मदा</text>
        <circle cx="520" cy="748" r="12" fill="#67e8f9" /><text x="470" y="712" fill="#e6f1fb" fontSize="22" fontFamily="Space Grotesk Variable">Jalud intake</text>
        <motion.path d="M520 748 C 700 650, 900 560, 1240 440" stroke="#67e8f9" strokeWidth="4" fill="none" strokeDasharray="14 12"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1, strokeDashoffset: [0, -260] }}
          transition={{ pathLength: { delay: 0.5, duration: 1.4 }, strokeDashoffset: { duration: 3, repeat: Infinity, ease: "linear" } }} />
        <text x="730" y="610" fill="#8fb3d1" fontSize="18" fontFamily="Inter Variable">≈70 km of mains · schematic, not to scale</text>
        {step >= 1 && wards.map((w) => (
          <motion.circle key={w.i} cx={w.x} cy={w.y} r={6.5} fill={w.i === 42 && step >= 3 ? "#f5b544" : "#22a6f2"} fillOpacity={step >= 2 ? (w.i === 42 ? 1 : 0.45) : 0.8}
            initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: w.i * 0.008 }} style={{ transformOrigin: `${w.x}px ${w.y}px` }} />
        ))}
        {step >= 1 && <text x="1215" y="270" fill="#e6f1fb" fontSize="26" fontFamily="Space Grotesk Variable">Indore · 85 wards</text>}
        {step >= 3 && (() => { const w = wards[42]; return (
          <g>
            {[0, 1, 2].map((k) => <motion.circle key={k} cx={w.x} cy={w.y} fill="none" stroke="#f5b544" strokeWidth="2" animate={{ r: [8, 64], opacity: [0.9, 0] }} transition={{ duration: 1.6, repeat: Infinity, delay: k * 0.5 }} />)}
            <text x={w.x + 34} y={w.y - 34} fill="#f5b544" fontSize="22" fontFamily="Space Grotesk Variable">Ward 00 · Demo Nagar</text>
          </g>); })()}
      </svg>
      <div className="absolute bottom-16 left-0 right-0 flex justify-center">
        <AnimatePresence mode="wait">
          <motion.div key={step} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="glass rounded-2xl px-7 py-3.5 text-2xl font-display text-slate-100">{captions[step]}</motion.div>
        </AnimatePresence>
      </div>
      <button onClick={() => setView("command")} className="absolute top-6 right-6 flex items-center gap-2 text-mist hover:text-white text-sm"><SkipForward size={16} />Skip</button>
    </motion.div>
  );
}
