// ROM の中の MP2K (m4a) のデータを読む
// 構造は m4a の SongHeader / ToneData / WaveData (include/gba/m4a_internal.h in pokeemerald など) と同じ
// アドレスは GBA のアドレス (0x08000000 から), ROM の DataView は ROM ファイル全体

export const ROM_BASE = 0x08000000;

export const isRomPointer = (p: number) => p >= ROM_BASE && p < ROM_BASE + 0x02000000;
export const toOffset = (p: number) => (p >= ROM_BASE ? p - ROM_BASE : p);

// 曲テーブルの1項目 (struct Song)
export type SongEntry = {
  index: number;
  header: number; // SongHeader のアドレス
  ms: number; // 使う MusicPlayer の番号
  me: number;
};

// 曲テーブル (gSongTable) を読む
// count を省くと、曲ヘッダが置かれている一番手前の位置か、ポインタでないものに当たるまでを曲テーブルとみなす
export const readSongTable = (rom: DataView, table: number, count?: number): SongEntry[] => {
  const songs: SongEntry[] = [];
  const start = toOffset(table);
  let limit = rom.byteLength;
  for (let i = 0; count === undefined || i < count; i++) {
    const o = start + i * 8;
    if (o + 8 > rom.byteLength || o >= limit) break;
    const header = rom.getUint32(o, true);
    if (!isRomPointer(header)) break;
    const h = toOffset(header);
    if (h > start) limit = Math.min(limit, h);
    songs.push({ index: i, header, ms: rom.getUint16(o + 4, true), me: rom.getUint16(o + 6, true) });
  }
  return songs;
};

// SongHeader
export type SongHeader = {
  address: number;
  trackCount: number;
  blockCount: number;
  priority: number;
  reverb: number; // bit7 が立っていれば下位7ビットをリバーブにする
  voicegroup: number; // ToneData の配列のアドレス
  tracks: number[]; // 各トラックのシーケンスのアドレス
};

export const readSongHeader = (rom: DataView, address: number): SongHeader => {
  const o = toOffset(address);
  const trackCount = rom.getUint8(o);
  const tracks: number[] = [];
  for (let i = 0; i < trackCount; i++) tracks.push(rom.getUint32(o + 8 + i * 4, true));
  return {
    address,
    trackCount,
    blockCount: rom.getUint8(o + 1),
    priority: rom.getUint8(o + 2),
    reverb: rom.getUint8(o + 3),
    voicegroup: rom.getUint32(o + 4, true),
    tracks,
  };
};

// ToneData の type
export const TONE_CGB = 0x07; // 0: DirectSound, 1: 矩形波1 (スイープ), 2: 矩形波2, 3: 波形メモリ, 4: ノイズ
export const TONE_FIX = 0x08; // 音程を変えない (DirectSound)
export const TONE_SPL = 0x40; // キースプリット: wav が音色の配列, keySplitTable[key] がその添字
export const TONE_RHY = 0x80; // リズム (ドラム): wav が音色の配列, key がその添字

// ToneData (12 バイト)
export type Tone = {
  type: number;
  key: number; // リズムのときに鳴らすキー
  length: number; // CGB の音の長さ
  panSweep: number; // DirectSound / リズム: bit7 が立っていればパン (値 - 0xC0), 矩形波1: スイープ
  wav: number; // DirectSound: WaveData のアドレス, 矩形波: デューティ比 (0-3), 波形メモリ: 16 バイトの波形のアドレス, ノイズ: bit0 が周期 (7 ビット)
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  keySplitTable: number; // キースプリットのとき, attack からの4バイト
};

export const readTone = (rom: DataView, address: number): Tone => {
  const o = toOffset(address);
  return {
    type: rom.getUint8(o),
    key: rom.getUint8(o + 1),
    length: rom.getUint8(o + 2),
    panSweep: rom.getUint8(o + 3),
    wav: rom.getUint32(o + 4, true),
    attack: rom.getUint8(o + 8),
    decay: rom.getUint8(o + 9),
    sustain: rom.getUint8(o + 10),
    release: rom.getUint8(o + 11),
    keySplitTable: rom.getUint32(o + 8, true),
  };
};

// voicegroup の index 番目の音色
export const readVoice = (rom: DataView, voicegroup: number, index: number): Tone => readTone(rom, voicegroup + index * 12);

// WaveData
export type Wave = {
  address: number;
  type: number;
  loop: boolean; // status の bit14-15
  freq: number; // キー 60 で鳴らすときのサンプリング周波数 * 1024
  loopStart: number;
  size: number; // サンプル数
  data: Int8Array; // 8 ビット符号付き PCM
};

export const readWave = (rom: DataView, address: number): Wave => {
  const o = toOffset(address);
  const size = rom.getUint32(o + 12, true);
  const n = Math.max(0, Math.min(size, rom.byteLength - (o + 16)));
  return {
    address,
    type: rom.getUint16(o, true),
    loop: (rom.getUint16(o + 2, true) & 0xC000) !== 0,
    freq: rom.getUint32(o + 4, true),
    loopStart: rom.getUint32(o + 8, true),
    size: n,
    data: new Int8Array(rom.buffer, rom.byteOffset + o + 16, n),
  };
};

// 波形メモリの音色の波形 (16 バイト = 4 ビット × 32 サンプル, 上位4ビットが先)
export const readProgWave = (rom: DataView, address: number): Uint8Array => {
  const o = toOffset(address);
  const out = new Uint8Array(32);
  for (let i = 0; i < 16; i++) {
    const b = rom.getUint8(o + i);
    out[i * 2] = b >> 4;
    out[i * 2 + 1] = b & 0xF;
  }
  return out;
};
