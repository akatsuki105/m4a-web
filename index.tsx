// m4a-web: GBA の ROM から MP2K (m4a) の曲テーブルを探し、曲を鳴らす

import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { detectEngine, type Engine } from "./m4a/mod.ts";
import { loadROM, type ROM } from "./rom.ts";
import { deleteROM, listROMs, loadROM as loadSavedROM, type SavedROM, saveROM } from "./rom_store.ts";
import { DropZone, Sidebar } from "./view_library.tsx";
import { type PlaySettings, Session } from "./view_session.tsx";
import { PlayerBar } from "./view_playerbar.tsx";

// ROM の設定が読めなかったときの値 (m4a の SoundInit の既定と同じ)
const DEFAULT_SETTINGS: PlaySettings = { mixerRate: 13379, maxVoices: 12, loops: 1 };

const VISUALIZER_KEY = "m4a-web.visualizer";
const loadShowVisualizer = () => {
  try {
    const v = localStorage.getItem(VISUALIZER_KEY);
    return v === null ? innerWidth >= 1200 : v === "1";
  } catch {
    return innerWidth >= 1200;
  }
};

type Loaded = {
  rom: ROM;
  engine: Engine | null; // 見つからなければ null
  savedId: string | null; // ライブラリに保存してあればそのキー (?rom= で開いたものは null)
  serial: number; // 読み込むたびに増やす, 前の ROM の状態を持ち越さないようにする
};

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

const App = () => {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [table, setTable] = useState<number | null>(null); // 使う曲テーブル (検出したもの, または手で入れたもの)
  const [settings, setSettings] = useState<PlaySettings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState<SavedROM[]>([]);
  const [dragging, setDragging] = useState(false);
  const [showVisualizer, setShowVisualizerState] = useState(loadShowVisualizer);
  const serial = useRef(0);

  const setShowVisualizer = (v: boolean) => {
    setShowVisualizerState(v);
    try {
      localStorage.setItem(VISUALIZER_KEY, v ? "1" : "0");
    } catch {
      // 保存できなくても今の画面では効く
    }
  };

  const refreshSaved = () => listROMs().then(setSaved).catch((e) => console.warn("Failed to list saved ROMs:", e));

  const setROM = (rom: ROM, savedId: string | null) => {
    const engine = detectEngine(rom.data);
    setLoaded({ rom, engine, savedId, serial: ++serial.current });
    setTable(engine?.songTable ?? null);
    setSettings({
      mixerRate: engine?.soundMode?.mixerRate ?? DEFAULT_SETTINGS.mixerRate,
      maxVoices: engine?.soundMode?.maxChans ?? DEFAULT_SETTINGS.maxVoices,
      loops: settings.loops, // ループ回数は ROM によらないので引き継ぐ
    });
    setError(null);
  };

  // 手で開いた ROM はライブラリに保存する. 保存できなくても (プライベートブラウズや容量不足など) 再生はできるので警告だけ出す
  const open = async (file: File) => {
    try {
      const data = await file.arrayBuffer();
      const rom = loadROM(file.name, data);
      history.replaceState(null, "", location.pathname); // 前の ROM の ?rom= と #曲 を消す
      setROM(rom, null);
      const s = serial.current;
      saveROM({ name: rom.name, title: rom.title, code: rom.code, version: rom.version }, data)
        .then((meta) => {
          setLoaded((l) => (l && l.serial === s ? { ...l, savedId: meta.id } : l));
          refreshSaved();
        })
        .catch((e) => console.warn("Failed to save ROM:", e));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const openSaved = async (id: string) => {
    if (loaded?.savedId === id) return;
    try {
      const stored = await loadSavedROM(id);
      if (!stored) throw new Error("Saved ROM not found");
      history.replaceState(null, "", location.pathname);
      setROM(loadROM(stored.meta.name, stored.data), id);
    } catch (e) {
      setError(errorMessage(e));
    }
    refreshSaved();
  };

  const remove = (r: SavedROM) => {
    if (!confirm(`「${r.title || r.name}」をライブラリから削除しますか？`)) return;
    deleteROM(r.id)
      .then(() => setLoaded((l) => (l && l.savedId === r.id ? { ...l, savedId: null } : l)))
      .catch((e) => setError(errorMessage(e)))
      .finally(refreshSaved);
  };

  // URL の ?rom= で渡された ROM を取得して開く. 相対パスはページの場所から. 手で開いたものではないので保存しない
  const openURL = async (url: string) => {
    try {
      const res = await fetch(new URL(url, location.href));
      if (!res.ok) throw new Error(`Failed to fetch ROM: ${res.status} ${res.statusText} (${url})`);
      setROM(loadROM(url.split("/").pop() || url, await res.arrayBuffer()), null);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  // 初期画面 (ROM を開いていない状態) に戻す, URL の ?rom= と # も消す
  const home = () => {
    setLoaded(null);
    setError(null);
    history.pushState(null, "", location.pathname);
  };

  useEffect(() => {
    const romURL = new URLSearchParams(location.search).get("rom");
    if (romURL) openURL(romURL);
    refreshSaved();
  }, []);

  // ウィンドウ全体でドラッグ&ドロップを受け付ける (ファイルを重ねている間は目印を出す)
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      depth++;
      setDragging(true);
    };
    const leave = () => {
      if (depth > 0 && --depth === 0) setDragging(false);
    };
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const file = e.dataTransfer?.files[0];
      if (file) openRef.current(file);
    };
    addEventListener("dragenter", enter);
    addEventListener("dragleave", leave);
    addEventListener("dragover", over);
    addEventListener("drop", drop);
    return () => {
      removeEventListener("dragenter", enter);
      removeEventListener("dragleave", leave);
      removeEventListener("dragover", over);
      removeEventListener("drop", drop);
    };
  }, []);

  return (
    <div class={loaded && showVisualizer ? "app with-np" : "app"}>
      <Sidebar saved={saved} current={loaded && { rom: loaded.rom, savedId: loaded.savedId }} open={open} openSaved={openSaved} remove={remove} home={home} />
      {loaded
        ? (
          <Session
            key={`${loaded.serial}/${table}`}
            rom={loaded.rom}
            engine={loaded.engine}
            table={table}
            setTable={setTable}
            settings={settings}
            setSettings={setSettings}
            showVisualizer={showVisualizer}
            setShowVisualizer={setShowVisualizer}
          />
        )
        : (
          <>
            <main class="main">
              <DropZone open={open} dragging={dragging} />
            </main>
            <PlayerBar rom={null} player={null} duration={0} showVisualizer={showVisualizer} setShowVisualizer={setShowVisualizer} />
          </>
        )}
      {loaded && dragging && <div class="drop-overlay">ドロップして開く</div>}
      {error && (
        <div class="toast" role="alert">
          {error}
          <button type="button" class="ghost small" onClick={() => setError(null)}>閉じる</button>
        </div>
      )}
    </div>
  );
};

render(<App />, document.body);
