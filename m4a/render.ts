// 曲を最初から PCM に書き出す

import { SongPlayer } from "./player.ts";
import { FRAME_RATE } from "./synth.ts";

export type RenderOptions = {
  sampleRate?: number; // 書き出すサンプリング周波数 (既定 44100)
  loops?: number; // GOTO で戻った回数がこれになったらフェードアウトする (既定 1)
  fadeSeconds?: number; // フェードアウトの長さ (既定 4 秒)
  maxSeconds?: number; // 最大の長さ (既定 600 秒)
  gain?: number; // 全体の音量 (既定 0.8)
  maxDirectVoices?: number; // DirectSound の同時発音数 (既定 12)
  mixerRate?: number; // ミキサーのサンプリング周波数 (m4aSoundMode), 音程を変えない音色の速さに効く (既定 13379)
};

export type Rendered = {
  sampleRate: number;
  left: Float32Array<ArrayBuffer>;
  right: Float32Array<ArrayBuffer>;
  looped: boolean; // ループしたのでフェードアウトで終えた
};

// headerAddress は SongHeader の GBA アドレス
export const renderSong = (rom: DataView, headerAddress: number, opts: RenderOptions = {}): Rendered => {
  const sampleRate = opts.sampleRate ?? 44100;
  const loops = opts.loops ?? 1;
  const fadeFrames = Math.round((opts.fadeSeconds ?? 4) * FRAME_RATE);
  const maxFrames = Math.round((opts.maxSeconds ?? 600) * FRAME_RATE);
  const gain = opts.gain ?? 0.8;
  const player = new SongPlayer(rom, headerAddress, { maxDirectVoices: opts.maxDirectVoices, mixerRate: opts.mixerRate });

  const chunks: [Float32Array, Float32Array][] = [];
  let chunkL = new Float32Array(sampleRate), chunkR = new Float32Array(sampleRate);
  let used = 0, total = 0;
  const samplesPerFrame = sampleRate / FRAME_RATE;
  let carry = 0;
  let fadeLeft = -1; // フェードアウトの残りフレーム数
  let looped = false;

  for (let f = 0; f < maxFrames; f++) {
    player.frame();
    if (fadeLeft < 0 && player.loops >= loops && !player.tracksEnded) {
      fadeLeft = fadeFrames;
      looped = true;
    }
    carry += samplesPerFrame;
    const n = Math.floor(carry);
    carry -= n;
    let written = 0;
    while (written < n) {
      if (used === chunkL.length) {
        chunks.push([chunkL, chunkR]);
        chunkL = new Float32Array(sampleRate), chunkR = new Float32Array(sampleRate);
        used = 0;
      }
      const k = Math.min(n - written, chunkL.length - used);
      const g = fadeLeft < 0 ? gain : (gain * fadeLeft) / fadeFrames;
      player.mix(chunkL, chunkR, used, k, sampleRate, g);
      used += k, written += k;
    }
    total += n;
    if (fadeLeft >= 0 && --fadeLeft <= 0) break;
    if (player.finished) break;
  }
  chunks.push([chunkL.subarray(0, used), chunkR.subarray(0, used)]);

  const left = new Float32Array(total), right = new Float32Array(total);
  let o = 0;
  for (const [l, r] of chunks) {
    left.set(l, o), right.set(r, o);
    o += l.length;
  }
  for (let i = 0; i < total; i++) {
    left[i] = Math.max(-1, Math.min(1, left[i]));
    right[i] = Math.max(-1, Math.min(1, right[i]));
  }
  return { sampleRate, left, right, looped };
};
