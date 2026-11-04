// 開いている ROM の画面: 見出し・設定・曲の一覧・再生中の表示・下の再生バー
// ROM や曲テーブルを変えるとこのコンポーネントごと作り直す (再生も止まる)

import type { FunctionComponent } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { encodeWav, type Engine, isRomPointer, measureSong, MIXER_RATES, readSongHeader, readSongTable, type RenderOptions, renderSong, type SongHeader } from "./m4a/mod.ts";
import type { ROM } from "./rom.ts";
import { type Player, type Song, songTitle, usePlayer } from "./use_player.ts";
import { coverStyle, formatTime, hex8, NumberStepper } from "./components.tsx";
import { CartridgeIcon, DownloadIcon, GearIcon, MoreIcon, PauseIcon, PlayIcon, ShuffleIcon } from "./icons.tsx";
import { PlayerBar } from "./view_playerbar.tsx";
import { NowPlaying } from "./view_nowplaying.tsx";
import { setMuted, setVolume, useVolume } from "./audio.ts";
import { playback } from "./playback.ts";

// 書き出しの設定 (ROM から読んだもの, 画面で変えたもの)
export type PlaySettings = {
  mixerRate: number; // ミキサーのサンプリング周波数 (Hz)
  maxVoices: number; // DirectSound の同時発音数
  loops: number; // GOTO で戻った回数がこれになったらフェードアウトする
  reverb: number; // 曲ヘッダがリバーブを指定していないときのリバーブ (ROM の m4aSoundMode の値, 0-127)
};

export const renderOptions = (s: PlaySettings): RenderOptions => ({ loops: s.loops, mixerRate: s.mixerRate, maxDirectVoices: s.maxVoices, reverb: s.reverb });

const tryHeader = (rom: DataView, address: number): SongHeader | null => {
  try {
    return readSongHeader(rom, address);
  } catch {
    return null;
  }
};

const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable);
};

export const Session: FunctionComponent<{
  rom: ROM;
  engine: Engine | null;
  table: number | null;
  setTable: (v: number | null) => void;
  settings: PlaySettings;
  setSettings: (s: PlaySettings) => void;
  showVisualizer: boolean;
  setShowVisualizer: (v: boolean) => void;
}> = ({ rom, engine, table, setTable, settings, setSettings, showVisualizer, setShowVisualizer }) => {
  const songs = useMemo<Song[]>(() => {
    if (table === null) return [];
    return readSongTable(rom.data, table).map((entry) => {
      const header = tryHeader(rom.data, entry.header);
      return { entry, header, playable: (header?.trackCount ?? 0) > 0 };
    });
  }, [rom, table]);

  const opts = renderOptions(settings);
  const renderKey = `${settings.loops}/${settings.mixerRate}/${settings.maxVoices}/${settings.reverb}`;
  const player = usePlayer(rom, songs, opts, renderKey);
  const durations = useDurations(rom, songs, opts, renderKey);
  useShortcuts(player);

  return (
    <>
      <main class="main">
        <MainView rom={rom} engine={engine} table={table} setTable={setTable} settings={settings} setSettings={setSettings} songs={songs} durations={durations} player={player} />
      </main>
      {showVisualizer && <NowPlaying rom={rom} player={player} songs={songs} />}
      <PlayerBar rom={rom} player={player} duration={player.current === null ? 0 : durations[player.current] ?? 0} showVisualizer={showVisualizer} setShowVisualizer={setShowVisualizer} />
    </>
  );
};

