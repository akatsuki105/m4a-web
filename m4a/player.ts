// 曲 1 つ分のシーケンサ (MPlayMain / ply_* の動きを真似る)
// frame() を 1 フレーム (1/59.73 秒) ごとに呼び、mix() でその間の音を書き出す

import { readSongHeader, readVoice, type SongHeader, type Tone, TONE_CGB, TONE_RHY, TONE_SPL, toOffset, type Wave } from "./data.ts";
import { type TrackOut, Voice } from "./synth.ts";

// m4a の gClockTable: 待ち (0x80-0xB0) と音符 (0xCF-0xFF) の長さ (ティック)
const CLOCK_TABLE = [
  0x00,
  0x01,
  0x02,
  0x03,
  0x04,
  0x05,
  0x06,
  0x07,
  0x08,
  0x09,
  0x0A,
  0x0B,
  0x0C,
  0x0D,
  0x0E,
  0x0F,
  0x10,
  0x11,
  0x12,
  0x13,
  0x14,
  0x15,
  0x16,
  0x17,
  0x18,
  0x1C,
  0x1E,
  0x20,
  0x24,
  0x28,
  0x2A,
  0x2C,
  0x30,
  0x34,
  0x36,
  0x38,
  0x3C,
  0x40,
  0x42,
  0x44,
  0x48,
  0x4C,
  0x4E,
  0x50,
  0x54,
  0x58,
  0x5A,
  0x5C,
  0x60,
];

// シーケンスのコマンド (MPlayDef.s)
const FINE = 0xB1, GOTO = 0xB2, PATT = 0xB3, PEND = 0xB4, REPT = 0xB5, MEMACC = 0xB9, PRIO = 0xBA, TEMPO = 0xBB, KEYSH = 0xBC, VOICE = 0xBD, VOL = 0xBE, PAN = 0xBF;
const BEND = 0xC0, BENDR = 0xC1, LFOS = 0xC2, LFODL = 0xC3, MOD = 0xC4, MODT = 0xC5, TUNE = 0xC8, PORT = 0xCC, XCMD = 0xCD, EOT = 0xCE, TIE = 0xCF;

const s8 = (v: number) => (v << 24) >> 24;

// MusicPlayerTrack
class Track implements TrackOut {
  ptr: number; // 次に読む ROM オフセット
  ended = false;
  wait = 0;
  runningStatus = 0;
  patternStack: number[] = [];
  repeat = 0;
  gotoCount = 0; // GOTO で戻った回数 (ループの回数を数える)
  tone: Tone;
  key = 60;
  velocity = 0;
  gateTime = 0;
  vol = 0;
  pan = 0;
  bend = 0;
  bendRange = 2;
  tune = 0;
  keyShift = 0;
  lfoSpeed = 22;
  lfoSpeedC = 0;
  lfoDelay = 0;
  lfoDelayC = 0;
  mod = 0;
  modT = 0;
  modM = 0;
  volMR = 0;
  volML = 0;
  keyM = 0;
  pitM = 0;
  echoVolume = 0;
  echoLength = 0;

  constructor(address: number) {
    this.ptr = toOffset(address);
    this.tone = { type: 1, key: 60, length: 0, panSweep: 0, wav: 0, attack: 0, decay: 0, sustain: 15, release: 0, keySplitTable: 0 };
    this.update();
  }

  // TrkVolPitSet (volX = 64, panX = 0, pitX = 0, keyShiftX = 0 のとき)
  update() {
    let x = (this.vol * 64) >> 5;
    if (this.modT === 1) x = (x * (this.modM + 128)) >> 7;
    let y = 2 * this.pan;
    if (this.modT === 2) y += this.modM;
    y = Math.max(-128, Math.min(127, y));
    this.volMR = ((y + 128) * x) >> 8;
    this.volML = ((127 - y) * x) >> 8;
    let p = (this.tune + this.bend * this.bendRange) * 4 + (this.keyShift << 8);
    if (this.modT === 0) p += 16 * this.modM;
    this.keyM = p >> 8;
    this.pitM = p & 0xFF;
  }
}

export type PlayerOptions = {
  maxDirectVoices?: number; // DirectSound の同時発音数 (m4aSoundMode の maxChans)
  mixerRate?: number; // ミキサーのサンプリング周波数 (m4aSoundMode の freq), 既定は m4a の SoundInit と同じ 13379 Hz
};

export class SongPlayer {
  readonly header: SongHeader;
  private tracks: Track[];
  voices: Voice[] = [];
  private tempoD = 150;
  private tempoC = 0;
  // gMPlayMemAccArea (ゲームでは全プレイヤーで共有する 16 バイト), 添字はマスクされないのではみ出しても読めるように 256 バイト持つ
  private mem = new Uint8Array(256);
  private waveCache = new Map<number, Wave>();
  private maxDirect: number;
  private mixerRate: number;

  constructor(private rom: DataView, headerAddress: number, opts: PlayerOptions = {}) {
    this.header = readSongHeader(rom, headerAddress);
    this.tracks = this.header.tracks.map((a) => new Track(a));
    this.maxDirect = opts.maxDirectVoices ?? 12;
    this.mixerRate = opts.mixerRate ?? 13379;
  }

