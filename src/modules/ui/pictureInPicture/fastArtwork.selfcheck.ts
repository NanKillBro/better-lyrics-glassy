import { strict as assert } from "node:assert";
import { JSDOM } from "jsdom";
import {
  FAST_ARTWORK_STALE_GRACE_MS,
  getArtworkAssetKey,
  isSquareArtworkUrl,
  normalizePipArtworkUrl,
  preloadFastPipNextArtwork,
  readSourceDomThumbnails,
} from "@modules/ui/pictureInPicture/fastArtwork";

async function run(): Promise<void> {
  assert.equal(FAST_ARTWORK_STALE_GRACE_MS, 2000);

  // 1. URL normalization upgrades Google dimensions and strips signed ytimg query params.
  assert.equal(
    normalizePipArtworkUrl("https://lh3.googleusercontent.com/abc=w120-h120-s-l90-rj"),
    "https://lh3.googleusercontent.com/abc=w512-h512-s-l90-rj"
  );
  assert.equal(
    normalizePipArtworkUrl("https://i.ytimg.com/vi/vid1/hqdefault.jpg?sqp=-oaymwEc&rs=AOn4CL"),
    "https://i.ytimg.com/vi/vid1/maxresdefault.jpg"
  );

  // 2. Google CDN asset keys collapse different crop/quality params for the same image.
  assert.equal(
    getArtworkAssetKey("https://lh3.googleusercontent.com/art6=w120-h120-l90-rj"),
    getArtworkAssetKey("https://lh3.googleusercontent.com/art6=w544-h544")
  );
  assert.equal(
    getArtworkAssetKey("https://yt3.ggpht.com/avatar1=w60-h60"),
    "https://yt3.ggpht.com/avatar1"
  );
  assert.notEqual(
    getArtworkAssetKey("https://lh3.googleusercontent.com/art1=w512-h512"),
    getArtworkAssetKey("https://lh3.googleusercontent.com/art2=w512-h512")
  );

  // 3. DOM candidate extraction skips data URIs and detects square crops.
  assert.equal(isSquareArtworkUrl("https://lh3.googleusercontent.com/a=w226-h226-rj"), true);
  assert.equal(isSquareArtworkUrl("https://lh3.googleusercontent.com/a=w400-h225-rj"), false);

  const dom = new JSDOM(`
    <!doctype html>
    <html><body>
      <div id="song-image"><img src="https://lh3.googleusercontent.com/square1=w120-h120-rj" /></div>
      <div id="thumbnail"><img id="img" src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" /></div>
    </body></html>
  `);
  const candidates = readSourceDomThumbnails(dom.window.document);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].isSquare, true);
  assert.equal(candidates[0].assetKey, "https://lh3.googleusercontent.com/square1");

  // 4. Next-song preloader resolves audio counterparts and skips when PiP is closed.
  const preloaded: string[] = [];
  await preloadFastPipNextArtwork({
    currentVideoId: "cur-1",
    getSongMetadata: async id => {
      if (id === "cur-1") return { id: "cur-1", nextVideoId: "vid-2", counterpartVideoId: "cur-audio" };
      if (id === "cur-audio") return { id: "cur-audio", nextVideoId: "audio-2" };
      if (id === "vid-2") return { id: "vid-2", isVideo: true };
      if (id === "audio-2") {
        return {
          id: "audio-2",
          isVideo: false,
          thumbnail: { url: "https://i.ytimg.com/vi/audio-2/hqdefault.jpg?sqp=1" },
        };
      }
      return null;
    },
    getArtworkMetadata: async id =>
      id === "audio-2" ? { thumbnail: { url: "https://lh3.googleusercontent.com/next=w120-h120" } } : null,
    isPipOpen: () => true,
    preloadImage: url => preloaded.push(url),
  });
  assert.deepEqual(preloaded, ["https://lh3.googleusercontent.com/next=w512-h512"]);

  preloaded.length = 0;
  await preloadFastPipNextArtwork({
    currentVideoId: "cur-1",
    prefetchedNext: { id: "next-2", thumbnail: { url: "https://lh3.googleusercontent.com/p=w120-h120" } },
    getArtworkMetadata: async () => null,
    isPipOpen: () => false,
    preloadImage: url => preloaded.push(url),
  });
  assert.deepEqual(preloaded, []);

  console.log("pip fastArtwork self-check passed");
}

void run().catch(error => {
  console.error(error);
  process.exit(1);
});