// 曲の長さ: 一覧を先に出してから、少しずつ測って埋めていく (全部で 0.1-0.2 秒ほど)
const useDurations = (rom: ROM, songs: Song[], opts: RenderOptions, renderKey: string) => {
  const [durations, setDurations] = useState<(number | undefined)[]>([]);
  useEffect(() => {
    let cancelled = false;
    const out: (number | undefined)[] = new Array(songs.length);
    let i = 0;
    const step = () => {
      if (cancelled) return;
      const until = performance.now() + 12;
      for (; i < songs.length && performance.now() < until; i++) {
        if (!songs[i].playable) continue;
        try {
          out[i] = measureSong(rom.data, songs[i].entry.header, opts).seconds;
        } catch {
          // 壊れた曲は長さを出さない
        }
      }
      setDurations(out.slice());
      if (i < songs.length) setTimeout(step, 0);
    };
    setDurations([]);
    const id = setTimeout(step, 0);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [songs, renderKey]);
  return durations;
};

// キーボード: スペースで再生・一時停止, ←→ でシーク, N / P (Shift+→ / Shift+←) で次・前の曲, ↑↓ で音量, M で消音, R で繰り返し, S でシャッフル
const useShortcuts = (player: Player) => {
  const volume = useVolume();
  const latest = useRef({ player, volume });
  latest.current = { player, volume };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      const { player: p, volume: v } = latest.current;
      const pos = () => playback.position();
      let handled = true;
      switch (e.key) {
        case " ":
          p.toggle();
          break;
        case "ArrowRight":
          if (e.shiftKey) p.next();
          else p.seek(pos() + 5);
          break;
        case "ArrowLeft":
          if (e.shiftKey) p.prev();
          else p.seek(pos() - 5);
          break;
        case "n":
        case "N":
          p.next();
          break;
        case "p":
        case "P":
          p.prev();
          break;
        case "ArrowUp":
          setVolume(v.volume + 0.05);
          break;
        case "ArrowDown":
          setVolume(v.volume - 0.05);
          break;
        case "m":
        case "M":
          setMuted(!v.muted);
          break;
        case "r":
        case "R":
          p.cycleRepeat();
          break;
        case "s":
        case "S":
          p.setShuffle(!p.shuffle);
          break;
        default:
          handled = false;
      }
      if (handled) e.preventDefault();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
};

const MainView: FunctionComponent<{
  rom: ROM;
  engine: Engine | null;
  table: number | null;
  setTable: (v: number | null) => void;
  settings: PlaySettings;
  setSettings: (s: PlaySettings) => void;
  songs: Song[];
  durations: (number | undefined)[];
  player: Player;
}> = ({ rom, engine, table, setTable, settings, setSettings, songs, durations, player }) => {
  const [showSettings, setShowSettings] = useState(engine === null);
  const [hideEmpty, setHideEmpty] = useState(true);
  const playableCount = songs.filter((s) => s.playable).length;
  const total = durations.reduce<number>((a, d) => a + (d ?? 0), 0);
  const measuredAll = durations.filter((d) => d !== undefined).length === playableCount;

  return (
    <>
      <header class="hero">
        <div class="hero-cover" style={coverStyle(rom.code || rom.name)}>
          <CartridgeIcon size={56} />
          <span class="hero-code">{rom.code}</span>
        </div>
        <div class="hero-text">
          <div class="eyebrow">GBA · MP2K</div>
          <h1 title={rom.name}>{rom.title || rom.name}</h1>
          <div class="hero-meta">
            {rom.code ? `${rom.code} rev${rom.version} · ` : ""}
            {table === null ? "曲テーブルが見つかりません" : `${playableCount} 曲`}
            {table !== null && total > 0 && ` · ${measuredAll ? "" : "約 "}${formatTime(total)}`}
            {table !== null && ` · ${settings.mixerRate} Hz`}
          </div>
          <div class="hero-actions">
            <button type="button" class="play-big" title={player.playing ? "一時停止" : "再生"} disabled={playableCount === 0} onClick={player.toggle}>
              {player.playing ? <PauseIcon size={26} /> : <PlayIcon size={26} />}
            </button>
            <button type="button" class={player.shuffle ? "icon-button on" : "icon-button"} title="シャッフル (S)" onClick={() => player.setShuffle(!player.shuffle)}>
              <ShuffleIcon size={22} />
            </button>
            <label class="chip">
              <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.currentTarget.checked)} /> 空の曲を隠す
            </label>
            <button type="button" class={showSettings ? "icon-button on" : "icon-button"} title="曲テーブルと再生の設定" onClick={() => setShowSettings(!showSettings)}>
              <GearIcon size={22} />
            </button>
          </div>
        </div>
      </header>
      {showSettings && <SettingsPanel engine={engine} table={table} setTable={setTable} settings={settings} setSettings={setSettings} />}
      {player.error && <p class="banner error">書き出せませんでした: {player.error}</p>}
      {table === null ? <p class="banner">m4a のドライバが見つかりませんでした。曲テーブルの位置が分かっていれば、設定の「曲テーブル」に入れてください。</p> : <SongTable rom={rom} songs={songs} durations={durations} player={player} hideEmpty={hideEmpty} settings={settings} />}
    </>
  );
};

