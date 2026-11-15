import { strict as assert } from "node:assert";
import { JSDOM } from "jsdom";
import { PLAYER_TIME_EVENT } from "@constants";
import type { PlayerDetails } from "@core/appState";
import { ARTWORK_STALE_GRACE, PictureInPictureLyricsView } from "@modules/ui/pictureInPicture/lyricsView";
import { FAST_ARTWORK_STALE_GRACE_MS } from "@modules/ui/pictureInPicture/fastArtwork";
import type { PictureInPictureSongMetadata } from "@modules/ui/pictureInPicture/types";

class NoopObserver {
  observe(): void {}
  disconnect(): void {}
}

function createFakeTimers() {
  let now = 1000;
  let nextId = 1;
  const tasks = new Map<number, { runAt: number; callback: () => void }>();

  const setTimeoutFn = (callback: () => void, delay = 0): number => {
    const id = nextId++;
    tasks.set(id, { runAt: now + Math.max(0, delay), callback });
    return id;
  };

  const clearTimeoutFn = (id: number): void => {
    tasks.delete(id);
  };

  const advanceBy = (ms: number): void => {
    const target = now + ms;
    while (true) {
      let nextTask: { id: number; runAt: number; callback: () => void } | null = null;
      for (const [id, task] of tasks) {
        if (task.runAt <= target && (!nextTask || task.runAt < nextTask.runAt)) {
          nextTask = { id, ...task };
        }
      }
      if (!nextTask) break;
      now = nextTask.runAt;
      tasks.delete(nextTask.id);
      nextTask.callback();
    }
    now = target;
  };

  return {
    now: () => now,
    setTimeout: setTimeoutFn,
    clearTimeout: clearTimeoutFn,
    advanceBy,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

function makePlayerDetail(videoId: string, song: string, thumbnail?: PlayerDetails["thumbnail"]): PlayerDetails {
  return {
    currentTime: 0,
    videoId,
    song,
    artist: "Artist",
    duration: "180",
    audioTrackData: { id: "default", isDefault: true },
    browserTime: Date.now(),
    isPlaying: true,
    playing: true,
    playbackRate: 1,
    contentRect: { width: 1280, height: 720 },
    ...(thumbnail ? { thumbnail } : {}),
  };
}

function setImageLoaded(dom: JSDOM, img: HTMLImageElement, width = 512): void {
  Object.defineProperty(img, "complete", { value: true, configurable: true });
  Object.defineProperty(img, "naturalWidth", { value: width, configurable: true });
  img.dispatchEvent(new dom.window.Event("load"));
}

function setImageError(dom: JSDOM, img: HTMLImageElement): void {
  Object.defineProperty(img, "complete", { value: true, configurable: true });
  Object.defineProperty(img, "naturalWidth", { value: 0, configurable: true });
  img.dispatchEvent(new dom.window.Event("error"));
}

function makeMetadata(videoId: string, url: string): PictureInPictureSongMetadata {
  return {
    id: videoId,
    artist: "Artist",
    displayTitle: `Song ${videoId}`,
    displayByline: "Artist",
    thumbnail: { url },
    counterpartVideoId: null,
  };
}

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>(resolve => queueMicrotask(resolve));
  await new Promise<void>(resolve => queueMicrotask(resolve));
}

async function run(): Promise<void> {
  assert.equal(ARTWORK_STALE_GRACE, 600, "upstream stale grace preserved when toggle is off");
  assert.equal(FAST_ARTWORK_STALE_GRACE_MS, 2000, "fast mode grace matches 2000ms");

  const timers = createFakeTimers();
  const pipDom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://music.youtube.com/" });
  const pipWin = pipDom.window as unknown as Window & Record<string, unknown>;
  const sourceDoc = pipDom.window.document.implementation.createHTMLDocument("source");
  Object.defineProperty(sourceDoc, "defaultView", {
    value: pipWin,
    configurable: true,
  });

  const globalRecord = globalThis as unknown as Record<string, unknown>;
  const globalOverrides: Record<string, unknown> = {
    AbortController: pipDom.window.AbortController,
    AbortSignal: pipDom.window.AbortSignal,
    CustomEvent: pipDom.window.CustomEvent,
    DOMParser: pipDom.window.DOMParser,
    Element: pipDom.window.Element,
    Event: pipDom.window.Event,
    HTMLElement: pipDom.window.HTMLElement,
    HTMLImageElement: pipDom.window.HTMLImageElement,
    IntersectionObserver: NoopObserver,
    MutationObserver: NoopObserver,
    Node: pipDom.window.Node,
    ResizeObserver: NoopObserver,
    SVGElement: pipDom.window.SVGElement,
    SVGSVGElement: pipDom.window.SVGSVGElement,
    document: pipDom.window.document,
    getComputedStyle: pipDom.window.getComputedStyle.bind(pipDom.window),
    window: pipWin,
    requestAnimationFrame: (cb: FrameRequestCallback) => timers.setTimeout(() => cb(timers.now()), 16),
    cancelAnimationFrame: (id: number) => timers.clearTimeout(id),
  };
  const savedGlobals = Object.fromEntries(Object.keys(globalOverrides).map(key => [key, globalRecord[key]]));
  Object.assign(globalRecord, globalOverrides);

  pipWin.matchMedia = (() => ({
    matches: false,
    media: "",
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  pipWin.ResizeObserver = NoopObserver;
  pipWin.IntersectionObserver = NoopObserver;
  pipWin.setTimeout = timers.setTimeout as unknown as typeof window.setTimeout;
  pipWin.clearTimeout = timers.clearTimeout as unknown as typeof window.clearTimeout;
  pipWin.requestAnimationFrame = (cb => timers.setTimeout(() => cb(timers.now()), 16)) as typeof window.requestAnimationFrame;
  pipWin.cancelAnimationFrame = (id => timers.clearTimeout(id)) as typeof window.cancelAnimationFrame;
  Object.defineProperty(pipWin, "performance", {
    value: { now: timers.now },
    configurable: true,
  });
  Object.defineProperty(pipWin.document, "fonts", {
    value: { addEventListener: () => {}, ready: Promise.resolve() },
    configurable: true,
  });
  pipDom.window.HTMLElement.prototype.animate = (() =>
    ({ finished: Promise.resolve() }) as unknown as Animation) as unknown as typeof HTMLElement.prototype.animate;
  const imgProto = pipDom.window.HTMLImageElement.prototype;
  const imgSrcDesc = Object.getOwnPropertyDescriptor(imgProto, "src")!;
  Object.defineProperty(imgProto, "src", {
    configurable: true,
    enumerable: imgSrcDesc.enumerable,
    get() {
      return imgSrcDesc.get!.call(this);
    },
    set(value: string) {
      Object.defineProperty(this, "complete", { value: false, configurable: true });
      Object.defineProperty(this, "naturalWidth", { value: 0, configurable: true });
      imgSrcDesc.set!.call(this, value);
    },
  });

  const pendingMeta = new Map<string, ReturnType<typeof createDeferred<PictureInPictureSongMetadata | null>>>();
  let fastArtworkEnabled = false;

  try {
    const view = new PictureInPictureLyricsView(
      pipWin as unknown as Window,
      sourceDoc,
      {
        translate: key => key,
        getArtworkMetadata: (videoId, _maxCheckCount, signal) => {
          const deferred = createDeferred<PictureInPictureSongMetadata | null>();
          pendingMeta.set(videoId, deferred);
          signal?.addEventListener("abort", () => deferred.resolve(null), { once: true });
          return deferred.promise;
        },
        isFastArtworkEnabled: () => fastArtworkEnabled,
        resetScrollResume: () => {},
        log: () => {},
      },
      () => ({ width: 520, height: 220 })
    );

    const doc = pipDom.window.document;
    const shell = doc.querySelector(".blyrics-pip-shell")!;
    const artwork = doc.querySelector(".blyrics-pip-artwork")!;
    const backdrop = doc.querySelector(".blyrics-pip-backdrop")!;
    const faces = [...doc.querySelectorAll<HTMLElement>(".blyrics-pip-artwork__face")];
    const images = [...doc.querySelectorAll<HTMLImageElement>(".blyrics-pip-artwork__image")];
    assert.equal(faces.length, 2);
    assert.equal(images.length, 2);

    const dispatchSong = (videoId: string, title: string, thumbnail?: PlayerDetails["thumbnail"]): void => {
      sourceDoc.dispatchEvent(
        new pipDom.window.CustomEvent(PLAYER_TIME_EVENT, { detail: makePlayerDetail(videoId, title, thumbnail) })
      );
    };

    // 1. Default OFF mode: preserves upstream 600ms grace and waits for /next metadata before loading.
    dispatchSong("off-1", "Off Song 1");
    pendingMeta.get("off-1")!.resolve(makeMetadata("off-1", "https://lh3.googleusercontent.com/off1=w120-h120"));
    await flushMicrotasks();
    assert.equal(images[1].getAttribute("src"), "https://lh3.googleusercontent.com/off1=w512-h512");
    setImageLoaded(pipDom, images[1]);
    assert.equal(artwork.getAttribute("data-has-art"), "true");
    assert.equal(backdrop.getAttribute("data-first"), "true");
    assert.notEqual(shell.getAttribute("data-running"), "true");

    // In OFF mode, player/DOM hints & 350ms fallback are ignored and 600ms wipe triggers at 601ms.
    dispatchSong("off-2", "Off Song 2", {
      url: "https://lh3.googleusercontent.com/off2-fast=w544-h544-rj",
      isSquare: true,
    });
    timers.advanceBy(400);
    assert.notEqual(images[0].getAttribute("src"), "https://lh3.googleusercontent.com/off2-fast=w512-h512-rj");
    assert.equal(artwork.getAttribute("data-has-art"), "true");
    timers.advanceBy(201);
    assert.equal(artwork.hasAttribute("data-has-art"), false, "OFF mode wipes at 600ms upstream threshold");
    pendingMeta.get("off-2")!.resolve(makeMetadata("off-2", "https://lh3.googleusercontent.com/off2=w120-h120"));
    await flushMicrotasks();
    setImageLoaded(pipDom, images[0]);
    assert.equal(artwork.getAttribute("data-has-art"), "true");
    assert.equal(shell.getAttribute("data-running"), "false");

    // 2. Flip Performance toggle ON -> 2000ms grace, 1200ms slow metadata retains cover and animates.
    fastArtworkEnabled = true;
    dispatchSong("song-2", "Song 2");
    timers.advanceBy(1199);
    assert.equal(artwork.getAttribute("data-has-art"), "true", "retains old cover within 2000ms grace");
    pendingMeta.get("song-2")!.resolve(makeMetadata("song-2", "https://lh3.googleusercontent.com/art2=w120-h120"));
    await flushMicrotasks();
    assert.equal(images[1].getAttribute("src"), "https://lh3.googleusercontent.com/art2=w512-h512");
    setImageLoaded(pipDom, images[1]);
    assert.equal(artwork.getAttribute("data-has-art"), "true");
    assert.equal(shell.getAttribute("data-running"), "true", "transition animation triggers within 2000ms grace");
    assert.equal(backdrop.hasAttribute("data-first"), false, "backdrop animates too");
    assert.equal(faces[1].getAttribute("data-front"), "true");

    timers.advanceBy(1100);
    assert.equal(shell.getAttribute("data-running"), "false");

    // 3. Stalls past 2000ms in ON mode -> placeholder shows so stale art does not persist forever.
    dispatchSong("song-3", "Song 3");
    timers.advanceBy(1999);
    assert.equal(artwork.getAttribute("data-has-art"), "true", "still within 2000ms grace");
    timers.advanceBy(2);
    assert.equal(artwork.hasAttribute("data-has-art"), false, "wiped to placeholder after 2000ms");

    pendingMeta.get("song-3")!.resolve(makeMetadata("song-3", "https://lh3.googleusercontent.com/art3=w120-h120"));
    await flushMicrotasks();
    setImageLoaded(pipDom, images[0]);
    assert.equal(artwork.getAttribute("data-has-art"), "true");
    assert.equal(shell.getAttribute("data-running"), "false");
    assert.equal(backdrop.getAttribute("data-first"), "true");

    // 4. All URL fallbacks failing wipes to placeholder immediately without waiting 2000ms.
    dispatchSong("song-4", "Song 4");
    pendingMeta.get("song-4")!.resolve(makeMetadata("song-4", "https://lh3.googleusercontent.com/missing=w120-h120"));
    await flushMicrotasks();
    assert.equal(images[1].getAttribute("src"), "https://lh3.googleusercontent.com/missing=w512-h512");
    setImageError(pipDom, images[1]);
    assert.equal(images[1].getAttribute("src"), "https://i.ytimg.com/vi/song-4/maxresdefault.jpg");
    setImageError(pipDom, images[1]);
    assert.equal(images[1].getAttribute("src"), "https://i.ytimg.com/vi/song-4/hqdefault.jpg");
    setImageError(pipDom, images[1]);
    timers.advanceBy(1);
    assert.equal(artwork.hasAttribute("data-has-art"), false, "all fallbacks failed -> placeholder shown");

    // 5. Instant square playerResponse thumbnail starts at 0ms even if metadata times out at 5000ms.
    dispatchSong("song-5", "Song 5", {
      url: "https://lh3.googleusercontent.com/art5=w544-h544-s-l90-rj",
      isSquare: true,
    });
    timers.advanceBy(0);
    assert.equal(images[1].getAttribute("src"), "https://lh3.googleusercontent.com/art5=w512-h512-s-l90-rj");
    setImageLoaded(pipDom, images[1]);
    assert.equal(artwork.getAttribute("data-has-art"), "true");
    assert.equal(faces[1].getAttribute("data-front"), "true");
    timers.advanceBy(5000);
    pendingMeta.get("song-5")!.resolve(null);
    await flushMicrotasks();
    assert.equal(artwork.getAttribute("data-has-art"), "true");

    // 6. DOM #song-image img update at 100ms loads and animates cleanly, and late matching /next dedupes.
    const songImageBox = sourceDoc.createElement("div");
    songImageBox.id = "song-image";
    const songImageEl = sourceDoc.createElement("img");
    songImageEl.src = "https://lh3.googleusercontent.com/art5=w544-h544-s-l90-rj";
    songImageBox.appendChild(songImageEl);
    sourceDoc.body.appendChild(songImageBox);

    dispatchSong("song-6", "Song 6");
    timers.advanceBy(0);
    assert.notEqual(images[0].getAttribute("src"), "https://lh3.googleusercontent.com/art6=w512-h512-l90-rj");
    songImageEl.src = "https://lh3.googleusercontent.com/art6=w120-h120-l90-rj";
    timers.advanceBy(100);
    assert.equal(images[0].getAttribute("src"), "https://lh3.googleusercontent.com/art6=w512-h512-l90-rj");
    setImageLoaded(pipDom, images[0]);
    assert.equal(shell.getAttribute("data-running"), "true", "DOM thumbnail switch triggers transition animation");
    assert.equal(faces[0].getAttribute("data-front"), "true");
    timers.advanceBy(1100);
    assert.equal(shell.getAttribute("data-running"), "false");

    pendingMeta.get("song-6")!.resolve(makeMetadata("song-6", "https://lh3.googleusercontent.com/art6=w544-h544"));
    await flushMicrotasks();
    assert.equal(shell.getAttribute("data-running"), "false", "same Google asset does not trigger duplicate swap");

    // 7. Missing metadata + no player/DOM thumbnail starts fallback at 350ms instead of blocking 5000ms.
    songImageBox.remove();
    dispatchSong("song-7", "Song 7");
    timers.advanceBy(350);
    assert.equal(images[1].getAttribute("src"), "https://i.ytimg.com/vi/song-7/maxresdefault.jpg");
    setImageLoaded(pipDom, images[1], 1280);
    assert.equal(artwork.getAttribute("data-has-art"), "true");
    assert.equal(shell.getAttribute("data-running"), "true");
    assert.equal(faces[1].getAttribute("data-front"), "true");
    timers.advanceBy(5000);
    pendingMeta.get("song-7")!.resolve(null);
    await flushMicrotasks();
    assert.equal(artwork.getAttribute("data-has-art"), "true");

    // 8. Turning Performance toggle back OFF mid-session reverts immediately to 600ms upstream behavior.
    timers.advanceBy(1100);
    fastArtworkEnabled = false;
    dispatchSong("off-3", "Off Song 3");
    timers.advanceBy(601);
    assert.equal(artwork.hasAttribute("data-has-art"), false, "reverting toggle OFF restores 600ms grace");

    pipWin.dispatchEvent(new pipDom.window.Event("pagehide"));
    void view;
    console.log("pip lyricsView artwork grace self-check passed");
  } finally {
    Object.assign(globalRecord, savedGlobals);
  }
}

void run().catch(error => {
  console.error(error);
  process.exit(1);
});
