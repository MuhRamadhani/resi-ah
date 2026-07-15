// Extract frames from a video file with adaptive fps.
// Crops to a rect (fraction 0..1) before returning ImageData / canvas.

export interface CropRect {
  top: number; // 0..1
  bottom: number; // 0..1 (distance from bottom)
  left: number;
  right: number;
}

export interface FrameOut {
  index: number;
  time: number;
  canvas: HTMLCanvasElement;
}

export interface ExtractOptions {
  fps: number; // default 1
  maxFps: number; // default 2
  crop: CropRect;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
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
  const cropW = Math.floor(w * (1 - opts.crop.left - opts.crop.right));
  const cropH = Math.floor(h * (1 - opts.crop.top - opts.crop.bottom));

  const frames: FrameOut[] = [];
  let interval = 1 / Math.max(0.25, opts.fps);
  const minInterval = 1 / Math.max(opts.fps, opts.maxFps);
  const total = Math.ceil(duration / interval);
  let idx = 0;

  // Prev grayscale sample for scroll-speed detection
  const sampleCanvas = document.createElement("canvas");
  sampleCanvas.width = 64;
  sampleCanvas.height = 64;
  const sctx = sampleCanvas.getContext("2d", { willReadFrequently: true })!;
  let prevSample: Uint8ClampedArray | null = null;

  const outCanvas = () => {
    const c = document.createElement("canvas");
    c.width = cropW;
    c.height = cropH;
    return c;
  };

  let t = 0;
  while (t < duration) {
    if (opts.signal?.aborted) throw new Error("Aborted");

    await new Promise<void>((resolve, reject) => {
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

    const c = outCanvas();
    const cctx = c.getContext("2d")!;
    cctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
    frames.push({ index: idx++, time: t, canvas: c });

    // Sample for scroll speed
    sctx.drawImage(c, 0, 0, 64, 64);
    const sample = sctx.getImageData(0, 0, 64, 64).data;
    if (prevSample) {
      let diff = 0;
      for (let i = 0; i < sample.length; i += 16) {
        diff += Math.abs(sample[i] - prevSample[i]);
      }
      const norm = diff / (sample.length / 16);
      if (norm > 25 && interval > minInterval) {
        interval = Math.max(minInterval, interval / 2);
      } else if (norm < 8 && interval < 1 / opts.fps) {
        interval = Math.min(1 / opts.fps, interval * 1.5);
      }
    }
    prevSample = sample;

    opts.onProgress?.(idx, total);
    t += interval;
  }

  URL.revokeObjectURL(url);
  return { frames, duration, totalConsidered: total };
}
