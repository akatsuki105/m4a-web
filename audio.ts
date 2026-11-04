// 音の出口: アプリ全体で1つの AudioContext と、全体の音量 (localStorage に保存する)

import { useEffect, useState } from "preact/hooks";

const VOLUME_KEY = "m4a-web.volume";

const loadVolume = (): number => {
  try {
    const s = localStorage.getItem(VOLUME_KEY);
    const v = s === null ? NaN : Number(s);
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.8;
  } catch {
    return 0.8;
  }
};

let volume = loadVolume();
let output: { ctx: AudioContext; dest: GainNode } | null = null;
const listeners = new Set<(v: number) => void>();

export const getVolume = () => volume;

export const setVolume = (v: number) => {
  volume = Math.max(0, Math.min(1, v));
  try {
    localStorage.setItem(VOLUME_KEY, String(volume));
  } catch {
    // 保存できなくても (プライベートブラウズなど) 今の画面では効く
  }
  if (output) output.dest.gain.value = volume;
  for (const f of listeners) f(volume);
};

// 鳴らすときに初めて作る (ブラウザはユーザー操作の前に AudioContext を鳴らさない)
export const audioOutput = (): { ctx: AudioContext; dest: GainNode } => {
  if (!output) {
    const ctx = new AudioContext();
    const dest = ctx.createGain();
    dest.gain.value = volume;
    dest.connect(ctx.destination);
    output = { ctx, dest };
  }
  if (output.ctx.state === "suspended") output.ctx.resume();
  return output;
};

export const useVolume = (): [number, (v: number) => void] => {
  const [v, setV] = useState(volume);
  useEffect(() => {
    listeners.add(setV);
    return () => void listeners.delete(setV);
  }, []);
  return [v, setVolume];
};
