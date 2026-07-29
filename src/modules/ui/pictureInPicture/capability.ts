import type {
  DocumentPictureInPicture,
  DocumentPictureInPictureWindowOptions,
  PictureInPictureCapability,
} from "./types";

function isDocumentPictureInPicture<TWindow>(value: unknown): value is DocumentPictureInPicture<TWindow> {
  return (
    typeof value === "object" && value !== null && "requestWindow" in value && typeof value.requestWindow === "function"
  );
}

function createElectronPictureInPictureApi<TWindow = Window>(): DocumentPictureInPicture<TWindow> {
  return {
    requestWindow(options: DocumentPictureInPictureWindowOptions): Promise<TWindow> {
      console.log("[BL-PiP] Requesting Electron Picture-in-Picture window via window.open", options);
      const width = options.width || 540;
      const height = options.height || 200;
      const features = `width=${width},height=${height},alwaysOnTop=yes,resizable=yes`;
      const pipWin = window.open("about:blank", "BetterLyricsPiP", features);
      if (!pipWin) {
        return Promise.reject(new Error("Failed to open Picture-in-Picture window in Electron: window.open returned null"));
      }
      return Promise.resolve(pipWin as unknown as TWindow);
    },
  };
}

export function getPictureInPictureCapability<TWindow = Window>(host: object): PictureInPictureCapability<TWindow> {
  const isElectron =
    typeof navigator !== "undefined" &&
    navigator.userAgent &&
    (navigator.userAgent.includes("Electron") ||
      (typeof window !== "undefined" && Boolean((window as unknown as Record<string, unknown>).electronBL)));

  if (isElectron) {
    console.log("[BL-PiP] Capability check: Electron environment detected, using Electron PiP API wrapper");
    return { kind: "supported", api: createElectronPictureInPictureApi<TWindow>() };
  }

  let candidate: unknown = undefined;
  let source = "none";

  if (
    typeof host === "object" &&
    host !== null &&
    "documentPictureInPicture" in host &&
    (host as Record<string, unknown>).documentPictureInPicture
  ) {
    candidate = (host as Record<string, unknown>).documentPictureInPicture;
    source = "host";
  } else if (
    typeof globalThis === "object" &&
    globalThis !== null &&
    "documentPictureInPicture" in globalThis &&
    (globalThis as Record<string, unknown>).documentPictureInPicture
  ) {
    candidate = (globalThis as Record<string, unknown>).documentPictureInPicture;
    source = "globalThis";
  } else if (typeof window !== "undefined" && window !== null) {
    if ("documentPictureInPicture" in window && (window as Record<string, unknown>).documentPictureInPicture) {
      candidate = (window as Record<string, unknown>).documentPictureInPicture;
      source = "window";
    } else {
      try {
        if (
          window.top &&
          "documentPictureInPicture" in window.top &&
          (window.top as Record<string, unknown>).documentPictureInPicture
        ) {
          candidate = (window.top as Record<string, unknown>).documentPictureInPicture;
          source = "window.top";
        }
      } catch {
        // Ignore cross-origin frame restriction
      }
    }
  }

  if (!candidate) {
    console.log("[BL-PiP] Capability check: missing documentPictureInPicture API in host/global window context");
    return { kind: "missing" };
  }

  if (!isDocumentPictureInPicture<TWindow>(candidate)) {
    console.warn("[BL-PiP] Capability check: malformed documentPictureInPicture API candidate", { source, candidate });
    return { kind: "malformed" };
  }

  console.log(`[BL-PiP] Capability check: supported (found via ${source})`);
  return { kind: "supported", api: candidate as DocumentPictureInPicture<TWindow> };
}
