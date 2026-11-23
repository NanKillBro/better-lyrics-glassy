import { parseSvgString } from "@modules/ui/lyricsDock/icons";
import { attachTransportAnimation } from "@modules/ui/playerControls/controlAnimations";
import { playerControlIcons } from "@modules/ui/playerControls/icons";
import { createRatingButton, playLikeBurst } from "@modules/ui/playerControls/ratingButton";
import { createVolumeControl, type VolumeControlHandle } from "@modules/ui/playerControls/volumeControl";
import {
  FULLSCREEN_WINDOW_CHANNEL,
  type FullscreenInbound,
  type FullscreenRatingState,
  type FullscreenTransportAction,
} from "@modules/ui/fullscreenWindow/messages";

type PlayerControlIcon = "previous" | "next" | "play" | "pause";

interface FullscreenPlayerControlsLabels {
  readonly previous: string;
  readonly play: string;
  readonly pause: string;
  readonly next: string;
  readonly like: string;
  readonly volume: string;
  readonly mute: string;
}

interface FullscreenPlayerControlsOptions {
  readonly container: HTMLElement;
  readonly send: (message: FullscreenInbound) => void;
  readonly labels: FullscreenPlayerControlsLabels;
}

export interface FullscreenPlayerControlsHandle {
  setPlaying: (playing: boolean) => void;
  setVolume: (level: number | null) => void;
  setRating: (rating: FullscreenRatingState) => void;
  destroy: () => void;
}

function createControlIcon(doc: Document, icon: PlayerControlIcon): SVGElement {
  const parsed = parseSvgString(playerControlIcons[icon]);
  const svg = parsed
    ? (doc.importNode(parsed, true) as SVGElement)
    : doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("blfw-player-control__icon", `blfw-player-control__icon--${icon}`);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  return svg;
}

export function createFullscreenPlayerControls(
  options: FullscreenPlayerControlsOptions
): FullscreenPlayerControlsHandle {
  const { container, send, labels } = options;
  const doc = container.ownerDocument;

  const createTransportButton = (action: FullscreenTransportAction, label: string): HTMLButtonElement => {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = `blfw-player-control blfw-player-control--${action}`;
    button.setAttribute("aria-label", label);
    if (action === "play-pause") {
      button.append(createControlIcon(doc, "play"), createControlIcon(doc, "pause"));
    } else {
      button.appendChild(createControlIcon(doc, action));
    }
    button.addEventListener("click", () => send({ channel: FULLSCREEN_WINDOW_CHANNEL, type: "transport", action }));
    attachTransportAnimation(button, action);
    return button;
  };

  const previousButton = createTransportButton("previous", labels.previous);
  const playPauseButton = createTransportButton("play-pause", labels.play);
  const nextButton = createTransportButton("next", labels.next);

  const likeButton = createRatingButton(doc, "like", labels.like, "blfw-player-control blfw-player-control--like");
  likeButton.addEventListener("click", () => send({ channel: FULLSCREEN_WINDOW_CHANNEL, type: "like" }));

  let lastVolume: number | null = null;
  const volumeControl: VolumeControlHandle = createVolumeControl({
    doc,
    readLevel: () => lastVolume,
    writeLevel: level => send({ channel: FULLSCREEN_WINDOW_CHANNEL, type: "volume", level }),
    toggleMuteAction: () => send({ channel: FULLSCREEN_WINDOW_CHANNEL, type: "mute" }),
    labels: { volume: labels.volume, mute: labels.mute },
  });

  container.append(previousButton, playPauseButton, nextButton, likeButton, volumeControl.element);

  let lastPlaying: boolean | null = null;
  let lastLiked: boolean | null = null;

  return {
    setPlaying(playing: boolean): void {
      if (playing === lastPlaying) return;
      lastPlaying = playing;
      playPauseButton.toggleAttribute("data-playing", playing);
      playPauseButton.setAttribute("aria-label", playing ? labels.pause : labels.play);
    },
    setVolume(level: number | null): void {
      if (level === null) return;
      lastVolume = level;
      volumeControl.setLevel(level);
    },
    setRating(rating: FullscreenRatingState): void {
      const liked = rating === "LIKE";
      likeButton.toggleAttribute("data-active", liked);
      likeButton.setAttribute("aria-pressed", String(liked));
      if (liked && lastLiked === false) playLikeBurst(likeButton);
      lastLiked = liked;
    },
    destroy(): void {
      volumeControl.destroy();
      container.replaceChildren();
    },
  };
}
