// 画面の下の再生バー: 今の曲・操作ボタン・シークバー・音量

import type { FunctionComponent } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { ROM } from "./rom.ts";
import { type Player, songTitle } from "./use_player.ts";
import { playback } from "./playback.ts";
import { setMuted, setVolume, useVolume } from "./audio.ts";
import { coverStyle, formatTime } from "./components.tsx";
import { CartridgeIcon, MuteIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, RepeatIcon, RepeatOneIcon, ShuffleIcon, VisualizerIcon, VolumeIcon } from "./icons.tsx";

const REPEAT_LABEL = { off: "繰り返しなし (R)", all: "全曲を繰り返す (R)", one: "1 曲を繰り返す (R)" };

// 再生位置: 再生中は描画のたびに読む
const usePosition = (playing: boolean) => {
  const [pos, setPos] = useState(playback.position());
  useEffect(() => {
    const update = () => setPos(playback.position());
    const unsubscribe = playback.subscribe(update);
    if (!playing) return unsubscribe;
    let raf = 0;
    const loop = () => {
      update();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
    };
  }, [playing]);
  return pos;
};

// 範囲のつまみ: 済んだところをアクセントの色で塗る
const Range: FunctionComponent<{ class: string; value: number; max: number; step: number; disabled?: boolean; label: string; onInput: (v: number) => void }> = (p) => (
  <input
    type="range"
    class={`range ${p.class}`}
    min={0}
    max={p.max || 1}
    step={p.step}
    value={p.value}
    disabled={p.disabled}
    aria-label={p.label}
    style={{ "--pct": `${p.max ? Math.min(100, (p.value / p.max) * 100) : 0}%` }}
    onInput={(e) => p.onInput(Number(e.currentTarget.value))}
  />
);

// player が null なら ROM を開いていない (操作できない)
export const PlayerBar: FunctionComponent<{ rom: ROM | null; player: Player | null; duration: number; showVisualizer: boolean; setShowVisualizer: (v: boolean) => void }> = ({ rom, player, duration, showVisualizer, setShowVisualizer }) => {
  const playing = player?.playing ?? false;
  const pos = usePosition(playing);
  const { volume, muted } = useVolume();
  const current = player?.current ?? null;
  const total = playback.loaded ? playback.duration : duration;
  const none = !player;

  return (
    <footer class="playerbar">
      <div class="pb-now">
        {rom && current !== null
          ? (
            <>
              <span class="cover cover-m" style={coverStyle(rom.code || rom.name)}>
                <CartridgeIcon size={22} />
              </span>
              <span class="pb-text">
                <span class="pb-title">{songTitle(current)}</span>
                <span class="pb-sub">{rom.title || rom.name}</span>
              </span>
            </>
          )
          : <span class="pb-sub">{rom ? "曲を選んでください" : ""}</span>}
      </div>
      <div class="pb-center">
        <div class="pb-buttons">
          <button type="button" class={player?.shuffle ? "icon-button on" : "icon-button"} disabled={none} title="シャッフル (S)" onClick={() => player?.setShuffle(!player.shuffle)}>
            <ShuffleIcon size={18} />
          </button>
          <button type="button" class="icon-button" disabled={none} title="前の曲 (P)" onClick={() => player?.prev()}>
            <PrevIcon size={20} />
          </button>
          <button type="button" class="play-round" disabled={none} title={playing ? "一時停止 (Space)" : "再生 (Space)"} onClick={() => player?.toggle()}>
            {playing ? <PauseIcon size={20} /> : <PlayIcon size={20} />}
          </button>
          <button type="button" class="icon-button" disabled={none} title="次の曲 (N)" onClick={() => player?.next()}>
            <NextIcon size={20} />
          </button>
          <button type="button" class={player && player.repeat !== "off" ? "icon-button on" : "icon-button"} disabled={none} title={REPEAT_LABEL[player?.repeat ?? "off"]} onClick={() => player?.cycleRepeat()}>
            {player?.repeat === "one" ? <RepeatOneIcon size={18} /> : <RepeatIcon size={18} />}
          </button>
        </div>
        <div class="pb-seek">
          <span class="time">{formatTime(current === null ? 0 : pos)}</span>
          <Range class="seek" value={current === null ? 0 : pos} max={total} step={0.01} disabled={current === null} label="再生位置" onInput={(v) => player?.seek(v)} />
          <span class="time">{current === null || !total ? "-:--" : formatTime(total)}</span>
        </div>
      </div>
      <div class="pb-right">
        <button type="button" class={showVisualizer ? "icon-button on" : "icon-button"} title="再生中の表示" onClick={() => setShowVisualizer(!showVisualizer)}>
          <VisualizerIcon size={18} />
        </button>
        <button type="button" class="icon-button" title={muted ? "消音を解除 (M)" : "消音 (M)"} onClick={() => setMuted(!muted)}>
          {muted || volume === 0 ? <MuteIcon size={18} /> : <VolumeIcon size={18} />}
        </button>
        <Range class="volume" value={muted ? 0 : volume} max={1} step={0.01} label="音量" onInput={setVolume} />
      </div>
    </footer>
  );
};
