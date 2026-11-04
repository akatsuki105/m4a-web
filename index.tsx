// m4a-web: GBA の ROM から MP2K (m4a) の曲テーブルを探し、曲を鳴らす

import { FunctionComponent, render } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { detectEngine, type Engine, isRomPointer, MIXER_RATES, readSongTable } from "./m4a/mod.ts";
import { loadROM, type ROM } from "./rom.ts";
import { hex8, NumberStepper } from "./components.tsx";
import { type PlaySettings, SongViewer, VolumeControl } from "./view_song.tsx";

// ROM の設定が読めなかったときの値 (m4a の SoundInit の既定と同じ)
const DEFAULT_SETTINGS: PlaySettings = { mixerRate: 13379, maxVoices: 12 };

type Loaded = {
  rom: ROM;
  engine: Engine | null; // 見つからなければ null
  serial: number; // 読み込むたびに増やす, 一覧と再生の状態を前の ROM から持ち越さないようにする
};

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

const App = () => {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [table, setTable] = useState<number | null>(null); // 使う曲テーブル (検出したもの, または手で入れたもの)
  const [settings, setSettings] = useState<PlaySettings>(DEFAULT_SETTINGS);

  const setROM = (rom: ROM) => {
    const engine = detectEngine(rom.data);
    setLoaded((prev) => ({ rom, engine, serial: (prev?.serial ?? 0) + 1 }));
    setTable(engine?.songTable ?? null);
    setSettings({
      mixerRate: engine?.soundMode?.mixerRate ?? DEFAULT_SETTINGS.mixerRate,
      maxVoices: engine?.soundMode?.maxChans ?? DEFAULT_SETTINGS.maxVoices,
    });
    setError(null);
  };

  const open = async (file: File) => {
    try {
      setROM(loadROM(file.name, await file.arrayBuffer()));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  // URL の ?rom= で渡された ROM を取得して開く. 相対パスはページの場所から
  const openURL = async (url: string) => {
    try {
      const res = await fetch(new URL(url, location.href));
      if (!res.ok) throw new Error(`Failed to fetch ROM: ${res.status} ${res.statusText} (${url})`);
      setROM(loadROM(url.split("/").pop() || url, await res.arrayBuffer()));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  // 初期画面 (ROM を読み込んでいない状態) に戻す, URL の ?rom= と # も消す
  const reset = (e: Event) => {
    e.preventDefault();
    setLoaded(null);
    setError(null);
    history.pushState(null, "", location.pathname);
  };

  useEffect(() => {
    const romURL = new URLSearchParams(location.search).get("rom");
    if (romURL) openURL(romURL);
  }, []);

  // ウィンドウ全体でドラッグ&ドロップを受け付ける
  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer?.files[0];
      if (file) open(file);
    };
    addEventListener("dragover", over);
    addEventListener("drop", drop);
    return () => {
      removeEventListener("dragover", over);
      removeEventListener("drop", drop);
    };
  }, []);

  const songs = useMemo(() => (loaded && table !== null ? readSongTable(loaded.rom.data, table) : []), [loaded, table]);

  return (
    <div class="app">
      <header class="app-header">
        <h1>
          <a href="./" onClick={reset}>m4a-web</a>
        </h1>
        {/* 読み込み UI は ROM を開いていないときだけ出す (タイトルを押すと戻る, ドロップはいつでも受け付ける) */}
        {!loaded && <ROMUpload open={open} />}
        {loaded && <span class="mono">{loaded.rom.name} ({loaded.rom.title || "?"} / {loaded.rom.code || "?"} rev{loaded.rom.version})</span>}
        {loaded && <VolumeControl />}
        {error && <span class="error">{error}</span>}
      </header>
      {!loaded && <p class="message">GBA の ROM ファイルを選ぶか、ウィンドウにドロップしてください。ROM はブラウザの中だけで読み、どこにも送りません。</p>}
      {loaded && (
        <>
          <EngineBar engine={loaded.engine} table={table} setTable={setTable} settings={settings} setSettings={setSettings} />
          {table === null ? <p class="message">m4a のドライバが見つかりませんでした。曲テーブルの位置が分かっていれば、上の欄に入れてください。</p> : <SongViewer key={`${loaded.serial}/${table}`} rom={loaded.rom} songs={songs} settings={settings} />}
        </>
      )}
    </div>
  );
};

// 検出の結果と、曲テーブル・ミキサーの設定
const EngineBar: FunctionComponent<{ engine: Engine | null; table: number | null; setTable: (v: number | null) => void; settings: PlaySettings; setSettings: (s: PlaySettings) => void }> = ({ engine, table, setTable, settings, setSettings }) => {
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
    <div class="engine-bar">
      <div class="controls">
        <label>
          曲テーブル{" "}
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
        </label>
        {engine && table !== engine.songTable && <button type="button" onClick={() => setTable(engine.songTable)}>検出した位置に戻す</button>}
        <label>
          ミキサー{" "}
          <select value={settings.mixerRate} onChange={(e) => setSettings({ ...settings, mixerRate: Number(e.currentTarget.value) })}>
            {MIXER_RATES.slice(1).map((r) => <option key={r} value={r}>{r} Hz{r === mode?.mixerRate ? " (ROM)" : ""}</option>)}
          </select>
        </label>
        <NumberStepper label="同時発音数" value={settings.maxVoices} min={1} max={12} onChange={(v) => setSettings({ ...settings, maxVoices: v })} />
      </div>
      <p class="dim mono">
        {engine ? <>m4aSongNumStart {hex8(engine.songNumStart)} で検出 / {mode ? `m4aSoundMode ${hex8(mode.raw)} (同時発音数 ${mode.maxChans}, 音量 ${mode.masterVolume}, ${mode.mixerRate} Hz, DAC ${mode.dacBits} bit${mode.reverb & 0x80 ? `, リバーブ ${mode.reverb & 0x7F}` : ""}) / MusicPlayer ${engine.musicPlayers}` : "m4aSoundMode の引数は見つかりませんでした"}</> : "m4a のドライバは見つかりませんでした"}
      </p>
    </div>
  );
};

const ROMUpload: FunctionComponent<{ open: (file: File) => Promise<void> }> = ({ open }) => {
  const [busy, setBusy] = useState(false);

  const handleFiles = async (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (!input.files?.[0]) return;
    setBusy(true);
    await open(input.files[0]);
    setBusy(false);
  };

  return (
    <span>
      <label for="rom-file">ROM</label> <input type="file" id="rom-file" accept=".gba,.bin,.agb" onChange={handleFiles} disabled={busy} />
    </span>
  );
};

render(<App />, document.body);
