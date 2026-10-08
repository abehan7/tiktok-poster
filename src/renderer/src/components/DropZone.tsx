import clsx from "clsx";
import { useState, type ReactNode } from "react";
import type { LocalFile } from "@shared/contract";
import { poster } from "@renderer/lib/api";

/** Accepts files dragged from Finder; paths are resolved through the preload bridge. */
export function DropZone({
  onFiles,
  children,
  className,
}: {
  onFiles(files: LocalFile[]): void;
  children: ReactNode;
  className?: string;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setOver(false);
        const paths = Array.from(e.dataTransfer.files).map((f) => poster.pathForFile(f)).filter(Boolean);
        if (paths.length) onFiles(await poster.registerFiles(paths));
      }}
      className={clsx(
        "rounded-xl border-2 border-dashed transition-colors",
        over ? "border-accent bg-accent/5" : "border-line",
        className,
      )}
    >
      {children}
    </div>
  );
}
