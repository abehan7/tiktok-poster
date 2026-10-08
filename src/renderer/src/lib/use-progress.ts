import { useEffect, useState } from "react";
import type { Progress } from "@shared/contract";
import { poster } from "./api";

/** Latest upload progress event (there is only ever one post in flight). */
export function useProgress(active: boolean): Progress | null {
  const [progress, setProgress] = useState<Progress | null>(null);
  useEffect(() => {
    if (!active) {
      setProgress(null);
      return;
    }
    return poster.onProgress((p) => setProgress(p.stage ? p : null));
  }, [active]);
  return progress;
}
