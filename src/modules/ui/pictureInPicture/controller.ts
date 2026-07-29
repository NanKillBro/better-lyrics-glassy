import { getPictureInPictureCapability } from "./capability";
import type {
  DocumentPictureInPicture,
  DocumentPictureInPictureWindowOptions,
  PictureInPictureControllerDependencies,
} from "./types";

const REQUEST_OPTIONS = {
  width: 540,
  height: 200,
  disallowReturnToOpener: true,
} as const satisfies DocumentPictureInPictureWindowOptions;

export class PictureInPictureController<TWindow> {
  private activeWindow: TWindow | null = null;
  private isOpening = false;

  constructor(private readonly dependencies: PictureInPictureControllerDependencies<TWindow>) {}

  isSupported(): boolean {
    return getPictureInPictureCapability<TWindow>(this.dependencies.host).kind === "supported";
  }

  isOpen(): boolean {
    return this.activeWindow !== null;
  }

  toggle(): void {
    console.log("[BL-PiP] Controller toggle called", { activeWindow: !!this.activeWindow, isOpening: this.isOpening });
    if (this.activeWindow !== null) {
      this.closeActiveWindow();
      return;
    }

    if (this.isOpening) return;
    this.open();
  }

  private open(): void {
    const capability = getPictureInPictureCapability<TWindow>(this.dependencies.host);
    console.log("[BL-PiP] Controller open called", { capabilityKind: capability.kind });
    if (capability.kind === "supported") this.requestWindow(capability.api);
    else console.warn("[BL-PiP] Cannot open PiP: capability is not supported", capability);
  }

  private requestWindow(api: DocumentPictureInPicture<TWindow>): void {
    this.isOpening = true;
    console.log("[BL-PiP] Calling api.requestWindow() with options", REQUEST_OPTIONS);

    let request: Promise<TWindow>;
    try {
      // Keep this call directly in the dock click stack; user activation does not survive an await.
      request = api.requestWindow(REQUEST_OPTIONS);
    } catch (error) {
      console.warn("[BL-PiP] api.requestWindow() with disallowReturnToOpener failed, trying fallback options", error);
      try {
        request = api.requestWindow({ width: 540, height: 200 });
      } catch (fallbackError) {
        this.isOpening = false;
        console.error("[BL-PiP] Synchronous exception during api.requestWindow()", fallbackError);
        this.dependencies.reportFailure("Document Picture-in-Picture request failed", fallbackError);
        return;
      }
    }

    void request
      .then(pipWindow => {
        console.log("[BL-PiP] api.requestWindow() promise resolved successfully");
        this.initialize(pipWindow);
      })
      .catch(error => this.handleRequestFailure(error));
  }

  private handleRequestFailure(error: unknown): void {
    this.isOpening = false;
    console.error("[BL-PiP] api.requestWindow() promise rejected", error);
    this.dependencies.reportFailure("Document Picture-in-Picture request failed", error);
  }

  private initialize(pipWindow: TWindow): void {
    this.isOpening = false;
    this.activeWindow = pipWindow;
    const winObj = pipWindow as unknown as Window;

    console.log("[BL-PiP] Initializing PiP window shell", {
      closed: winObj?.closed,
      width: winObj?.innerWidth,
      height: winObj?.innerHeight,
      readyState: winObj?.document?.readyState,
      location: winObj?.location?.href,
    });

    // Monitor window state over the first 3 seconds
    [50, 200, 500, 1000, 2000, 3000].forEach(delay => {
      setTimeout(() => {
        console.log(`[BL-PiP Status Check +${delay}ms]`, {
          isOpen: this.isOpen(),
          activeWindowMatches: this.activeWindow === pipWindow,
          closed: winObj?.closed,
          documentTitle: winObj?.document?.title,
          bodyChildCount: winObj?.document?.body?.children?.length,
          visibilityState: winObj?.document?.visibilityState,
        });
      }, delay);
    });

    this.dependencies.observePageHide(pipWindow, () => {
      console.log("[BL-PiP] PiP window pagehide/unload event trigger received");
      if (this.activeWindow === pipWindow) this.reset();
    });

    try {
      this.dependencies.renderLoadingShell(pipWindow);
      console.log("[BL-PiP] Rendered loading shell into PiP window");
    } catch (error) {
      console.error("[BL-PiP] Error rendering loading shell", error);
      this.dependencies.reportFailure("Document Picture-in-Picture shell setup failed", error);
      this.closeWindowIfActive(pipWindow);
      return;
    }

    void this.injectStyles(pipWindow);
  }

  private async injectStyles(pipWindow: TWindow): Promise<void> {
    try {
      console.log("[BL-PiP] Fetching and injecting stylesheet into PiP window");
      const stylesheet = await this.dependencies.loadStylesheet();
      if (this.activeWindow !== pipWindow) return;
      this.dependencies.injectStylesheet(pipWindow, stylesheet);
      console.log("[BL-PiP] Stylesheet successfully injected into PiP window");
    } catch (error) {
      console.error("[BL-PiP] Error injecting styles into PiP window", error);
      this.dependencies.reportFailure("Document Picture-in-Picture stylesheet injection failed", error);
      this.closeWindowIfActive(pipWindow);
    }
  }

  private closeActiveWindow(): void {
    const pipWindow = this.activeWindow;
    if (pipWindow === null) return;

    this.reset();
    this.dependencies.closeWindow(pipWindow);
  }

  private closeWindowIfActive(pipWindow: TWindow): void {
    if (this.activeWindow === pipWindow) this.closeActiveWindow();
  }

  private reset(): void {
    this.activeWindow = null;
    this.isOpening = false;
  }
}
