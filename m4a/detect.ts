// ROM から MP2K (m4a) のドライバを探し、曲テーブル (gSongTable) とミキサーの設定 (m4aSoundMode の引数) を読む
//
// 探し方は GBA Mus Ripper の sappy_detector (Bregalad, loveemu) と同じ考え方:
// 1. m4aSongNumStart の機械語 (コンパイラの違いで2通り) を ROM から探す
// 2. その関数のリテラルプールにある gSongTable のアドレスを読み、曲ヘッダへのポインタが並んでいるか確かめる
// 3. 少し手前にある m4aSoundInit のリテラルプールから、m4aSoundMode に渡す値・MusicPlayer の数・gMPlayTable を読む
//    (gSongTable は gMPlayTable のすぐ後ろに置かれるので、gMPlayTable + 12 * MusicPlayer の数 が gSongTable になる)
//
// ライブラリをそのまま使っていないゲーム (自前のドライバや改造したもの) では見つからない

import { isRomPointer, ROM_BASE, toOffset } from "./data.ts";

// m4aSongNumStart の先頭 0x1E バイト
// push {lr}; lsl r0, r0, #16; ldr r2, =gSongTable; ldr r1, =gMPlayTable; lsr r0, r0, #16; ... bl MPlayStart
const SONG_NUM_START = [
  [0x00, 0xB5, 0x00, 0x04, 0x07, 0x4A, 0x08, 0x49, 0x40, 0x0B, 0x40, 0x18, 0x83, 0x88, 0x59, 0x00, 0xC9, 0x18, 0x89, 0x00, 0x89, 0x18, 0x0A, 0x68, 0x01, 0x68, 0x10, 0x1C, 0x00, 0xF0],
  // 組み直したライブラリ (ロックマンエグゼ6, MOTHER3, ボクらの太陽2/3 など): レジスタの割り当てが違う
  [0x00, 0xB5, 0x00, 0x04, 0x07, 0x4B, 0x08, 0x49, 0x40, 0x0B, 0x40, 0x18, 0x82, 0x88, 0x51, 0x00, 0x89, 0x18, 0x89, 0x00, 0xC9, 0x18, 0x0A, 0x68, 0x01, 0x68, 0x10, 0x1C, 0x00, 0xF0],
];

// m4aSongNumStart の先頭から gSongTable を置いたリテラルプールまで
const SONG_TABLE_LITERAL = 40;

// m4aSoundMode の freq (bit16-19) -> ミキサーのサンプリング周波数 (Hz), 0 と 13 以上は無効
export const MIXER_RATES = [0, 5734, 7884, 10512, 13379, 15768, 18157, 21024, 26758, 31536, 36314, 40137, 42048];

// m4aSoundMode に渡す値 (SOUND_MODE_*)
export type SoundMode = {
  raw: number;
  reverb: number; // bit7 が立っていれば下位7ビットが全体のリバーブ (曲ヘッダの reverb が優先)
  maxChans: number; // DirectSound の同時発音数
  masterVolume: number; // DirectSound 全体の音量 (0-15)
  freq: number; // MIXER_RATES の添字
  mixerRate: number; // Hz
  dacBits: number; // DAC のビット数 (6-9)
};

export const decodeSoundMode = (raw: number): SoundMode => {
  const freq = (raw >>> 16) & 0xF;
  return {
    raw,
    reverb: raw & 0xFF,
    maxChans: (raw >>> 8) & 0xF,
    masterVolume: (raw >>> 12) & 0xF,
    freq,
    mixerRate: MIXER_RATES[freq] ?? 0,
    dacBits: 17 - ((raw >>> 20) & 0xF),
  };
};

// 実際に使われる値の範囲か (でたらめな値を m4aSoundMode の引数とみなさないため)
const isPlausibleSoundMode = (raw: number) => {
  const m = decodeSoundMode(raw);
  return (raw >>> 24) === 0 && m.masterVolume !== 0 && m.maxChans >= 1 && m.maxChans <= 12 && m.freq >= 1 && m.freq <= 12 && m.dacBits >= 6 && m.dacBits <= 9;
};

export type Engine = {
  songNumStart: number; // m4aSongNumStart の GBA アドレス
  songTable: number; // gSongTable の GBA アドレス
  // m4aSoundInit のリテラルプールから読めたもの (見つからなければ null)
  soundMode: SoundMode | null;
  musicPlayers: number | null; // MusicPlayer の数
  mplayTable: number | null; // gMPlayTable の GBA アドレス
};

const u32 = (rom: DataView, o: number) => (o >= 0 && o + 4 <= rom.byteLength ? rom.getUint32(o, true) : 0);

const matchAt = (rom: DataView, o: number, pattern: number[]) => {
  for (let i = 0; i < pattern.length; i++) if (rom.getUint8(o + i) !== pattern[i]) return false;
  return true;
};

// 曲テーブルらしいか: 先頭から読んで、空でない曲ヘッダへのポインタが1つはあるか
const looksLikeSongTable = (rom: DataView, table: number) => {
  if (!isRomPointer(table)) return false;
  for (let o = toOffset(table); o + 8 <= rom.byteLength; o += 8) {
    const header = u32(rom, o);
    if (header === 0) continue;
    return isRomPointer(header) && toOffset(header) + 8 <= rom.byteLength;
  }
  return false;
};

// m4aSongNumStart の手前 (m4aSoundInit の後ろの方) のリテラルプールから、m4aSoundMode の引数・MusicPlayer の数・gMPlayTable の並びを探す
// 置き場所はゲームによって少し違う (多くは m4aSoundMain の 16 バイト手前, ポケモンは 32 バイト手前) ので、近くを順に見る
// まず gSongTable と辻褄が合う並びを探し、無ければ gMPlayTable の位置は問わずに探す
const SOUND_INIT_SEARCH = 0x60;

const findSoundInit = (rom: DataView, songNumStart: number, songTable: number) => {
  const end = songNumStart - ROM_BASE;
  for (const strict of [true, false]) {
    for (let o = (end - 12) & ~3; o >= Math.max(0, end - SOUND_INIT_SEARCH); o -= 4) {
      const mode = u32(rom, o), players = u32(rom, o + 4), mplayTable = u32(rom, o + 8);
      if (!isPlausibleSoundMode(mode) || players === 0 || players >= 256 || !isRomPointer(mplayTable)) continue;
      if (strict && mplayTable + 12 * players !== songTable) continue;
      return { soundMode: decodeSoundMode(mode), musicPlayers: players, mplayTable };
    }
  }
  return { soundMode: null, musicPlayers: null, mplayTable: null };
};

// ROM 全体から m4a のドライバを探す, 見つからなければ null
// 機械語は Thumb (2 バイト境界) なので 2 バイトずつ見る
export const detectEngine = (rom: DataView): Engine | null => {
  const last = rom.byteLength - SONG_TABLE_LITERAL - 4;
  for (let o = 0; o <= last; o += 2) {
    if (rom.getUint8(o) !== 0x00 || rom.getUint8(o + 1) !== 0xB5) continue; // push {lr}
    if (!SONG_NUM_START.some((p) => matchAt(rom, o, p))) continue;
    // リテラルプールは 4 バイト境界にある
    const songTable = u32(rom, (o + SONG_TABLE_LITERAL + 3) & ~3);
    if (!looksLikeSongTable(rom, songTable)) continue;
    const songNumStart = ROM_BASE + o;
    return { songNumStart, songTable, ...findSoundInit(rom, songNumStart, songTable) };
  }
  return null;
};