const SongTable: FunctionComponent<{ rom: ROM; songs: Song[]; durations: (number | undefined)[]; player: Player; hideEmpty: boolean; settings: PlaySettings }> = ({ rom, songs, durations, player, hideEmpty, settings }) => {
  const [menu, setMenu] = useState<number | null>(null);

  // 再生中の曲が見えるようにスクロールする (曲が変わったときだけ)
  useEffect(() => {
    document.querySelector(".song-row.current")?.scrollIntoView({ block: "nearest" });
  }, [player.current]);

  // メニューの外を押すか Esc で閉じる
  useEffect(() => {
    if (menu === null) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !(e.target as HTMLElement).closest(".song-menu, .more")) setMenu(null);
    };
    addEventListener("pointerdown", close);
    addEventListener("keydown", close);
    return () => {
      removeEventListener("pointerdown", close);
      removeEventListener("keydown", close);
    };
  }, [menu]);

  if (songs.length === 0) return <p class="banner">曲テーブルに曲がありません</p>;

  return (
    <div class="song-table" role="table">
      <div class="song-row head" role="row">
        <span class="c-num">#</span>
        <span class="c-title">タイトル</span>
        <span class="c-tracks">トラック</span>
        <span class="c-player">プレーヤ</span>
        <span class="c-time">長さ</span>
        <span class="c-more" />
      </div>
      {songs.map((s, i) => {
        if (hideEmpty && !s.playable) return null;
        const isCurrent = player.current === i;
        const cls = ["song-row", s.playable ? "" : "empty", isCurrent ? "current" : "", isCurrent && player.playing ? "playing" : ""].filter(Boolean).join(" ");
        return (
          <div key={i} class={cls} role="row" onDblClick={() => s.playable && player.playIndex(i)}>
            <span class="c-num">
              <span class="num">{i}</span>
              {isCurrent && player.playing && (
                <span class="eq" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              )}
              {s.playable && (
                <button type="button" class="row-play" title={isCurrent && player.playing ? "一時停止" : "再生"} onClick={() => (isCurrent ? player.toggle() : player.playIndex(i))}>
                  {isCurrent && player.playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
                </button>
              )}
            </span>
            <span class="c-title">
              <span class="title">{songTitle(i)}</span>
              {!s.playable && <span class="tag">{s.header ? "空" : "不正"}</span>}
            </span>
            <span class="c-tracks">{s.header?.trackCount ?? "-"}</span>
            <span class="c-player">{s.entry.ms}</span>
            <span class="c-time">{s.playable ? (durations[i] === undefined ? "" : formatTime(durations[i]!)) : ""}</span>
            <span class="c-more">
              <button type="button" class="more icon-button" title="曲の情報と保存" onClick={() => setMenu(menu === i ? null : i)}>
                <MoreIcon size={18} />
              </button>
              {menu === i && <SongMenu rom={rom} song={s} index={i} settings={settings} close={() => setMenu(null)} />}
            </span>
          </div>
        );
      })}
    </div>
  );
};

