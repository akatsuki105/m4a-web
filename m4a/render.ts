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
  mixerRate?: number; // ミキサーのサンプリング周波数 (m4aSoundMode), 音程を変えない音色の速さとリバーブの遅れに効く (既定 13379)
  reverb?: number; // 曲ヘッダがリバーブを指定していないときのリバーブ (0-127, m4aSoundMode で決めた値, 既定 0)
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
  reverb: number; // 掛けたリバーブ (0 なら掛けていない)
  trace?: Trace;
};

const TRACE_KEYS = 8;

// リバーブ (SoundMainRAM の applyReverb)
// ミキサーは pcmDmaPeriod フレーム分のリングバッファに書いていて、フレームごとに混ぜる前に、そのフレームの場所を
// (pcmDmaPeriod フレーム前の左 + 右 + pcmDmaPeriod - 1 フレーム前の左 + 右) * reverb / 512 で埋める (左右とも同じ値)
// 実機の PCM バッファに入るのは DirectSound だけなので、CGB には掛からない
const PCM_DMA_BUF_SIZE = 1584;

// 曲ヘッダの reverb の bit7 が立っていれば、MPlayStart が m4aSoundMode でその値にする. 立っていなければ前からの値のまま
export const songReverb = (headerReverb: number, fallback = 0) => (headerReverb & 0x80 ? headerReverb & 0x7F : fallback);

// pcmDmaPeriod: 何フレーム前の音を混ぜ直すか
export const reverbDelayFrames = (mixerRate: number) => {
  const samplesPerVBlank = Math.round(mixerRate / FRAME_RATE); // gPcmSamplesPerVBlankTable の値 (21024 Hz なら 352)
  return Math.max(2, Math.floor(PCM_DMA_BUF_SIZE / samplesPerVBlank));
};

// 1 フレームずつ進める共通の部分. onFrame で音を作る (または進める). フェードアウトのゲインを渡す (フェード中でなければ 1)
// tail: 音が鳴り終わったあとに続けるフレーム数 (リバーブの響きを残すため)
const run = (player: SongPlayer, opts: RenderOptions, tail: number, onFrame: (fade: number) => void) => {
  const loops = opts.loops ?? 1;
  const fadeFrames = Math.round((opts.fadeSeconds ?? 4) * FRAME_RATE);
  const maxFrames = Math.round((opts.maxSeconds ?? 600) * FRAME_RATE);
  let fadeLeft = -1; // フェードアウトの残りフレーム数
  let tailLeft = -1;
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
    if (tailLeft >= 0 && --tailLeft <= 0) break;
    if (tailLeft < 0 && player.finished) {
      if (tail <= 0) break;
      tailLeft = tail;
    }
  }
  return { frames, looped };
};

// リバーブを掛けるときに、鳴り終わってから残す長さ: 遅れの 8 回分 (1 回ごとにおよそ reverb / 128 倍になるので、十分小さくなる)
const tailFrames = (reverb: number, delay: number) => (reverb > 0 ? delay * 8 : 0);

// headerAddress は SongHeader の GBA アドレス
export const renderSong = (rom: DataView, headerAddress: number, opts: RenderOptions = {}): Rendered => {
  const sampleRate = opts.sampleRate ?? 44100;
  const gain = opts.gain ?? 0.8;
  const player = new SongPlayer(rom, headerAddress, { maxDirectVoices: opts.maxDirectVoices, mixerRate: opts.mixerRate });
  const reverb = songReverb(player.header.reverb, opts.reverb);
  const delay = reverbDelayFrames(opts.mixerRate ?? 13379);
  const history: [Float32Array, Float32Array][] = []; // DirectSound の出力 (リバーブ込み), 直近 delay フレーム分, 古い順

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

  const { looped } = run(player, opts, tailFrames(reverb, delay), (fade) => {
    carry += samplesPerFrame;
    const n = Math.floor(carry);
    carry -= n;

    // このフレームの DirectSound: リバーブで埋めてから音を足す
    const dl = new Float32Array(n), dr = new Float32Array(n);
    if (reverb > 0 && history.length === delay) {
      const [al, ar] = history[0], [bl, br] = history[1]; // delay フレーム前と delay - 1 フレーム前
      const k = reverb / 512;
      for (let i = 0; i < n; i++) {
        const ia = Math.min(i, al.length - 1), ib = Math.min(i, bl.length - 1); // フレームの長さは 1 サンプル違うことがある
        dl[i] = dr[i] = (al[ia] + ar[ia] + bl[ib] + br[ib]) * k;
      }
    }
    player.mix(dl, dr, 0, n, sampleRate, gain * fade, "direct");
    if (reverb > 0) {
      history.push([dl, dr]);
      if (history.length > delay) history.shift();
    }

    // CGB はリバーブを通さずに足す
    let written = 0;
    while (written < n) {
      if (used === chunkL.length) {
        chunks.push([chunkL, chunkR]);
        chunkL = new Float32Array(sampleRate), chunkR = new Float32Array(sampleRate);
        used = 0;
      }
      const k = Math.min(n - written, chunkL.length - used);
      chunkL.set(dl.subarray(written, written + k), used);
      chunkR.set(dr.subarray(written, written + k), used);
      player.mix(chunkL, chunkR, used, k, sampleRate, gain * fade, "cgb");
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
  return { sampleRate, left, right, looped, reverb, trace };
};

export type Measured = {
  seconds: number; // renderSong で書き出したときの長さ (ほぼ同じ)
  looped: boolean;
};

// 音を作らずにシーケンスだけ進めて、書き出したときの長さを測る (renderSong よりずっと速い)
export const measureSong = (rom: DataView, headerAddress: number, opts: RenderOptions = {}): Measured => {
  const player = new SongPlayer(rom, headerAddress, { maxDirectVoices: opts.maxDirectVoices, mixerRate: opts.mixerRate });
  const reverb = songReverb(player.header.reverb, opts.reverb);
  const tail = tailFrames(reverb, reverbDelayFrames(opts.mixerRate ?? 13379));
  const { frames, looped } = run(player, opts, tail, () => player.advance(1 / FRAME_RATE));
  return { seconds: frames / FRAME_RATE, looped };
};