  // 全トラックが終わった (FINE)
  get tracksEnded() {
    return this.tracks.every((t) => t.ended);
  }

  // 音も鳴り終わった
  get finished() {
    return this.tracksEnded && !this.voices.some((v) => v.active);
  }

  // ループの回数: どれかのトラックが GOTO で戻った回数の最大
  get loops() {
    return Math.max(0, ...this.tracks.map((t) => t.gotoCount));
  }

  // シーケンスを止めて、鳴っている音を離す
  stop() {
    for (const t of this.tracks) t.ended = true;
    for (const v of this.voices) v.release();
  }

  // 1 フレーム進める: テンポの分だけティックを進め、エンベロープを更新する
  frame() {
    this.tempoC += this.tempoD;
    while (this.tempoC >= 150) {
      this.tick();
      this.tempoC -= 150;
    }
    for (const v of this.voices) v.frame();
    this.voices = this.voices.filter((v) => v.active);
  }

  mix(left: Float32Array, right: Float32Array, offset: number, count: number, sampleRate: number, gain = 1) {
    for (const v of this.voices) v.mix(left, right, offset, count, sampleRate, gain);
    this.voices = this.voices.filter((v) => v.active);
  }

  private u8(o: number) {
    return o < this.rom.byteLength ? this.rom.getUint8(o) : FINE;
  }

  private u32(o: number) {
    return o + 4 <= this.rom.byteLength ? this.rom.getUint32(o, true) : 0;
  }

  private tick() {
    for (const t of this.tracks) {
      if (t.ended) continue;
      // ゲートが切れた音を離す
      for (const v of this.voices) {
        if (v.track !== t || v.gate === 0 || v.state === "release" || v.state === "off") continue;
        if (--v.gate === 0) v.release();
      }
      while (!t.ended && t.wait === 0) this.command(t);
      if (t.ended) continue;
      t.wait--;
      // LFO
      if (t.lfoSpeed && t.mod) {
        if (t.lfoDelayC) t.lfoDelayC--;
        else {
          t.lfoSpeedC = (t.lfoSpeedC + t.lfoSpeed) & 0xFF;
          const c = t.lfoSpeedC;
          const r = s8(c - 64) < 0 ? s8(c) : 128 - c;
          const m = (t.mod * r) >> 6;
          if (m !== t.modM) {
            t.modM = m;
            t.update();
          }
        }
      }
    }
  }

  // コマンドの引数 (ランニングステータスでも同じ位置から読む)
  private arg(t: Track) {
    return this.u8(t.ptr++);
  }

  private command(t: Track) {
    let cmd = this.u8(t.ptr);
    if (cmd >= 0x80) {
      t.ptr++;
      if (cmd >= VOICE) t.runningStatus = cmd;
    } else {
      cmd = t.runningStatus;
    }
    if (cmd === 0) { // ランニングステータスが無いのに引数が来た
      t.ended = true;
      return;
    }
    if (cmd >= TIE) {
      this.note(t, cmd - TIE);
      return;
    }
    if (cmd <= 0xB0) {
      t.wait = CLOCK_TABLE[cmd - 0x80];
      return;
    }
    switch (cmd) {
      case FINE:
        this.fine(t);
        return;
      case GOTO:
        t.ptr = toOffset(this.u32(t.ptr));
        t.gotoCount++;
        return;
      case PATT:
        if (t.patternStack.length < 3) {
          t.patternStack.push(t.ptr + 4);
          t.ptr = toOffset(this.u32(t.ptr));
        } else {
          this.fine(t); // 3 段を超えたら ply_fine (トラックの終わり)
        }
        return;
      case PEND:
        if (t.patternStack.length > 0) t.ptr = t.patternStack.pop()!;
        return;
      case REPT: {
        const n = this.arg(t);
        if (n === 0) {
          t.ptr = toOffset(this.u32(t.ptr));
          t.gotoCount++;
        } else if (++t.repeat < n) {
          t.ptr = toOffset(this.u32(t.ptr));
        } else {
          t.repeat = 0;
          t.ptr += 4;
        }
        return;
      }
      case MEMACC:
        this.memacc(t);
        return;
      case PRIO:
        this.arg(t);
        return;
      case TEMPO:
        this.tempoD = this.arg(t) * 2;
        return;
      case KEYSH:
        t.keyShift = s8(this.arg(t));
        break;
      case VOICE:
        t.tone = readVoice(this.rom, this.header.voicegroup, this.arg(t));
        return;
      case VOL:
        t.vol = this.arg(t);
        break;
      case PAN:
        t.pan = this.arg(t) - 64;
        break;
      case BEND:
        t.bend = this.arg(t) - 64;
        break;
      case BENDR:
        t.bendRange = this.arg(t);
        break;
      case LFOS:
        t.lfoSpeed = this.arg(t);
        if (t.lfoSpeed === 0) t.modM = 0;
        break;
      case LFODL:
        t.lfoDelay = this.arg(t);
        return;
      case MOD:
        t.mod = this.arg(t);
        if (t.mod === 0) t.modM = 0;
        break;
      case MODT: {
        const v = this.arg(t);
        if (v !== t.modT) t.modT = v, t.modM = 0;
        break;
      }
      case TUNE:
        t.tune = this.arg(t) - 64;
        break;
      case PORT:
        t.ptr += 2;
        return;
      case XCMD:
        this.xcmd(t);
        return;
      case EOT: {
        let key = t.key;
        if (this.u8(t.ptr) < 0x80) key = t.key = this.arg(t);
        for (const v of this.voices) if (v.track === t && v.gate === 0 && v.midiKey === key) v.release();
        return;
      }
      default: // 未使用のコマンドは ply_fine
        this.fine(t);
        return;
    }
    t.update();
  }

