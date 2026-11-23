import type { PictureInPictureLyricsPayload } from "@modules/ui/pictureInPicture/bridge";

export const FULLSCREEN_WINDOW_CHANNEL = "blyrics-fullscreen-window" as const;

export interface FullscreenPlaybackSnapshot {
  readonly currentTimeS: number;
  readonly durationS: number;
  readonly playbackRate: number;
  readonly isPlaying: boolean;
  readonly wallTime: number;
}

export interface FullscreenTrackInfo {
  readonly videoId: string | null;
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  readonly artworkUrl: string | null;
  readonly animatedArtworkUrl: string | null;
  readonly albumColor?: string;
  readonly albumColorDark?: string;
  readonly albumColorRatio?: string;
}

export interface FullscreenVideoState {
  readonly active: boolean;
  readonly aspectRatio: number;
}

export interface FullscreenLoaderState {
  readonly state: string;
  readonly text: string;
  readonly hidden: boolean;
}

export type FullscreenLyricsPayload = PictureInPictureLyricsPayload;

export type FullscreenOutbound =
  | {
      readonly channel: typeof FULLSCREEN_WINDOW_CHANNEL;
      readonly type: "ready";
      readonly track: FullscreenTrackInfo;
      readonly snapshot: FullscreenPlaybackSnapshot | null;
      readonly theme: string;
      readonly mergeTheme: string;
      readonly composite: boolean;
      readonly lyrics: FullscreenLyricsPayload | null;
      readonly loader?: FullscreenLoaderState;
      readonly blsState?: unknown;
      readonly video?: FullscreenVideoState;
    }
  | {
      readonly channel: typeof FULLSCREEN_WINDOW_CHANNEL;
      readonly type: "lyrics";
      readonly payload: FullscreenLyricsPayload;
    }
  | {
      readonly channel: typeof FULLSCREEN_WINDOW_CHANNEL;
      readonly type: "loader";
      readonly payload: FullscreenLoaderState;
    }
  | {
      readonly channel: typeof FULLSCREEN_WINDOW_CHANNEL;
      readonly type: "snapshot";
      readonly payload: FullscreenPlaybackSnapshot;
    }
  | {
      readonly channel: typeof FULLSCREEN_WINDOW_CHANNEL;
      readonly type: "track";
      readonly payload: FullscreenTrackInfo;
    }
  | { readonly channel: typeof FULLSCREEN_WINDOW_CHANNEL; readonly type: "bls-state"; readonly payload: unknown }
  | {
      readonly channel: typeof FULLSCREEN_WINDOW_CHANNEL;
      readonly type: "video-state";
      readonly payload: FullscreenVideoState;
    }
  | { readonly channel: typeof FULLSCREEN_WINDOW_CHANNEL; readonly type: "theme"; readonly payload: string }
  | {
      readonly channel: typeof FULLSCREEN_WINDOW_CHANNEL;
      readonly type: "merge-theme";
      readonly payload: string;
    }
  | { readonly channel: typeof FULLSCREEN_WINDOW_CHANNEL; readonly type: "mode"; readonly payload: boolean }
  | {
      readonly channel: typeof FULLSCREEN_WINDOW_CHANNEL;
      readonly type: "unavailable";
      readonly reason: string;
    };

export type FullscreenInbound =
  | { readonly channel: typeof FULLSCREEN_WINDOW_CHANNEL; readonly type: "hello" }
  | { readonly channel: typeof FULLSCREEN_WINDOW_CHANNEL; readonly type: "ping" }
  | { readonly channel: typeof FULLSCREEN_WINDOW_CHANNEL; readonly type: "bye" }
  | {
      readonly channel: typeof FULLSCREEN_WINDOW_CHANNEL;
      readonly type: "seek";
      readonly time: number;
    };
