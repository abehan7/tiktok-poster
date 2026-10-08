import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** A JSON document in the app's userData folder, written atomically. */
export class JsonFile<T> {
  private readonly path: string;

  constructor(
    name: string,
    private readonly fallback: () => T,
  ) {
    const dir = app.getPath("userData");
    mkdirSync(dir, { recursive: true });
    this.path = join(dir, name);
  }

  read(): T {
    if (!existsSync(this.path)) return this.fallback();
    try {
      return { ...this.fallback(), ...JSON.parse(readFileSync(this.path, "utf8")) };
    } catch {
      return this.fallback();
    }
  }

  write(value: T): void {
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(value, null, 2));
    renameSync(tmp, this.path);
  }
}
