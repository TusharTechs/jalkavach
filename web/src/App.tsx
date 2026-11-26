import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import MapView from "./components/MapView";
import Intro from "./components/Intro";
import { BeliefPanel, Dock, SignalsPanel, Timeline, Toast, TopBar } from "./components/Hud";
import { Audit, Escalation, Evidence, Intake, Vision } from "./components/Drawers";
import { useStore } from "./store";
import { Mark } from "./components/Logo";

export default function App() {
  const { boot, view, net, state } = useStore();
  useEffect(() => { boot(); }, []);
  const ready = !!net && !!state;
  return (
    <div className="relative w-full h-full overflow-hidden">
      {ready && <MapView />}
      <AnimatePresence>
        {!ready && (
          <motion.div key="load" exit={{ opacity: 0 }} className="absolute inset-0 grid place-items-center bg-abyss z-[60]">
            <motion.div animate={{ scale: [1, 1.06, 1] }} transition={{ repeat: Infinity, duration: 1.6 }}><Mark size={84} /></motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>{ready && view === "intro" && <Intro key="intro" />}</AnimatePresence>
      {ready && view !== "intro" && (
        <>
          <TopBar />
          <SignalsPanel />
          <AnimatePresence mode="wait">
            {view === "command" && <BeliefPanel key="belief" />}
            {view === "intake" && <Intake key="intake" />}
            {view === "escalation" && <Escalation key="esc" />}
            {view === "audit" && <Audit key="audit" />}
            {view === "evidence" && <Evidence key="ev" />}
            {view === "vision" && <Vision key="vision" />}
          </AnimatePresence>
          <Dock />
          <Timeline />
          <Toast />
        </>
      )}
    </div>
  );
}
