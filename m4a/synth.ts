// 発音中の音 (チャンネル) と、そのエンベロープ・音程・ミキシング
// DirectSound は SoundMainRAM、CGB (矩形波・波形メモリ・ノイズ) は CgbSound の動きを真似る (それらしく鳴る程度)

import { isRomPointer, readProgWave, readWave, type Tone, TONE_CGB, TONE_FIX, type Wave } from "./data.ts";

// GBA の画面の更新頻度 (m4a は VBlank ごとに1回動く)
export const FRAME_RATE = 16777216 / 280896;

// チャンネルが読むトラックの値 (TrkVolPitSet の結果)
export interface TrackOut {
  volMR: number; // 右の音量 (0-255 くらい)
  volML: number;
  keyM: number; // キーのずれ (半音)
  pitM: number; // キーのずれの端数 (1/256 半音)
  echoVolume: number; // 疑似エコー (xIECV / xIECL)
  echoLength: number;
}

type EnvState = "attack" | "decay" | "sustain" | "release" | "echo" | "off";

// m4a の gCgbFreqTable (C2 から1オクターブ分, GB のレジスタ値 - 2048)
const CGB_FREQ = [-2004, -1891, -1785, -1685, -1591, -1501, -1417, -1337, -1262, -1192, -1125, -1062];

// MidiKeyToCgbFreq の矩形波・波形メモリの分: GB の周波数レジスタの値 (0-2047)
const cgbFreqReg = (key: number, fine: number): number => {
  if (key <= 35) key = 0, fine = 0;
  else {
    key -= 36;
    if (key > 130) key = 130, fine = 255;
  }
  const reg = (k: number) => CGB_FREQ[k % 12] >> Math.floor(k / 12);
  const v1 = reg(key), v2 = reg(key + 1);
  return v1 + ((fine * (v2 - v1)) >> 8) + 2048;
};

// m4a の gNoiseTable (NR43 の値), キー 21 から
const NOISE_TABLE = [
  0xD7,
  0xD6,
  0xD5,
  0xD4,
  0xC7,
  0xC6,
  0xC5,
  0xC4,
  0xB7,
  0xB6,
  0xB5,
  0xB4,
  0xA7,
  0xA6,
  0xA5,
  0xA4,
  0x97,
  0x96,
  0x95,
  0x94,
  0x87,
  0x86,
  0x85,
  0x84,
  0x77,
  0x76,
  0x75,
  0x74,
  0x67,
  0x66,
  0x65,
  0x64,
  0x57,
  0x56,
  0x55,
  0x54,
  0x47,
  0x46,
  0x45,
  0x44,
  0x37,
  0x36,
  0x35,
  0x34,
  0x27,
  0x26,
  0x25,
  0x24,
  0x17,
  0x16,
  0x15,
  0x14,
  0x07,
  0x06,
  0x05,
  0x04,
  0x03,
  0x02,
  0x01,
  0x00,
];

const DUTY = [0.125, 0.25, 0.5, 0.75];

// CGB の音 1 つの最大の大きさ (DirectSound の最大を 1 として)
const CGB_AMP = 0.25;

let serial = 0;

export class Voice {
  readonly kind: number; // 0: DirectSound, 1-4: CGB
  readonly order = serial++; // 発音した順
  state: EnvState = "attack";
  env = 0; // DirectSound: 0-255, CGB: 0-15
  private counter = 0; // CGB のエンベロープの待ちフレーム数
  private echoCount = 0;
  private wave?: Wave;
  private prog?: Uint8Array;
  private pos = 0; // 再生位置 (DirectSound: サンプル, CGB: 周期の割合)
  private lfsr = 0x7FFF;
  private first = true;

