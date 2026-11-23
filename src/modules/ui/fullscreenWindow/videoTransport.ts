import { pickVideoTrack } from "@modules/ui/pictureInPicture/videoMirrorState";

/**
 * Zero-reencode cross-process video bridge over Electron `MessagePort`.
 *
 * Pulls decoded `VideoFrame`s from the main player via `video.captureStream()` +
 * `MediaStreamTrackProcessor` (independent of `requestVideoFrameCallback` so hidden/minimized or
 * occluded windows do not stall capture) and transfers GPU-backed `ImageBitmap` handles at native
 * resolution into `MediaStreamTrackGenerator` (`<video id="blfw-mv-video">`).
 */

const ASPECT_RATIO_EPSILON = 0.005;
const INFLIGHT_TIMEOUT_MS = 2_000;

export type VideoPortWireMessage =
  | {
      readonly kind: "frame";
      readonly gen: number;
      readonly ts: number;
      readonly aspectRatio: number;
      readonly bitmap: ImageBitmap;
    }
  | { readonly kind: "ack"; readonly gen: number }
  | { readonly kind: "reset" };

export interface VideoFrameSender {
  attachPort(port: MessagePort): void;
  setActive(active: boolean, source: HTMLVideoElement | null): void;
  captureOne(): void;
  pause(): void;
  stop(): void;
  destroy(): void;
}

export interface VideoFrameReceiver {
  attachPort(port: MessagePort): void;
  clear(): void;
  destroy(): void;
}

