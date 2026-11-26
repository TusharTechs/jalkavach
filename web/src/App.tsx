import { AnimatePresence, motion } from "motion/react";
import { Component, useEffect, useRef, type ReactNode } from "react";
import MapView from "./components/MapView";
import Intro, { Prologue } from "./components/Intro";
import { AlertVignette, BeliefPanel, Dock, Legend, MapControls, SignalsPanel, Timeline, Toast, TopBar } from "./components/Hud";
import { Audit, Escalation, Evidence, Intake, Vision } from "./components/Drawers";
import { useStore, type View } from "./store";
import { Mark } from "./components/Logo";
import { StoryCaption, useStory } from "./components/Story";
import { Clapperboard } from "lucide-react";

const hasWebGL2 = (() => { try { return !!document.createElement("canvas").getContext("webgl2"); } catch { return false; } })();

class MapBoundary extends Component<{ children: ReactNode }, { err: boolean }> {
  state = { err: false };
  static getDerivedStateFromError() { return { err: true }; }
  render() {
    return this.state.err || !hasWebGL2 ? (
      <div className="absolute inset-0 grid place-items-center text-center text-mist p-10" style={{ background: "#050f1a" }}>
        <div><div className="text-lg text-white mb-2">3D view unavailable on this display</div>
          <div className="text-sm">WebGL2 is not available. The panels still work; for the stage, use Chrome with hardware acceleration on, or the recorded demo video.</div></div>
      </div>
    ) : this.props.children;
  }
}

const KEYVIEW: Record<string, View> = { "1": "command", "2": "intake", "3": "escalation", "4": "audit", "5": "evidence", "6": "vision" };

export default function App() {
  const { boot, view, net, state, stage } = useStore();
  const story = useStory();
  const storyRef = useRef(story);
  storyRef.current = story;
  useEffect(() => { boot(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA" || (e.target as HTMLElement)?.tagName === "SELECT") return;
      const s = useStore.getState();
      if (e.key === "ArrowRight") s.setDay(s.day + 1);
      else if (e.key === "ArrowLeft") s.setDay(s.day - 1);
      else if (e.key === " ") { e.preventDefault(); s.togglePlay(); }
      else if (e.key === "s" || e.key === "S") s.toggleStage();
      else if (e.key === "h" || e.key === "H") s.toggleLang();
      else if (e.key === "r" || e.key === "R") s.toggleReveal();
      else if (e.key === "Escape") { storyRef.current.stop(); s.setView("command"); }
      else if (e.key === "p" || e.key === "P") { const st = storyRef.current; if (st.on) st.stop(); else st.start(); }
      else if (KEYVIEW[e.key] && s.view !== "intro" && s.view !== "prologue") s.setView(KEYVIEW[e.key]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const ready = !!net && !!state;
  const hud = ready && view !== "intro" && view !== "prologue";
  return (
    <div className="relative w-full h-full overflow-hidden">
      {ready && <MapBoundary><MapView /></MapBoundary>}
      <AnimatePresence>
        {!ready && (
          <motion.div key="load" exit={{ opacity: 0 }} className="absolute inset-0 grid place-items-center bg-abyss z-[70]">
            <motion.div animate={{ scale: [1, 1.06, 1] }} transition={{ repeat: Infinity, duration: 1.6 }}><Mark size={84} /></motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {ready && view === "intro" && <Intro key="intro" />}
        {ready && view === "prologue" && <Prologue key="prologue" />}
      </AnimatePresence>
      {hud && <AlertVignette />}
      {hud && <StoryCaption on={story.on} caption={story.caption} stop={story.stop} />}
      {hud && (
        <div className="absolute inset-0 pointer-events-none" style={stage ? { zoom: 1.12 } as React.CSSProperties : undefined}>
          <div className="absolute inset-0 [&>*]:pointer-events-auto">
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
            <Legend />
            {!story.on && view === "command" && (
              <button onClick={story.start} title="Story mode (P)" className="absolute left-1/2 -translate-x-1/2 top-[124px] glass rounded-full px-4 py-2 text-[13px] text-aqua flex items-center gap-2 hover:bg-cyan/10">
                <Clapperboard size={15} />Play the story (P)
              </button>
            )}
            <MapControls />
            <Dock />
            <Timeline />
            <Toast />
          </div>
        </div>
      )}
    </div>
  );
}
