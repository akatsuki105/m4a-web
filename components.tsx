// 画面のあちこちで使う小さな部品

import type { FunctionComponent } from "preact";

export const hex8 = (n: number) => `0x${n.toString(16).toUpperCase().padStart(8, "0")}`;

// 1:05, 1:02:03
export const formatTime = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
};

// ROM ごとのジャケットの色 (ゲームコードなどから色相を決める)
export const coverStyle = (seed: string) => {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) % 360;
  return { background: `linear-gradient(135deg, hsl(${h} 70% 58%), hsl(${(h + 50) % 360} 75% 42%))` };
};

// 数値の入力欄と、1ずつ前後させるボタン
export const NumberStepper: FunctionComponent<{ label: string; value: number; min: number; max: number; onChange: (v: number) => void }> = ({ label, value, min, max, onChange }) => {
  const set = (v: number) => onChange(Math.max(min, Math.min(max, v)));
  return (
    <span class="stepper">
      <label>
        {label} <input type="number" min={min} max={max} value={value} onInput={(e) => set(Number(e.currentTarget.value))} />
      </label>
      <button type="button" class="ghost small" onClick={() => set(value - 1)}>−</button>
      <button type="button" class="ghost small" onClick={() => set(value + 1)}>+</button>
    </span>
  );
};