type CapturableVideo = HTMLVideoElement & {
  captureStream?: () => MediaStream;
  requestVideoFrameCallback?: (cb: (now: number, metadata: VideoFrameCallbackMetadata) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

interface MediaStreamTrackProcessorInit {
  track: MediaStreamTrack;
}

declare const MediaStreamTrackProcessor:
  | {
      new (init: MediaStreamTrackProcessorInit): {
        readonly readable: ReadableStream<VideoFrame>;
      };
    }
  | undefined;

interface MediaStreamTrackGeneratorInit {
  kind: "video" | "audio";
}

declare const MediaStreamTrackGenerator:
  | {
      new (init: MediaStreamTrackGeneratorInit): MediaStreamTrack & {
        readonly writable: WritableStream<VideoFrame>;
      };
    }
  | undefined;

function closeFrameQuietly(frame: VideoFrame | null | undefined): void {
  if (!frame) return;
  try {
    frame.close();
  } catch {
    // Already closed.
  }
}

function closeBitmapQuietly(bitmap: ImageBitmap | null | undefined): void {
  if (!bitmap) return;
  try {
    bitmap.close();
  } catch {
    // Already closed.
  }
}

export function createVideoFrameSender(): VideoFrameSender {
  let port: MessagePort | null = null;
  let active = false;
  let video: CapturableVideo | null = null;
  let captureStream: MediaStream | null = null;
  let captureVideo: CapturableVideo | null = null;
  let streamAbort: AbortController | null = null;
  let activeTrack: MediaStreamTrack | null = null;
  let activeReader: ReadableStreamDefaultReader<VideoFrame> | null = null;
  let trackAbort: AbortController | null = null;
  let vfcId: number | null = null;

  let captureEpoch = 0;
  let trackEpoch = 0;
  let sendSeq = 0;
  let inFlightSeq: number | null = null;
  let inFlightAt = 0;
  let convertSeq = 0;
  let activeConvertSeq: number | null = null;
  let pendingFrame: VideoFrame | null = null;
  let pendingSnapshot = false;
  let lastTs = -1;

  const isVideoReady = (el: HTMLVideoElement | null): el is CapturableVideo =>
    Boolean(
      el &&
        el.isConnected &&
        el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        el.videoWidth > 0 &&
        el.videoHeight > 0,
    );

  const nextTimestampUs = (preferredUs?: number): number => {
    const candidate =
      typeof preferredUs === "number" && Number.isFinite(preferredUs)
        ? Math.round(preferredUs)
        : Math.round(performance.now() * 1000);
    const ts = candidate > lastTs ? candidate : lastTs + 1000;
    lastTs = ts;
    return ts;
  };

  const resetInFlight = (): void => {
    sendSeq += 1;
    convertSeq += 1;
    inFlightSeq = null;
    inFlightAt = 0;
    activeConvertSeq = null;
    pendingSnapshot = false;
    closeFrameQuietly(pendingFrame);
    pendingFrame = null;
  };

  const stopFallbackLoop = (): void => {
    if (vfcId !== null && video?.cancelVideoFrameCallback) {
      video.cancelVideoFrameCallback(vfcId);
    }
    vfcId = null;
  };

  const stopTrackReader = (): void => {
    trackEpoch += 1;
    trackAbort?.abort();
    trackAbort = null;
    activeTrack = null;
    if (activeReader) {
      const reader = activeReader;
      activeReader = null;
      void reader.cancel().catch(() => undefined);
    }
  };

  const stopCapture = (): void => {
    captureEpoch += 1;
    stopFallbackLoop();
    stopTrackReader();
    streamAbort?.abort();
    streamAbort = null;
    if (captureStream) {
      for (const track of captureStream.getTracks()) {
        try {
          track.stop();
        } catch {
          // Track already ended.
        }
      }
      captureStream = null;
    }
    captureVideo = null;
    resetInFlight();
  };

  const isBusy = (): boolean => {
    if (activeConvertSeq !== null) return true;
    if (inFlightSeq === null) return false;
    if (performance.now() - inFlightAt > INFLIGHT_TIMEOUT_MS) {
      inFlightSeq = null;
      return false;
    }
    return true;
  };

  const sendBitmapFrom = async (source: VideoFrame | CapturableVideo, snapshotFallback = false): Promise<void> => {
    if (!active || !port || typeof createImageBitmap !== "function") {
      if (source instanceof VideoFrame) closeFrameQuietly(source);
      return;
    }

    const expectedCaptureEpoch = captureEpoch;
    const expectedPort = port;

    let aspectRatio = 16 / 9;
    let preferredTs: number | undefined;
    if (source instanceof VideoFrame) {
      const w = source.displayWidth || source.codedWidth;
      const h = source.displayHeight || source.codedHeight;
      if (w <= 0 || h <= 0) {
        closeFrameQuietly(source);
        return;
      }
      aspectRatio = w / h;
      preferredTs = source.timestamp;
    } else {
      if (!isVideoReady(source)) return;
      aspectRatio = source.videoWidth / source.videoHeight;
    }

    const myConvertSeq = ++convertSeq;
    activeConvertSeq = myConvertSeq;
    let bitmap: ImageBitmap | null = null;
    let failed = false;
    try {
      bitmap = await createImageBitmap(source);
    } catch {
      failed = true;
    } finally {
      if (activeConvertSeq === myConvertSeq) activeConvertSeq = null;
      if (source instanceof VideoFrame) closeFrameQuietly(source);
    }

    if (failed || !bitmap) {
      if (expectedCaptureEpoch === captureEpoch && active && port === expectedPort) {
        queueMicrotask(drainPending);
      }
      return;
    }

    if (expectedCaptureEpoch !== captureEpoch || !active || port !== expectedPort) {
      closeBitmapQuietly(bitmap);
      return;
    }

    const seq = ++sendSeq;
    inFlightSeq = seq;
    inFlightAt = performance.now();
    const msg: VideoPortWireMessage = {
      kind: "frame",
      gen: seq,
      ts: nextTimestampUs(preferredTs),
      aspectRatio,
      bitmap,
    };
    try {
      expectedPort.postMessage(msg, [bitmap]);
    } catch {
      closeBitmapQuietly(bitmap);
      if (inFlightSeq === seq) inFlightSeq = null;
      if (snapshotFallback) pendingSnapshot = false;
    }
  };

  const drainPending = (): void => {
    if (!active || !port || isBusy()) return;
    if (pendingFrame) {
      const next = pendingFrame;
      pendingFrame = null;
      pendingSnapshot = false;
      void sendBitmapFrom(next);
      return;
    }
    if (pendingSnapshot && video) {
      pendingSnapshot = false;
      void sendBitmapFrom(video, true);
    }
  };

  const enqueueFrame = (frame: VideoFrame): void => {
    if (!active || !port) {
      closeFrameQuietly(frame);
      return;
    }
    if (isBusy()) {
      closeFrameQuietly(pendingFrame);
      pendingFrame = frame;
      pendingSnapshot = false;
      return;
    }
    void sendBitmapFrom(frame);
  };

  const requestElementSnapshot = (): void => {
    if (!active || !port || !isVideoReady(video)) return;
    if (isBusy()) {
      if (!pendingFrame) pendingSnapshot = true;
      return;
    }
    void sendBitmapFrom(video, true);
  };

  const startFallbackLoop = (): void => {
    stopFallbackLoop();
    if (!active || !port || !video || activeTrack) return;
    if (typeof video.requestVideoFrameCallback !== "function") return;
    vfcId = video.requestVideoFrameCallback(() => {
      vfcId = null;
      if (!active || !video || activeTrack) return;
      requestElementSnapshot();
      startFallbackLoop();
    });
  };

  const pumpTrack = (track: MediaStreamTrack): boolean => {
    if (typeof MediaStreamTrackProcessor === "undefined") return false;
    stopTrackReader();
    const localCaptureEpoch = captureEpoch;
    const localTrackEpoch = ++trackEpoch;
    let reader: ReadableStreamDefaultReader<VideoFrame>;
    try {
      const processor = new MediaStreamTrackProcessor({ track });
      reader = processor.readable.getReader();
    } catch {
      return false;
    }

    activeTrack = track;
    activeReader = reader;
    const controller = new AbortController();
    trackAbort = controller;
    track.addEventListener(
      "ended",
      () => {
        if (localTrackEpoch !== trackEpoch || localCaptureEpoch !== captureEpoch) return;
        syncStreamTrack();
      },
      { once: true, signal: controller.signal },
    );
    stopFallbackLoop();

    void (async () => {
      try {
        while (localTrackEpoch === trackEpoch && localCaptureEpoch === captureEpoch && active) {
          const { value: frame, done } = await reader.read();
          if (done || !frame) break;
          if (localTrackEpoch !== trackEpoch || localCaptureEpoch !== captureEpoch || !active) {
            closeFrameQuietly(frame);
            break;
          }
          enqueueFrame(frame);
        }
      } catch {
        // Track stopped or video reloaded; `addtrack` / `captureOne` rebinds cleanly.
      } finally {
        if (activeReader === reader) activeReader = null;
        if (localTrackEpoch === trackEpoch && activeTrack === track) {
          activeTrack = null;
          if (active && port && video && localCaptureEpoch === captureEpoch) {
            startFallbackLoop();
          }
        }
        void reader.cancel().catch(() => undefined);
      }
    })();

    return true;
  };

  function syncStreamTrack(): void {
    if (!active || !port || !captureStream) return;
    const newest = pickVideoTrack(captureStream.getTracks());
    for (const track of captureStream.getTracks()) {
      if (track !== newest) {
        try {
          track.stop();
        } catch {
          // Ignore old track stop errors.
        }
        try {
          captureStream.removeTrack(track);
        } catch {
          // Ignore track removal errors.
        }
      }
    }
    if (!newest || newest.readyState === "ended") {
      stopTrackReader();
      startFallbackLoop();
      return;
    }
    if (newest === activeTrack && activeReader) return;
    if (!pumpTrack(newest)) {
      startFallbackLoop();
    }
  }

  const ensureCapture = (): void => {
    if (!active || !port || !video) return;
    if (captureVideo === video && captureStream) {
      syncStreamTrack();
      return;
    }
    stopCapture();
    if (typeof video.captureStream !== "function") {
      startFallbackLoop();
      return;
    }
    try {
      const stream = video.captureStream();
      captureStream = stream;
      captureVideo = video;
      const controller = new AbortController();
      streamAbort = controller;
      const resync = (): void => syncStreamTrack();
      stream.addEventListener("addtrack", resync, { signal: controller.signal });
      stream.addEventListener("removetrack", resync, { signal: controller.signal });
      syncStreamTrack();
    } catch {
      captureStream = null;
      captureVideo = null;
      startFallbackLoop();
    }
  };

  const deactivate = (clearVideo: boolean): void => {
    const wasActive = active;
    active = false;
    stopCapture();
    if (wasActive) {
      try {
        port?.postMessage({ kind: "reset" } satisfies VideoPortWireMessage);
      } catch {
        // Port closed.
      }
    }
    if (clearVideo) video = null;
  };

  return {
    attachPort(nextPort: MessagePort): void {
      if (port === nextPort) return;
      if (port) {
        port.onmessage = null;
        try {
          port.close();
        } catch {
          // Ignore old port close errors.
        }
      }
      port = nextPort;
      resetInFlight();
      port.onmessage = (event: MessageEvent<VideoPortWireMessage>) => {
        const msg = event.data;
        if (!msg || msg.kind !== "ack") return;
        if (inFlightSeq !== null && msg.gen === inFlightSeq) {
          inFlightSeq = null;
          drainPending();
        }
      };
      port.start();
      if (active && video) {
        ensureCapture();
        requestElementSnapshot();
      }
    },
    setActive(nextActive: boolean, nextVideo: HTMLVideoElement | null): void {
      if (!nextActive || !nextVideo) {
        deactivate(false);
        video = nextVideo;
        return;
      }
      const wasActive = active;
      const videoChanged = video !== nextVideo;
      active = true;
      video = nextVideo;
      if (videoChanged) stopCapture();
      if (port) {
        ensureCapture();
        if (!wasActive || videoChanged || !activeTrack) {
          requestElementSnapshot();
        }
      }
    },
    captureOne(): void {
      if (!active || !port || !video) return;
      ensureCapture();
      requestElementSnapshot();
    },
    pause(): void {
      active = false;
      stopCapture();
    },
    stop(): void {
      deactivate(false);
    },
    destroy(): void {
      deactivate(true);
      if (port) {
        port.onmessage = null;
        try {
          port.close();
        } catch {
          // Ignore teardown errors.
        }
        port = null;
      }
    },
  };
}

export function createVideoFrameReceiver(
  targetVideo: HTMLVideoElement,
  onFrame: (aspectRatio: number) => void,
  onReset: () => void,
): VideoFrameReceiver {
  let port: MessagePort | null = null;
  let generator: (MediaStreamTrack & { readonly writable: WritableStream<VideoFrame> }) | null = null;
  let writer: WritableStreamDefaultWriter<VideoFrame> | null = null;
  let pipelineGen = 0;
  let hasDeliveredFrame = false;
  let lastAspectRatio = 16 / 9;
  let reportedAspectRatio = 0;
  let lastRecvTs = -1;

  const teardownPipeline = (): void => {
    pipelineGen += 1;
    hasDeliveredFrame = false;
    reportedAspectRatio = 0;
    lastRecvTs = -1;
    if (writer) {
      const closing = writer;
      writer = null;
      void closing.close().catch(() => undefined);
    }
    if (generator) {
      generator.stop();
      generator = null;
    }
    if (targetVideo.srcObject) {
      targetVideo.srcObject = null;
    }
  };

  const ensureStream = (): void => {
    if (generator && writer) return;
    if (typeof MediaStreamTrackGenerator === "undefined") return;
    generator = new MediaStreamTrackGenerator({ kind: "video" });
    writer = generator.writable.getWriter();
    targetVideo.muted = true;
    targetVideo.autoplay = true;
    targetVideo.playsInline = true;
    targetVideo.srcObject = new MediaStream([generator]);
    if (targetVideo.paused) {
      void targetVideo.play().catch(() => undefined);
    }
  };

  const handleMessage = (event: MessageEvent<VideoPortWireMessage>): void => {
    const msg = event.data;
    if (!msg) return;
    if (msg.kind === "reset") {
      teardownPipeline();
      onReset();
      return;
    }
    if (msg.kind !== "frame") return;

    const activePort = port;
    const gen = msg.gen;
    const bitmap = msg.bitmap;
    const localPipelineGen = pipelineGen;

    void (async () => {
      let frame: VideoFrame | null = null;
      try {
        if (Number.isFinite(msg.aspectRatio) && msg.aspectRatio > 0) {
          lastAspectRatio = msg.aspectRatio;
        }
        ensureStream();
        if (!writer || typeof VideoFrame === "undefined") return;

        const rawTs = Number.isFinite(msg.ts) ? msg.ts : Math.round(performance.now() * 1000);
        const ts = rawTs > lastRecvTs ? rawTs : lastRecvTs + 1000;
        lastRecvTs = ts;

        frame = new VideoFrame(bitmap, { timestamp: ts });
        closeBitmapQuietly(bitmap);
        await writer.ready;
        if (localPipelineGen !== pipelineGen || !writer) return;
        await writer.write(frame);
        if (localPipelineGen !== pipelineGen) return;

        if (!hasDeliveredFrame || Math.abs(lastAspectRatio - reportedAspectRatio) > ASPECT_RATIO_EPSILON) {
          hasDeliveredFrame = true;
          reportedAspectRatio = lastAspectRatio;
          onFrame(lastAspectRatio);
        }
      } catch {
        // Ignore single malformed/raced frames cleanly.
      } finally {
        closeFrameQuietly(frame);
        closeBitmapQuietly(bitmap);
        try {
          activePort?.postMessage({ kind: "ack", gen } satisfies VideoPortWireMessage);
        } catch {
          // Port closed during teardown.
        }
      }
    })();
  };

  return {
    attachPort(nextPort: MessagePort): void {
      if (port === nextPort) return;
      if (port) {
        port.onmessage = null;
        try {
          port.close();
        } catch {
          // Ignore old port teardown.
        }
      }
      port = nextPort;
      port.onmessage = handleMessage;
      port.start();
    },
    clear(): void {
      teardownPipeline();
      onReset();
    },
    destroy(): void {
      if (port) {
        port.onmessage = null;
        try {
          port.close();
        } catch {
          // Ignore old port teardown.
        }
        port = null;
      }
      teardownPipeline();
    },
  };
}
