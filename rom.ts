// 読み込んだ ROM と、カートリッジヘッダのタイトル・ゲームコード

export type ROM = {
  name: string; // ファイル名
  data: DataView;
  title: string; // 0xA0, 12 文字
  code: string; // 0xAC, 4 文字 (ゲームコード)
  version: number; // 0xBC
};

const ascii = (dv: DataView, offset: number, length: number) => {
  let s = "";
  for (let i = 0; i < length; i++) {
    const c = dv.getUint8(offset + i);
    if (c === 0) break;
    s += c >= 0x20 && c < 0x7F ? String.fromCharCode(c) : "?";
  }
  return s.trim();
};

export const loadROM = (name: string, buffer: ArrayBuffer): ROM => {
  if (buffer.byteLength < 0xC0) throw new Error(`Too small for a GBA ROM: ${buffer.byteLength} bytes (${name})`);
  const data = new DataView(buffer);
  // カートリッジヘッダの 0xB2 は必ず 0x96 (実機がこれを見て起動する). ROM でないファイルを開いて保存しないため
  if (data.getUint8(0xB2) !== 0x96) throw new Error(`Not a GBA ROM: ${name}`);
  return { name, data, title: ascii(data, 0xA0, 12), code: ascii(data, 0xAC, 4), version: data.getUint8(0xBC) };
};
