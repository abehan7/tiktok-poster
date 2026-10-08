import type { PosterApi } from "../shared/contract";

declare global {
  interface Window {
    poster: PosterApi;
  }
}
