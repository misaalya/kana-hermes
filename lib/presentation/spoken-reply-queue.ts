type SpokenReply = {
  id: string;
  reveal: () => Promise<void>;
  speak: (reveal: () => void) => Promise<void>;
  onError: (error: unknown) => void;
  onFinished: () => void;
};

type PendingReply = SpokenReply & { cancelled: boolean; revealed?: Promise<void> };

/** Keep each reply until its own audio starts; failures cannot poison later turns. */
export class SpokenReplyQueue {
  private readonly pending = new Map<string, PendingReply>();
  private chain: Promise<void> = Promise.resolve();

  get active(): boolean { return this.pending.size > 0; }

  enqueue(reply: SpokenReply): void {
    if (this.pending.has(reply.id)) return;
    const job: PendingReply = { ...reply, cancelled: false };
    this.pending.set(job.id, job);
    this.chain = this.chain.then(async () => {
      if (job.cancelled) return;
      try {
        await job.speak(() => {
          if (!job.cancelled) void this.reveal(job);
        });
      } catch (error) {
        if (!job.cancelled && !(error instanceof DOMException && error.name === "AbortError")) {
          job.onError(error);
        }
      } finally {
        if (!job.cancelled) {
          await this.reveal(job);
          this.pending.delete(job.id);
          job.onFinished();
        }
      }
    }).catch((error) => {
      this.pending.delete(job.id);
      if (!job.cancelled) job.onError(error);
    });
  }

  /** Caller stops the voice provider too. A cancelled queue never starts stale audio. */
  cancel(reveal = true): void {
    for (const job of this.pending.values()) {
      job.cancelled = true;
      if (reveal) void this.reveal(job);
    }
    this.pending.clear();
    this.chain = Promise.resolve();
  }

  private reveal(job: PendingReply): Promise<void> {
    // Invoke synchronously so React sees the text in the audio-start callback.
    if (!job.revealed) {
      try { job.revealed = job.reveal().catch(job.onError); }
      catch (error) { job.onError(error); job.revealed = Promise.resolve(); }
    }
    return job.revealed;
  }
}
