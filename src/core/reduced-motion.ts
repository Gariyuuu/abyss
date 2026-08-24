// Live view of the OS "prefers-reduced-motion" setting, readable per frame.
// The CSS guard in index.html cannot reach the three.js render loop, so
// engine code polls this instead. Module-level cache: the loop runs at
// 60fps, so this must be a plain boolean read rather than a matchMedia()
// call per frame.
let reduced = false;

if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  reduced = mq.matches;
  const onChange = (e: MediaQueryListEvent) => { reduced = e.matches; };
  if (typeof mq.addEventListener === "function") mq.addEventListener("change", onChange);
  else mq.addListener(onChange);
}

export function prefersReducedMotion(): boolean {
  return reduced;
}
