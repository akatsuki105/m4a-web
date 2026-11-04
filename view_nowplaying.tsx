// 右の「再生中」: スペクトラムと、トラックごとの音量・鳴っている鍵盤
// スペクトラムは鳴っている音 (AnalyserNode) から、トラックは書き出したときの記録 (Trace) の今の位置のフレームから描く

import type { FunctionComponent } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { FRAME_RATE, type Trace } from "./m4a/mod.ts";
import type { ROM } from "./rom.ts";
import { type Player, type Song, songTitle } from "./use_player.ts";
import { playback } from "./playback.ts";
import { peekAnalyser } from "./audio.ts";
import { coverStyle, songInfoRows } from "./components.tsx";
import { CartridgeIcon } from "./icons.tsx";

const BARS = 56;
const KEY_LO = 24, KEY_HI = 108; // 鍵盤に出す範囲 (C1 - B7), 外れたものは端に出す
const ROW = 16; // トラック 1 本の高さ (CSS ピクセル)
const BLACK = new Set([1, 3, 6, 8, 10]);

// CSS の変数の色: light-dark() はそのままでは canvas に渡せないので、要素の color に入れて計算させた値を読む
// (ライト・ダークの切り替えに追いつくよう、ときどき読み直す)
let probe: HTMLSpanElement | null = null;
let colors = new Map<string, string>();
let colorsAt = 0;
const css = (name: string) => {
  if (performance.now() - colorsAt > 1000) colors = new Map(), colorsAt = performance.now();
  let c = colors.get(name);
  if (c === undefined) {
    if (!probe) {
      probe = document.createElement("span");
      probe.style.display = "none";
      document.body.append(probe);
    }
    probe.style.color = `var(${name})`;
    c = getComputedStyle(probe).color;
    colors.set(name, c);
  }
  return c;
};
const font = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const trackColor = (t: number, alpha = 1) => `hsl(${(t * 47 + 250) % 360} 80% 62% / ${alpha})`;

// canvas の大きさを表示の大きさ (と画素密度) に合わせる. 変わったら true
const fit = (canvas: HTMLCanvasElement, height: number) => {
  const dpr = devicePixelRatio || 1;
  const w = Math.round(canvas.clientWidth * dpr), h = Math.round(height * dpr);
  if (canvas.width === w && canvas.height === h) return false;
  canvas.width = w, canvas.height = h;
  return true;
};

const drawSpectrum = (canvas: HTMLCanvasElement, bins: Uint8Array<ArrayBuffer>, smooth: Float32Array) => {
  fit(canvas, canvas.clientHeight);
  const ctx = canvas.getContext("2d")!;
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (W < BARS * 2 || H === 0) return; // 隠れている (狭い画面で表示しないとき) か狭すぎる
  const analyser = peekAnalyser();
  if (analyser && playback.playing) analyser.getByteFrequencyData(bins);
  else bins.fill(0);
  const nyquist = (analyser?.context.sampleRate ?? 44100) / 2;
  const gap = Math.max(1, W / BARS * 0.25), bw = W / BARS - gap;
  const grad = ctx.createLinearGradient(0, H, 0, 0);
  grad.addColorStop(0, css("--accent"));
  grad.addColorStop(1, css("--accent-2"));
  ctx.fillStyle = grad;
  for (let b = 0; b < BARS; b++) {
    // 40 Hz - 16 kHz を対数で分ける
    const f0 = 40 * Math.pow(400, b / BARS), f1 = 40 * Math.pow(400, (b + 1) / BARS);
    const i0 = Math.floor((f0 / nyquist) * bins.length), i1 = Math.max(i0 + 1, Math.floor((f1 / nyquist) * bins.length));
    let v = 0;
    for (let i = i0; i < i1 && i < bins.length; i++) v = Math.max(v, bins[i]);
    smooth[b] = Math.max(v / 255, smooth[b] * 0.9); // 落ちるときはゆっくり
    const h = Math.max(2, smooth[b] * H);
    ctx.beginPath();
    ctx.roundRect(b * (bw + gap) + gap / 2, H - h, bw, h, Math.min(3, bw / 2));
    ctx.fill();
  }
};