  private fine(t: Track) {
    t.ended = true;
    for (const v of this.voices) if (v.track === t) v.release();
  }

  // ply_memacc: gMPlayMemAccArea への演算と条件付きジャンプ
  private memacc(t: Track) {
    const op = this.arg(t), addr = this.arg(t), data = this.arg(t);
    const mem = this.mem;
    if (op <= 5) {
      if (op === 0) mem[addr] = data;
      else if (op === 1) mem[addr] += data;
      else if (op === 2) mem[addr] -= data;
      else if (op === 3) mem[addr] = mem[data];
      else if (op === 4) mem[addr] += mem[data];
      else mem[addr] -= mem[data];
      return;
    }
    if (op >= 18) return; // 未定義の演算は何もしない (ポインタも読まない)
    const a = mem[addr], b = op >= 12 ? mem[data] : data;
    const k = (op - 6) % 6;
    const jump = [a === b, a !== b, a > b, a >= b, a <= b, a < b][k];
    if (jump) t.ptr = toOffset(this.u32(t.ptr));
    else t.ptr += 4;
  }

  // ply_xcmd: 音色の書き換えと疑似エコー
  private xcmd(t: Track) {
    const sub = this.arg(t);
    const tone = { ...t.tone };
    switch (sub) {
      case 0x01:
        tone.wav = this.u32(t.ptr);
        t.ptr += 4;
        break;
      case 0x02:
        tone.type = this.arg(t);
        break;
      case 0x04:
        tone.attack = this.arg(t);
        break;
      case 0x05:
        tone.decay = this.arg(t);
        break;
      case 0x06:
        tone.sustain = this.arg(t);
        break;
      case 0x07:
        tone.release = this.arg(t);
        break;
      case 0x08:
        t.echoVolume = this.arg(t);
        break;
      case 0x09:
        t.echoLength = this.arg(t);
        break;
      case 0x0A:
        tone.length = this.arg(t);
        break;
      case 0x0B:
        tone.panSweep = this.arg(t);
        break;
      default: // ply_xxx は ply_fine
        this.fine(t);
        return;
    }
    t.tone = tone;
  }

  // ply_note: idx は TIE (0) か N01-N96 (1-48)
  private note(t: Track, idx: number) {
    let gate = CLOCK_TABLE[idx];
    if (this.u8(t.ptr) < 0x80) {
      t.key = this.arg(t);
      if (this.u8(t.ptr) < 0x80) {
        t.velocity = this.arg(t);
        if (this.u8(t.ptr) < 0x80) gate += this.arg(t);
      }
    }
    t.gateTime = gate;

    let tone = t.tone;
    let key = t.key;
    let rhythmPan = 0;
    if (tone.type & (TONE_RHY | TONE_SPL)) {
      const index = tone.type & TONE_SPL ? this.u8(toOffset(tone.keySplitTable) + t.key) : t.key;
      const sub = readVoice(this.rom, tone.wav, index);
      if (sub.type & (TONE_RHY | TONE_SPL)) return;
      if (tone.type & TONE_RHY) {
        if (sub.panSweep & 0x80) rhythmPan = (sub.panSweep - 0xC0) * 2;
        key = sub.key;
      }
      tone = sub;
    }

    if (t.lfoDelay) {
      t.lfoDelayC = t.lfoDelay;
      if (t.modM) t.modM = 0, t.update();
    }

    // CGB は種類ごとに1チャンネルしかないので、同じ種類の音を止める
    const kind = tone.type & TONE_CGB;
    if (kind !== 0) {
      for (const v of this.voices) if (v.kind === kind) v.state = "off";
    } else {
      const direct = this.voices.filter((v) => v.kind === 0 && v.active);
      if (direct.length >= this.maxDirect) {
        // 離した音のうち古いもの, 無ければ一番古い音を止める
        const victim = direct.find((v) => v.state === "release" || v.state === "echo") ?? direct[0];
        victim.state = "off";
      }
    }
    this.voices = this.voices.filter((v) => v.active);
    this.voices.push(new Voice(t, tone, key, t.key, t.velocity, rhythmPan, gate, this.rom, this.waveCache, this.mixerRate));
  }
}
