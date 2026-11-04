// 書き出した曲 (AudioBuffer) を鳴らす部分: 再生・一時停止・シーク・繰り返し
// 再生位置は AudioContext の時刻から求める. 画面は position() を描画のたびに読む

import { audioOutput } from "./audio.ts";

export class Playback {
  private buffer: AudioBuffer | null = null;
  private src: AudioBufferSourceNode | null = null;
  private startedAt = 0; // 鳴らし始めた AudioContext の時刻
  private offset = 0; // そのときの再生位置 (止めているときは今の位置)
  private looping = false;
  private listeners = new Set<() => void>();
  onEnded: (() => void) | null = null; // 最後まで鳴った (繰り返しのときは呼ばれない)

  get loaded() {
    return this.buffer !== null;
  }

  get playing() {
    return this.src !== null;
  }

  get duration() {
    return this.buffer?.duration ?? 0;
  }

  // 再生や一時停止が変わったら呼ぶ
  subscribe(f: () => void) {
    this.listeners.add(f);
    return () => void this.listeners.delete(f);
  }

  private notify() {
    for (const f of this.listeners) f();
  }

  // 今の再生位置 (秒), 繰り返し中は長さで折り返す
  position(): number {
    if (!this.src) return this.offset;
    const p = this.offset + audioOutput().ctx.currentTime - this.startedAt;
    return this.looping ? p % this.duration : Math.min(p, this.duration);
  }

  // 曲を差し替える (止めて位置を 0 に)
  load(left: Float32Array<ArrayBuffer>, right: Float32Array<ArrayBuffer>, sampleRate: number) {
    this.stopSource();
    const { ctx } = audioOutput();
    const buf = ctx.createBuffer(2, Math.max(1, left.length), sampleRate);
    buf.copyToChannel(left, 0);
    buf.copyToChannel(right, 1);
    this.buffer = buf;
    this.offset = 0;
    this.notify();
  }

  unload() {
    this.stopSource();
    this.buffer = null;
    this.offset = 0;
    this.notify();
  }

  play(at = this.offset) {
    if (!this.buffer) return;
    this.stopSource();
    const { ctx, input } = audioOutput();
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.loop = this.looping;
    src.connect(input);
    src.onended = () => {
      if (this.src !== src) return; // 止めたり位置を変えたりしたもの
      this.src = null;
      this.offset = 0;
      this.notify();
      this.onEnded?.();
    };
    this.offset = Math.max(0, Math.min(at, this.buffer.duration));
    src.start(0, this.offset);
    this.startedAt = ctx.currentTime;
    this.src = src;
    this.notify();
  }

  pause() {
    if (!this.src) return;
    this.offset = this.position();
    this.stopSource();
    this.notify();
  }

  seek(at: number) {
    if (this.src) this.play(at);
    else {
      this.offset = Math.max(0, Math.min(at, this.duration));
      this.notify();
    }
  }

  // 繰り返し (最後まで来たら最初から). 鳴らしている途中で変えても、その位置から続ける
  setLoop(v: boolean) {
    if (this.looping === v) return;
    const p = this.position();
    this.looping = v;
    if (this.src) {
      this.src.loop = v;
      this.offset = p;
      this.startedAt = audioOutput().ctx.currentTime;
    }
  }

  private stopSource() {
    const src = this.src;
    this.src = null;
    src?.stop();
  }
}

export const playback = new Playback();
