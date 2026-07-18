import { createWorker, type Worker, PSM } from "tesseract.js";

let workers: Worker[] = [];
let queue: Array<() => void> = [];
let inflight = 0;

async function ensureWorkers(count = 2) {
  if (workers.length >= count) return;
  const need = count - workers.length;
  const created = await Promise.all(
    Array.from({ length: need }).map(async () => {
      const w = await createWorker("ind+eng");
      await w.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
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
    const anyData = data as any;
    const rawLines: OcrLine[] = (
      anyData.lines ||
      (data.text || "").split("\n").map((t: string) => ({ text: t, confidence: data.confidence }))
    ).map((l: any) => ({
      text: (l.text || "").replace(/\s+/g, " ").trim(),
      confidence: Number(l.confidence) || 0,
    }));
    return {
      text: data.text || "",
      lines: rawLines.filter((l) => l.text.length > 0),
      avgConfidence: Number(data.confidence) || 0,
    };
  } finally {
    release();
  }
}
