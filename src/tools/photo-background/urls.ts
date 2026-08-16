export class SlotUrlManager {
  private slots = new Map<string, string>();
  private closed = false;

  constructor(
    private readonly createObjectUrl: (blob: Blob) => string = (blob) => URL.createObjectURL(blob),
    private readonly revokeObjectUrl: (url: string) => void = (url) => URL.revokeObjectURL(url),
  ) {}

  set(slot: string, blob: Blob): string {
    if (this.closed) return "";
    this.revoke(slot);
    const url = this.createObjectUrl(blob);
    this.slots.set(slot, url);
    return url;
  }

  get(slot: string): string | undefined {
    return this.slots.get(slot);
  }

  revoke(slot: string): void {
    const url = this.slots.get(slot);
    if (url !== undefined) {
      this.revokeObjectUrl(url);
      this.slots.delete(slot);
    }
  }

  revokeAll(): void {
    for (const url of this.slots.values()) this.revokeObjectUrl(url);
    this.slots.clear();
  }

  close(): void {
    this.revokeAll();
    this.closed = true;
  }
}
