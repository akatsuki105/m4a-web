// 音の出口: アプリ全体で1つの AudioContext と、全体の音量 (localStorage に保存する)
// 鳴らす音 → analyser (スペクトラム用, 音量に左右されないよう音量の手前) → gain (全体の音量) → スピーカー

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

type Output = { ctx: AudioContext; input: AudioNode; analyser: AnalyserNode; gain: GainNode };

let volume = loadVolume();
let muted = false;
let output: Output | null = null;
const listeners = new Set<() => void>();

const apply = () => {
  if (output) output.gain.gain.value = muted ? 0 : volume;
  for (const f of listeners) f();
};

export const setVolume = (v: number) => {
  volume = Math.max(0, Math.min(1, v));
  muted = false;
  try {
    localStorage.setItem(VOLUME_KEY, String(volume));
  } catch {
    // 保存できなくても (プライベートブラウズなど) 今の画面では効く
  }
  apply();
};

export const setMuted = (v: boolean) => {
  muted = v;
  apply();
};

// 鳴らすときに初めて作る (ブラウザはユーザー操作の前に AudioContext を鳴らさない)
export const audioOutput = (): Output => {
  if (!output) {
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.75;
    const gain = ctx.createGain();
    gain.gain.value = muted ? 0 : volume;
    analyser.connect(gain);
    gain.connect(ctx.destination);
    output = { ctx, input: analyser, analyser, gain };
  }
  if (output.ctx.state === "suspended") output.ctx.resume();
  return output;
};

// まだ鳴らしていなければ null (画面の描画から AudioContext を作らないため)
export const peekAnalyser = (): AnalyserNode | null => output?.analyser ?? null;

export const useVolume = (): { volume: number; muted: boolean } => {
  const [state, setState] = useState({ volume, muted });
  useEffect(() => {
    const f = () => setState({ volume, muted });
    listeners.add(f);
    return () => void listeners.delete(f);
  }, []);
  return state;
};