const drawTracks = (canvas: HTMLCanvasElement, trace: Trace | null) => {
  const tracks = trace?.tracks ?? 0;
  fit(canvas, tracks * ROW);
  const ctx = canvas.getContext("2d")!;
  const dpr = devicePixelRatio || 1;
  const W = canvas.width;
  ctx.clearRect(0, 0, W, canvas.height);
  if (!trace || !tracks) return;
  const frame = Math.max(0, Math.min(trace.frames - 1, Math.floor(playback.position() * FRAME_RATE)));
  const labelW = 26 * dpr, meterW = 44 * dpr, kbX = labelW + meterW + 8 * dpr, kbW = W - kbX;
  const keyW = kbW / (KEY_HI - KEY_LO);
  const rowH = ROW * dpr;
  const muted = css("--muted"), white = css("--key-white"), black = css("--key-black"), meterBg = css("--meter-bg");
  ctx.font = `${11 * dpr}px ${font("--font-mono")}`;
  ctx.textBaseline = "middle";
  for (let t = 0; t < tracks; t++) {
    const y = t * rowH, cy = y + rowH / 2, h = rowH - 3 * dpr;
    const level = trace.levels[frame * tracks + t] / 255;
    // トラック番号
    ctx.fillStyle = level > 0 ? trackColor(t) : muted;
    ctx.fillText(String(t + 1).padStart(2, " "), 2 * dpr, cy);
    // 音量
    ctx.fillStyle = meterBg;
    ctx.fillRect(labelW, y + 1.5 * dpr, meterW, h);
    ctx.fillStyle = trackColor(t);
    ctx.fillRect(labelW, y + 1.5 * dpr, meterW * level, h);
    // 鍵盤 (半音ごとの列, 黒鍵は暗く)
    for (let k = KEY_LO; k < KEY_HI; k++) {
      ctx.fillStyle = BLACK.has(k % 12) ? black : white;
      ctx.fillRect(kbX + (k - KEY_LO) * keyW, y + 1.5 * dpr, Math.max(1, keyW - 0.5 * dpr), h);
    }
    const base = (frame * tracks + t) * trace.keysPerTrack;
    ctx.fillStyle = trackColor(t, 0.35 + 0.65 * level);
    for (let n = 0; n < trace.keysPerTrack; n++) {
      const key = trace.keys[base + n];
      if (key === 0xFF) break;
      const k = Math.max(KEY_LO, Math.min(KEY_HI - 1, key));
      ctx.fillRect(kbX + (k - KEY_LO) * keyW - keyW * 0.5, y + 0.5 * dpr, keyW * 2, rowH - 1 * dpr);
    }
  }
};

export const NowPlaying: FunctionComponent<{ rom: ROM; player: Player; songs: Song[]; defaultReverb: number }> = ({ rom, player, songs, defaultReverb }) => {
  const spectrum = useRef<HTMLCanvasElement>(null);
  const tracks = useRef<HTMLCanvasElement>(null);
  const trace = useRef(player.trace);
  trace.current = player.trace;

  // 描画は画面の更新ごと (止めているときもシークに追いつくように回し続ける)
  useEffect(() => {
    const bins = new Uint8Array(1024);
    const smooth = new Float32Array(BARS);
    let raf = 0;
    const loop = () => {
      if (spectrum.current) drawSpectrum(spectrum.current, bins, smooth);
      if (tracks.current) drawTracks(tracks.current, trace.current);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const current = player.current;
  const song = current === null ? null : songs[current];
  return (
    <aside class="nowplaying">
      <div class="np-head">Now playing</div>
      <div class="np-card">
        <div class="np-cover" style={coverStyle(rom.code || rom.name)}>
          <CartridgeIcon size={40} />
        </div>
        <div class="np-title">{current === null ? "—" : songTitle(current)}</div>
        <div class="np-sub">{rom.title || rom.name}</div>
        {song && (
          <table class="np-info">
            <tbody>
              {songInfoRows(song, defaultReverb).map(([k, v]) => (
                <tr key={k}>
                  <th>{k}</th>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <canvas ref={spectrum} class="np-spectrum" />
      <div class="np-section">
        Tracks
        {player.trace && <span class="muted">· {player.trace.tracks}</span>}
      </div>
      {player.trace ? <canvas ref={tracks} class="np-tracks" style={{ height: `${player.trace.tracks * ROW}px` }} /> : <p class="muted small">Play a song to see the notes on each track</p>}
    </aside>
  );
};
