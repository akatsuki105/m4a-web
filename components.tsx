// 画面のあちこちで使う小さな部品

import type { ComponentChildren, FunctionComponent } from "preact";

export const hex8 = (n: number) => `0x${n.toString(16).toUpperCase().padStart(8, "0")}`;

// 詳細の表 (本文の一番下に置く), [項目名, 値] の並び
export const InfoTable: FunctionComponent<{ rows: [string, ComponentChildren][] }> = ({ rows }) => (
  <table class="info-table">
    <tbody>
      {rows.map(([k, v]) => (
        <tr key={k}>
          <th>{k}</th>
          <td>{v}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

// 数値の入力欄と、1ずつ前後させるボタン
export const NumberStepper: FunctionComponent<{ label: string; value: number; min: number; max: number; onChange: (v: number) => void }> = ({ label, value, min, max, onChange }) => {
  const set = (v: number) => onChange(Math.max(min, Math.min(max, v)));
  return (
    <span class="stepper">
      <label>
        {label} <input type="number" min={min} max={max} value={value} onInput={(e) => set(Number(e.currentTarget.value))} />
      </label>
      <button type="button" onClick={() => set(value - 1)}>◀</button>
      <button type="button" onClick={() => set(value + 1)}>▶</button>
    </span>
  );
};