// 曲の「…」メニュー: 曲ヘッダの情報と WAV での保存
const SongMenu: FunctionComponent<{ rom: ROM; song: Song; index: number; settings: PlaySettings; close: () => void }> = ({ rom, song, index, settings, close }) => {
  const h = song.header;
  const rows: [string, string | number][] = [
    ["header", hex8(song.entry.header)],
    ...(h
      ? [
        ["tracks", h.trackCount],
        ["voicegroup", hex8(h.voicegroup)],
        ["priority", h.priority],
        ["reverb", h.reverb & 0x80 ? h.reverb & 0x7F : `${settings.reverb} (ROM の既定)`],
      ] as [string, string | number][]
      : []),
    ["player", song.entry.ms],
  ];

  const download = () => {
    const r = renderSong(rom.data, song.entry.header, renderOptions(settings));
    const url = URL.createObjectURL(new Blob([encodeWav(r.sampleRate, r.left, r.right)], { type: "audio/wav" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${rom.name.replace(/\.[^.]*$/, "")}_song${String(index).padStart(3, "0")}.wav`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    close();
  };

  return (
    <div class="song-menu" role="menu">
      <div class="menu-title">{songTitle(index)}</div>
      <table class="menu-info">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th>{k}</th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {song.playable && (
        <button type="button" class="menu-item" onClick={download}>
          <DownloadIcon size={16} /> WAV で保存
        </button>
      )}
    </div>
  );
};

// 曲テーブルの位置とミキサーなどの設定, 検出の結果
const SettingsPanel: FunctionComponent<{ engine: Engine | null; table: number | null; setTable: (v: number | null) => void; settings: PlaySettings; setSettings: (s: PlaySettings) => void }> = ({ engine, table, setTable, settings, setSettings }) => {
  const [text, setText] = useState(table === null ? "" : hex8(table));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setText(table === null ? "" : hex8(table));
    setInvalid(false);
  }, [table]);

  // 0x0825E56C や 25E56C (ROM の中の位置) のどちらでもよい
  const commit = () => {
    const s = text.trim();
    if (s === "") return;
    const n = parseInt(s.replace(/^0x/i, ""), 16);
    const address = Number.isNaN(n) ? NaN : n < 0x08000000 ? n + 0x08000000 : n;
    if (!isRomPointer(address)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (address !== table) setTable(address);
  };

  const mode = engine?.soundMode;
  return (
    <section class="settings">
      <div class="settings-grid">
        <label>
          <span>曲テーブル</span>
          <span class="row">
            <input
              type="text"
              class={invalid ? "mono invalid" : "mono"}
              size={12}
              value={text}
              placeholder="0x08xxxxxx"
              onInput={(e) => setText(e.currentTarget.value)}
              onChange={commit}
              onKeyDown={(e) => e.key === "Enter" && commit()}
            />
            {engine && table !== engine.songTable && <button type="button" class="ghost small" onClick={() => setTable(engine.songTable)}>検出した位置に戻す</button>}
          </span>
        </label>
        <label>
          <span>ミキサー</span>
          <select value={settings.mixerRate} onChange={(e) => setSettings({ ...settings, mixerRate: Number(e.currentTarget.value) })}>
            {MIXER_RATES.slice(1).map((r) => <option key={r} value={r}>{r} Hz{r === mode?.mixerRate ? " (ROM)" : ""}</option>)}
          </select>
        </label>
        <div class="field">
          <span>同時発音数</span>
          <NumberStepper label="" value={settings.maxVoices} min={1} max={12} onChange={(v) => setSettings({ ...settings, maxVoices: v })} />
        </div>
        <div class="field">
          <span>ループ回数</span>
          <NumberStepper label="" value={settings.loops} min={1} max={9} onChange={(v) => setSettings({ ...settings, loops: v })} />
        </div>
      </div>
      <p class="muted small mono">
        {engine ? <>m4aSongNumStart {hex8(engine.songNumStart)} で検出 / {mode ? `m4aSoundMode ${hex8(mode.raw)} (同時発音数 ${mode.maxChans}, 音量 ${mode.masterVolume}, ${mode.mixerRate} Hz, DAC ${mode.dacBits} bit${mode.reverb & 0x80 ? `, リバーブ ${mode.reverb & 0x7F}` : ""}) / MusicPlayer ${engine.musicPlayers}` : "m4aSoundMode の引数は見つかりませんでした"}</> : "m4a のドライバは見つかりませんでした"}
      </p>
      <p class="muted small">ループ回数は曲データの GOTO で戻った回数で、その回数に来たらフェードアウトします。リバーブは実機と同じ仕組みで掛けますが、実機のミキサー (低い周波数で混ぜて 8 ビットに落とすこと) は再現しておらず、実機より澄んだ音になります。</p>
    </section>
  );
};
