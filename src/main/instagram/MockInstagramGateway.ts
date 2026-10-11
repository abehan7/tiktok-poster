import { randomBytes } from "node:crypto";
import type { ContainerSpec, ContainerState, IgProfile, IgTokenGrant, InstagramGateway } from "./InstagramGateway";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SIXTY_DAYS = 60 * 86_400;
const accountOf = (token: string) => Number(/^mock-ig-(\d+)-/.exec(token)?.[1] ?? 0);

/** In-process fake Instagram used in mock mode, so login, containers and publishing can be tried offline. */
export class MockInstagramGateway implements InstagramGateway {
  private static readonly NAMES = ["democreator (mock)", "demostudio (mock)", "democlips (mock)"];
  private readonly containers = new Map<string, { kind: ContainerSpec["kind"]; createdAt: number; published: boolean }>();
  private logins = 0;

  async authorize(): Promise<IgTokenGrant> {
    await sleep(600);
    return this.grant(this.logins++ % MockInstagramGateway.NAMES.length);
  }

  /** A pasted token in mock mode: "mock-ig-<n>-…" picks account n, anything else the next one. */
  tokenFor(pasted: string): string {
    return /^mock-ig-\d+-/.test(pasted) ? pasted : this.grant(this.logins++ % MockInstagramGateway.NAMES.length).accessToken;
  }

  async refresh(accessToken: string): Promise<IgTokenGrant> {
    return this.grant(accountOf(accessToken));
  }

  private grant(n: number): IgTokenGrant {
    return { accessToken: `mock-ig-${n}-${randomBytes(6).toString("hex")}`, expiresIn: SIXTY_DAYS };
  }

  async profile(accessToken: string): Promise<IgProfile> {
    const n = accountOf(accessToken);
    const name = MockInstagramGateway.NAMES[n] ?? `mock${n}`;
    return {
      id: `1784140000000000${n}`,
      username: name.replace(/ \(mock\)$/, ""),
      displayName: name,
      avatarUrl: null,
      accountType: "MEDIA_CREATOR",
    };
  }

  async createContainer(_t: string, _u: string, spec: ContainerSpec): Promise<string> {
    await sleep(spec.kind === "carousel" ? 300 : 150);
    const id = `1790${randomBytes(6).readUIntBE(0, 6)}`;
    this.containers.set(id, { kind: spec.kind, createdAt: Date.now(), published: false });
    return id;
  }

  async containerStatus(_t: string, containerId: string): Promise<ContainerState> {
    const c = this.containers.get(containerId);
    // Containers don't survive a restart here; report what a real one would after a day.
    if (!c) return { status: "EXPIRED", detail: null };
    if (c.published) return { status: "PUBLISHED", detail: null };
    const ready = Date.now() - c.createdAt > (c.kind === "reel" ? 6000 : 1500);
    return { status: ready ? "FINISHED" : "IN_PROGRESS", detail: null };
  }

  async publish(_t: string, _u: string, containerId: string): Promise<string> {
    await sleep(400);
    const c = this.containers.get(containerId);
    if (c) c.published = true;
    return `1800${randomBytes(6).readUIntBE(0, 6)}`;
  }

  async permalink(): Promise<string | null> {
    return `https://www.instagram.com/p/MOCK${randomBytes(4).toString("hex")}/`;
  }
}
