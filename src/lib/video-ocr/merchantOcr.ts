// Tesseract.js worker pool
import { createWorker, type Worker } from "tesseract.js";

let workers: Worker[] = [];
let queue: Array<() => void> = [];
let inflight = 0;

async function ensureWorkers(count = 3) {
  if (workers.length >= count) return;
  const need = count - workers.length;
  const created = await Promise.all(
    Array.from({ length: need }).map(async () => {
      const w = await createWorker("ind+eng");
      await w.setParameters({
        tessedit_char_whitelist:
          "0123456789Rp.,:/ ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
        preserve_interword_spaces: "1",
      });
      return w;
    }),
  );
  workers.push(...created);
}

export async function terminateWorkers() {
  for (const w of workers) {
    try {
      await w.terminate();
    } catch {}
  }
  workers = [];
}

async function acquire(): Promise<Worker> {
  await ensureWorkers();
  while (inflight >= workers.length) {
    await new Promise<void>((res) => queue.push(res));
  }
  inflight++;
  return workers[inflight % workers.length];
}

function release() {
  inflight--;
  const next = queue.shift();
  if (next) next();
}

export interface OcrLine {
  text: string;
  confidence: number;
}

export interface OcrResult {
  text: string;
  lines: OcrLine[];
  avgConfidence: number;
}

export async function ocrCanvas(canvas: HTMLCanvasElement): Promise<OcrResult> {
  const w = await acquire();
  try {
    const { data } = await w.recognize(canvas);
    const lines: OcrLine[] = (data.lines || []).map((l: any) => ({
      text: l.text || "",
      confidence: Number(l.confidence) || 0,
    }));
    return {
      text: data.text || "",
      lines,
      avgConfidence: Number(data.confidence) || 0,
    };
  } finally {
    release();
  }
}
