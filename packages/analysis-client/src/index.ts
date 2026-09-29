import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";

// Framed-JSON stdio bridge to the Python worker (§14). Playback never blocks:
// analyze() queues; crashes requeue (§109); large artifacts travel by path.
export interface AnalyzeRequest { trackId: string; audioPath: string; nativeMetadataPath?: string }
export interface AnalyzeResult { type: "complete"; trackId: string; artifactPath: string }

export class AnalysisClient {
  private proc: ChildProcess | null = null;
  private pending = new Map<string, { resolve: (r: AnalyzeResult) => void; reject: (e: Error) => void }>();
  private queue: AnalyzeRequest[] = [];

  constructor(private readonly command = "uv", private readonly projectDir = "../../analysis") {}

  start(): void {
    if (this.proc) return;
    this.proc = spawn(this.command, ["run", "--project", this.projectDir, "python", "-m", "autolight_analysis.worker"], { stdio: ["pipe", "pipe", "inherit"] });
    const rl = createInterface({ input: this.proc.stdout! });
    rl.on("line", (line) => this.onLine(line));
    this.proc.on("exit", () => {
      this.proc = null;
      // Requeue interrupted jobs on restart (§109, §14).
      for (const [id, p] of this.pending) {
        this.queue.unshift({ trackId: id, audioPath: "" });
        p.reject(new Error("worker exited, requeued"));
      }
      this.pending.clear();
    });
  }

  analyze(req: AnalyzeRequest): Promise<AnalyzeResult> {
    const { promise, resolve, reject } = Promise.withResolvers<AnalyzeResult>();
    this.pending.set(req.trackId, { resolve, reject });
    this.send({ type: "analyze", ...req });
    return promise;
  }

  handleMessage(msg: { type: string; trackId?: string; artifactPath?: string; error?: string }): void {
    const id = msg.trackId;
    if (!id) return;
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    if (msg.type === "complete" && msg.artifactPath) p.resolve({ type: "complete", trackId: id, artifactPath: msg.artifactPath });
    else p.reject(new Error(msg.error ?? "analysis failed"));
  }

  pendingCount(): number {
    return this.pending.size;
  }

  requeue(req: AnalyzeRequest): void {
    this.queue.unshift(req);
  }

  queuedCount(): number {
    return this.queue.length;
  }

  stop(): void {
    this.proc?.kill();
    this.proc = null;
  }

  private send(msg: unknown): void {
    this.proc?.stdin?.write(JSON.stringify(msg) + "\n");
  }

  private onLine(line: string): void {
    try {
      this.handleMessage(JSON.parse(line) as { type: string; trackId?: string; artifactPath?: string; error?: string });
    } catch {
      // Malformed worker line: ignore, job stays pending for retry.
    }
  }
}