  constructor(
    readonly track: TrackOut,
    readonly tone: Tone,
    readonly key: number, // 鳴らすキー (リズムなら音色のキー), トラックのキーのずれは別に足す
    readonly midiKey: number, // シーケンスに書かれたキー (EOT で止める音を探す)
    readonly velocity: number,
    readonly rhythmPan: number,
    public gate: number, // 残りのティック数, 0 ならタイ (EOT まで鳴らす)
    rom: DataView,
    waveCache: Map<number, Wave>,
    private mixerRate: number, // ミキサーのサンプリング周波数 (m4aSoundMode), 音程を変えない音色はこの速さで1サンプルずつ進む
  ) {
    this.kind = tone.type & TONE_CGB;
    if ((this.kind === 0 || this.kind === 3) && !isRomPointer(tone.wav)) {
      this.state = "off"; // 波形が無い音色
    } else if (this.kind === 0) {
      let w = waveCache.get(tone.wav);
      if (!w) waveCache.set(tone.wav, w = readWave(rom, tone.wav));
      this.wave = w;
    } else if (this.kind === 3) {
      this.prog = readProgWave(rom, tone.wav);
    }
  }

  get active() {
    return this.state !== "off";
  }

  // 音を離す (ゲートが切れた / EOT / トラックの終わり)
  release() {
    if (this.state !== "off" && this.state !== "echo") this.state = "release";
  }

  // ChnVolSetAsm: ベロシティとトラックの左右の音量から、このチャンネルの左右の音量 (0-255)
  private volumes(): [number, number] {
    const rp = this.rhythmPan;
    const r = Math.min(255, (this.velocity * (128 + rp) * this.track.volMR) >> 14);
    const l = Math.min(255, (this.velocity * (127 - rp) * this.track.volML) >> 14);
    return [r, l];
  }

  // 1 フレーム分エンベロープを進める
  frame() {
    if (this.kind === 0) this.frameDirect();
    else this.frameCgb();
  }

  private frameDirect() {
    const t = this.tone;
    switch (this.state) {
      case "attack":
        this.env = Math.min(255, this.env + t.attack);
        if (this.env >= 255) this.state = "decay";
        return;
      case "decay":
        this.env = (this.env * t.decay) >> 8;
        if (this.env <= t.sustain) {
          this.env = t.sustain;
          this.state = this.env === 0 ? this.toEcho() : "sustain";
        }
        return;
      case "release":
        this.env = (this.env * t.release) >> 8;
        if (this.env <= this.track.echoVolume) this.state = this.toEcho();
        return;
      case "echo":
        if (--this.echoCount <= 0) this.state = "off";
        return;
    }
  }

  private toEcho(): EnvState {
    if (this.track.echoLength === 0 || this.track.echoVolume === 0) return "off";
    this.env = this.track.echoVolume;
    this.echoCount = this.track.echoLength;
    return "echo";
  }

  // CgbModVol: 音量の目標 (0-15)
  private cgbGoal() {
    const [r, l] = this.volumes();
    return Math.min(15, (r + l) >> 4);
  }

  private frameCgb() {
    const t = this.tone;
    const goal = this.cgbGoal();
    const sustainGoal = (goal * (t.sustain & 0xF) + 15) >> 4;
    if (this.first) {
      this.first = false;
      this.env = 0;
      this.counter = t.attack & 7;
      if (this.counter === 0) this.env = goal, this.state = "decay", this.counter = t.decay & 7;
      return;
    }
    switch (this.state) {
      case "attack":
        if (--this.counter > 0) return;
        if (++this.env >= goal) this.env = goal, this.state = "decay";
        this.counter = this.state === "decay" ? t.decay & 7 : t.attack & 7;
        return;
      case "decay":
        if ((t.decay & 7) === 0) {
          this.env = sustainGoal, this.state = this.env === 0 ? "off" : "sustain";
          return;
        }
        if (--this.counter > 0) return;
        if (--this.env <= sustainGoal) {
          this.env = sustainGoal;
          this.state = this.env === 0 ? "off" : "sustain";
        }
        this.counter = t.decay & 7;
        return;
      case "sustain":
        this.env = sustainGoal;
        return;
      case "release":
        if ((t.release & 7) === 0) {
          this.state = "off";
          return;
        }
        if (this.counter <= 0 || this.counter > (t.release & 7)) this.counter = t.release & 7;
        if (--this.counter > 0) return;
        if (--this.env <= 0) this.state = "off";
        this.counter = t.release & 7;
        return;
      case "echo":
        this.state = "off";
        return;
    }
  }

