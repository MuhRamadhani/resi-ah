// Extract frames from a video, crop mutation list area, then binarize + upscale
// so gray/light text (like transaction times) becomes OCR-friendly.

export interface CropRect {
  top: number; // 0..1
  bottom: number; // 0..1
  left: number;
  right: number;
}

export interface FrameOut {
  index: number;
  time: number;
  canvas: HTMLCanvasElement;
}

export interface ExtractOptions {
  fps: number;
  maxFps: number;
  crop: CropRect;
  upscale?: number; // default 2
  threshold?: number; // 0..255, default 205
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

function binarizeUpscale(
  src: HTMLCanvasElement,
  scale: number,
  threshold: number,
): HTMLCanvasElement {
  const w = src.width;
  const h = src.height;
  const out = document.createElement("canvas");
  out.width = Math.round(w * scale);
  out.height = Math.round(h * scale);
  const octx = out.getContext("2d")!;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(src, 0, 0, out.width, out.height);
  const img = octx.getImageData(0, 0, out.width, out.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    // luminance
    const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const v = l < threshold ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  octx.putImageData(img, 0, 0);
  return out;
}

export async function extractFrames(
  file: File | Blob,
  opts: ExtractOptions,
): Promise<{ frames: FrameOut[]; duration: number; totalConsidered: number }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.src = url;

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Gagal load video"));
  });

  const duration = video.duration;
  const w = video.videoWidth;
  const h = video.videoHeight;
  const cropX = Math.floor(w * opts.crop.left);
  const cropY = Math.floor(h * opts.crop.top);
  const cropW = Math.max(1, Math.floor(w * (1 - opts.crop.left - opts.crop.right)));
  const cropH = Math.max(1, Math.floor(h * (1 - opts.crop.top - opts.crop.bottom)));
  const scale = opts.upscale ?? 2;
  const threshold = opts.threshold ?? 205;

  const frames: FrameOut[] = [];
  const interval = 1 / Math.max(0.25, opts.fps);
  const total = Math.max(1, Math.ceil(duration / interval));
  let idx = 0;

  const rawCanvas = document.createElement("canvas");
  rawCanvas.width = cropW;
  rawCanvas.height = cropH;
  const rctx = rawCanvas.getContext("2d", { willReadFrequently: true })!;

  let t = 0;
  while (t < duration) {
    if (opts.signal?.aborted) throw new Error("Aborted");

    await new Promise<void>((resolve) => {
      const onSeek = () => {
        video.removeEventListener("seeked", onSeek);
        resolve();
      };
      video.addEventListener("seeked", onSeek);
      video.currentTime = Math.min(t, Math.max(0, duration - 0.05));
      setTimeout(() => {
        video.removeEventListener("seeked", onSeek);
        resolve();
      }, 2000);
    });

    rctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
    const processed = binarizeUpscale(rawCanvas, scale, threshold);
    frames.push({ index: idx++, time: t, canvas: processed });

    opts.onProgress?.(idx, total);
    t += interval;
  }

  URL.revokeObjectURL(url);
  return { frames, duration, totalConsidered: total };
}
