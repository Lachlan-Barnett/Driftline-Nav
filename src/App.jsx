import { useEffect, useRef } from 'react';
import { initDriftline } from './driftline.js';
import { markup } from './markup.js';

/**
 * Driftline mounts as one wrapping component rather than a tree of small
 * components. The original app is a single self-contained script that talks
 * to the DOM directly (getElementById, canvas drawing, localStorage) and was
 * never written against component state — porting it into idiomatic hooks and
 * components piece by piece would risk breaking a lot of carefully-tuned
 * behavior (gesture handling, animation timing, panel choreography) for
 * little real benefit here. So the markup is injected as-is and the same
 * script takes over afterwards, exactly as it did as a static page.
 *
 * If you want it broken into proper components (e.g. <RouteAlgorithmPanel>,
 * <ReportsFab>, <DriveHud>) as a next step, that's a reasonable follow-up —
 * just ask.
 */
export default function App() {
  const startedRef = useRef(false);

  useEffect(() => {
    // Guards against double-invocation in dev (e.g. if StrictMode is ever
    // added back) — the script sets up global listeners and a rAF loop that
    // should only ever run once per page load.
    if (startedRef.current) return;
    startedRef.current = true;

    const cleanup = initDriftline();
    return cleanup;
  }, []);

  return <div dangerouslySetInnerHTML={{ __html: markup }} />;
}
