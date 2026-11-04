// 曲を最初から PCM に書き出す / 長さを測る

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
  trace?: boolean; // トラックごとに鳴っている音をフレームごとに記録する (Rendered.trace)
};

// トラックごとに鳴っている音の記録 (フレームごと). 時刻 t 秒のフレームは floor(t * FRAME_RATE)
export type Trace = {
  frames: number;
  tracks: number;
  keysPerTrack: number;
  keys: Uint8Array<ArrayBuffer>; // [(frame * tracks + track) * keysPerTrack + n], 鳴っていなければ 0xFF
  levels: Uint8Array<ArrayBuffer>; // [frame * tracks + track], 0-255
};

export type Rendered = {
  sampleRate: number;
  left: Float32Array<ArrayBuffer>;
  right: Float32Array<ArrayBuffer>;
  looped: boolean; // ループしたのでフェードアウトで終えた
  trace?: Trace;
};

const TRACE_KEYS = 8;

// 1 フレームずつ進める共通の部分. onFrame で音を作る (または進める) と、終わりかどうかを返す
// フェードアウトのゲインを渡す (フェード中でなければ 1)
const run = (player: SongPlayer, opts: RenderOptions, onFrame: (fade: number) => void) => {
  const loops = opts.loops ?? 1;
  const fadeFrames = Math.round((opts.fadeSeconds ?? 4) * FRAME_RATE);
  const maxFrames = Math.round((opts.maxSeconds ?? 600) * FRAME_RATE);
  let fadeLeft = -1; // フェードアウトの残りフレーム数
  let looped = false;
  let frames = 0;
  while (frames < maxFrames) {
    player.frame();
    if (fadeLeft < 0 && player.loops >= loops && !player.tracksEnded) {
      fadeLeft = fadeFrames;
      looped = true;
    }
    onFrame(fadeLeft < 0 ? 1 : fadeLeft / fadeFrames);
    frames++;
    if (fadeLeft >= 0 && --fadeLeft <= 0) break;
    if (player.finished) break;
  }
  return { frames, looped };
};

// headerAddress は SongHeader の GBA アドレス
export const renderSong = (rom: DataView, headerAddress: number, opts: RenderOptions = {}): Rendered => {
  const sampleRate = opts.sampleRate ?? 44100;
  const gain = opts.gain ?? 0.8;
  const player = new SongPlayer(rom, headerAddress, { maxDirectVoices: opts.maxDirectVoices, mixerRate: opts.mixerRate });

  const chunks: [Float32Array, Float32Array][] = [];
  let chunkL = new Float32Array(sampleRate), chunkR = new Float32Array(sampleRate);
  let used = 0, total = 0;
  const samplesPerFrame = sampleRate / FRAME_RATE;
  let carry = 0;

  // 記録はフレーム数が分からないので、足りなくなったら倍に広げる
  const tracks = player.trackCount;
  let keys = new Uint8Array(0), levels = new Uint8Array(0);
  let traced = 0;
  const grow = () => {
    const cap = Math.max(1024, traced * 2);
    const k = new Uint8Array(cap * tracks * TRACE_KEYS).fill(0xFF), l = new Uint8Array(cap * tracks);
    k.set(keys), l.set(levels);
    keys = k, levels = l;
  };

  const { looped } = run(player, opts, (fade) => {
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
      player.mix(chunkL, chunkR, used, k, sampleRate, gain * fade);
      used += k, written += k;
    }
    total += n;
    if (opts.trace) {
      if ((traced + 1) * tracks * TRACE_KEYS > keys.length) grow();
      player.snapshot(keys, levels, traced * tracks, TRACE_KEYS);
      traced++;
    }
  });
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
  const trace = opts.trace ? { frames: traced, tracks, keysPerTrack: TRACE_KEYS, keys: keys.slice(0, traced * tracks * TRACE_KEYS), levels: levels.slice(0, traced * tracks) } : undefined;
  return { sampleRate, left, right, looped, trace };
};

export type Measured = {
  seconds: number; // renderSong で書き出したときの長さ (ほぼ同じ)
  looped: boolean;
};

// 音を作らずにシーケンスだけ進めて、書き出したときの長さを測る (renderSong よりずっと速い)
export const measureSong = (rom: DataView, headerAddress: number, opts: RenderOptions = {}): Measured => {
  const player = new SongPlayer(rom, headerAddress, { maxDirectVoices: opts.maxDirectVoices, mixerRate: opts.mixerRate });
  const { frames, looped } = run(player, opts, () => player.advance(1 / FRAME_RATE));
  return { seconds: frames / FRAME_RATE, looped };
};