  // 今の音程での1秒あたりの進み (DirectSound: サンプル数, CGB: 周期数 / ノイズはシフト回数)
  private rate(): number {
    const key = this.key + this.track.keyM;
    const fine = this.track.pitM & 0xFF;
    if (this.kind === 0) {
      const w = this.wave!;
      if (this.tone.type & TONE_FIX) return this.mixerRate; // SoundMainRAM: 出力1サンプルごとに波形を1サンプル進める
      const k = Math.min(178, Math.max(0, key));
      return (w.freq / 1024) * Math.pow(2, (k - 60 + fine / 256) / 12);
    }
    if (this.kind === 4) {
      const nr43 = NOISE_TABLE[Math.min(59, Math.max(0, key - 21))];
      const r = nr43 & 7, s = nr43 >> 4;
      return 524288 / (r === 0 ? 0.5 : r) / Math.pow(2, s + 1);
    }
    const reg = cgbFreqReg(Math.max(0, key), fine);
    return (this.kind === 3 ? 65536 : 131072) / (2048 - reg);
  }

  // sampleRate で count サンプル分を left / right に足す
  mix(left: Float32Array, right: Float32Array, offset: number, count: number, sampleRate: number, gain: number) {
    if (this.state === "off") return;
    const [r, l] = this.volumes();
    const step = this.rate() / sampleRate;
    if (this.kind === 0) {
      const w = this.wave!;
      const gr = (this.env * r) / 65536 / 128 * gain, gl = (this.env * l) / 65536 / 128 * gain;
      const data = w.data, size = w.size;
      const loops = w.loop && w.loopStart < size;
      // 音程を変える音色は隣のサンプルとの間を直線で補間する (SoundMainRAM), 変えない音色 (FIX) は補間しない
      const interp = !(this.tone.type & TONE_FIX);
      let pos = this.pos;
      for (let i = 0; i < count; i++) {
        if (pos >= size) {
          if (!loops) {
            this.state = "off";
            break;
          }
          pos = w.loopStart + ((pos - size) % (size - w.loopStart));
        }
        const p = pos | 0;
        let s = data[p];
        if (interp) {
          const next = p + 1 < size ? data[p + 1] : loops ? data[w.loopStart] : 0;
          s += (next - s) * (pos - p);
        }
        left[offset + i] += s * gl;
        right[offset + i] += s * gr;
        pos += step;
      }
      this.pos = pos;
      return;
    }
    // CGB: 左右は片方だけか両方 (CgbPan)
    let onR = 1, onL = 1;
    if (r >= l) {
      if (r / 2 >= l) onL = 0;
    } else if (l / 2 >= r) onR = 0;
    const amp = (this.env / 15) * CGB_AMP * gain;
    const ar = amp * onR, al = amp * onL;
    let pos = this.pos;
    if (this.kind === 4) {
      const short = (this.tone.wav & 1) !== 0;
      let lfsr = this.lfsr;
      for (let i = 0; i < count; i++) {
        pos += step;
        while (pos >= 1) {
          pos -= 1;
          const bit = (lfsr ^ (lfsr >> 1)) & 1;
          lfsr = (lfsr >> 1) | (bit << 14);
          if (short) lfsr = (lfsr & ~0x40) | (bit << 6);
        }
        const s = lfsr & 1 ? -1 : 1;
        left[offset + i] += s * al;
        right[offset + i] += s * ar;
      }
      this.lfsr = lfsr;
    } else if (this.kind === 3) {
      const prog = this.prog!;
      for (let i = 0; i < count; i++) {
        const s = (prog[Math.floor(pos * 32) & 31] - 7.5) / 7.5;
        left[offset + i] += s * al;
        right[offset + i] += s * ar;
        pos = (pos + step) % 1;
      }
    } else {
      const duty = DUTY[this.tone.wav & 3];
      for (let i = 0; i < count; i++) {
        const s = pos < duty ? 1 : -1;
        left[offset + i] += s * al;
        right[offset + i] += s * ar;
        pos = (pos + step) % 1;
      }
    }
    this.pos = pos;
  }
}
