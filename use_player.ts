// 曲の並びの中で、どの曲を鳴らすか (今の曲・次の曲・前の曲・シャッフル・繰り返し)
// 曲は鳴らすときに m4a/ で書き出す (1 曲あたり数十ミリ秒なので、その場で書き出す)

import { useEffect, useRef, useState } from "preact/hooks";
import { type RenderOptions, renderSong, type SongEntry, type SongHeader, type Trace } from "./m4a/mod.ts";
import { playback } from "./playback.ts";
import type { ROM } from "./rom.ts";

export type Repeat = "off" | "all" | "one";

export type Song = {
  entry: SongEntry;
  header: SongHeader | null; // 曲ヘッダが ROM の外を指していれば null
  playable: boolean; // トラックがある
};

const REPEAT_KEY = "m4a-web.repeat";
const SHUFFLE_KEY = "m4a-web.shuffle";

const load = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const store = (key: string, v: string) => {
  try {
    localStorage.setItem(key, v);
  } catch {
    // 保存できなくても今の画面では効く
  }
};

// 既定は 1 曲を繰り返す (同じ曲テーブルに効果音やボイスも並んでいるので、続けて流すと BGM の合間に短い音が挟まる)
const loadRepeat = (): Repeat => {
  const v = load(REPEAT_KEY);
  return v === "off" || v === "all" || v === "one" ? v : "one";
};

// URL の #番号, 無ければ undefined
export const hashIndex = (): number | undefined => {
  const m = location.hash.match(/^#(\d+)$/);
  return m ? Number(m[1]) : undefined;
};

export type Player = ReturnType<typeof usePlayer>;

// opts と renderKey: 書き出しの設定と、それが変わったことを表す文字列 (変わったら今の曲を書き出し直す)
export const usePlayer = (rom: ROM, songs: Song[], opts: RenderOptions, renderKey: string) => {
  const [current, setCurrent] = useState<number | null>(() => {
    const i = hashIndex();
    return i !== undefined && songs[i]?.playable ? i : null;
  });
  const [playing, setPlaying] = useState(false);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [repeat, setRepeatState] = useState<Repeat>(loadRepeat);
  const [shuffle, setShuffleState] = useState(() => load(SHUFFLE_KEY) === "1");
  const shuffleHistory = useRef<number[]>([]); // シャッフルで鳴らした順 (前の曲に戻るため)
  const loadedKey = useRef<string | null>(null); // playback に読み込んである曲と設定

  const playable = songs.flatMap((s, i) => (s.playable ? [i] : []));

  // 曲を書き出して playback に読み込む. 失敗したら false
  const ensureLoaded = (i: number): boolean => {
    const key = `${i}/${renderKey}`;
    if (loadedKey.current === key) return true;
    try {
      const r = renderSong(rom.data, songs[i].entry.header, { ...opts, trace: true });
      playback.load(r.left, r.right, r.sampleRate);
      setTrace(r.trace ?? null);
      setError(null);
      loadedKey.current = key;
      return true;
    } catch (e) {
      playback.unload();
      setTrace(null);
      setError(`song ${i}: ${e instanceof Error ? e.message : String(e)}`);
      loadedKey.current = null;
      return false;
    }
  };

  const playIndex = (i: number, at = 0) => {
    if (!songs[i]?.playable) return;
    setCurrent(i);
    if (ensureLoaded(i)) playback.play(at);
  };

  // 鳴らさずに選ぶ (URL の # を変えたときなど)
  const select = (i: number) => {
    if (!songs[i]?.playable || i === current) return;
    if (playback.playing) return playIndex(i);
    playback.unload();
    loadedKey.current = null;
    setTrace(null);
    setCurrent(i);
  };

  const toggle = () => {
    if (current === null) {
      if (playable.length) playIndex(shuffle ? playable[Math.floor(Math.random() * playable.length)] : playable[0]);
    } else if (playback.playing) playback.pause();
    else if (ensureLoaded(current)) playback.play();
  };

  const randomOther = () => {
    const others = playable.filter((i) => i !== current);
    return others.length ? others[Math.floor(Math.random() * others.length)] : current;
  };

  // 次の曲. auto: 曲が終わって進むとき (繰り返しなしなら最後で止まる)
  const nextIndex = (auto: boolean): number | null => {
    if (!playable.length) return null;
    if (shuffle) return randomOther();
    if (current === null) return playable[0];
    const after = playable.find((i) => i > current);
    if (after !== undefined) return after;
    return auto && repeat === "off" ? null : playable[0];
  };

  const next = (auto = false) => {
    const n = nextIndex(auto);
    if (n === null) return;
    if (shuffle && current !== null) shuffleHistory.current.push(current);
    playIndex(n);
  };

  // 3 秒より後なら曲の頭に戻る, それより前なら前の曲
  const prev = () => {
    if (current !== null && playback.loaded && playback.position() > 3) return playback.seek(0);
    if (shuffle && shuffleHistory.current.length) return playIndex(shuffleHistory.current.pop()!);
    if (!playable.length) return;
    if (current === null) return playIndex(playable[0]);
    const before = playable.findLast((i) => i < current);
    playIndex(before ?? playable[playable.length - 1]);
  };

  const seek = (at: number) => {
    if (current === null) return;
    if (!playback.loaded && !ensureLoaded(current)) return;
    playback.seek(at);
  };

  const setRepeat = (r: Repeat) => {
    setRepeatState(r);
    store(REPEAT_KEY, r);
  };
  const cycleRepeat = () => setRepeat(repeat === "one" ? "off" : repeat === "off" ? "all" : "one");
  const setShuffle = (v: boolean) => {
    setShuffleState(v);
    store(SHUFFLE_KEY, v ? "1" : "0");
    shuffleHistory.current = [];
  };

  // playback から呼ぶものは、いつも最新の状態を見るように ref から呼ぶ
  const latest = useRef({ next, toggle, prev, seek });
  latest.current = { next, toggle, prev, seek };

  useEffect(() => {
    const unsubscribe = playback.subscribe(() => setPlaying(playback.playing));
    playback.onEnded = () => latest.current.next(true);
    return () => {
      unsubscribe();
      playback.onEnded = null;
      playback.unload(); // ROM や曲テーブルを変えたら止める
    };
  }, []);

  useEffect(() => playback.setLoop(repeat === "one"), [repeat]);

  // 書き出しの設定が変わったら、今の曲を同じ位置から書き出し直す
  useEffect(() => {
    if (current === null || loadedKey.current === null || loadedKey.current === `${current}/${renderKey}`) return;
    const wasPlaying = playback.playing, at = playback.position();
    if (!ensureLoaded(current)) return;
    if (wasPlaying) playback.play(at);
    else playback.seek(at);
  }, [renderKey]);

  // 今の曲を URL の # に入れる (?rom= は残す), # を手で変えたらその曲を選ぶ
  useEffect(() => {
    if (current !== null) history.replaceState(null, "", `${location.pathname}${location.search}#${current}`);
  }, [current]);
  useEffect(() => {
    const onHash = () => {
      const i = hashIndex();
      if (i !== undefined) select(i);
    };
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  });

  // OS のメディアキーやロック画面の操作 (Media Session API)
  useEffect(() => {
    const ms = navigator.mediaSession;
    if (!ms) return;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => !playback.playing && latest.current.toggle()],
      ["pause", () => playback.playing && latest.current.toggle()],
      ["previoustrack", () => latest.current.prev()],
      ["nexttrack", () => latest.current.next()],
      ["seekto", (d) => d.seekTime !== undefined && latest.current.seek(d.seekTime)],
      ["seekbackward", (d) => latest.current.seek(playback.position() - (d.seekOffset ?? 5))],
      ["seekforward", (d) => latest.current.seek(playback.position() + (d.seekOffset ?? 5))],
    ];
    for (const [action, f] of handlers) {
      try {
        ms.setActionHandler(action, f);
      } catch {
        // 対応していない操作は無視する
      }
    }
    const unsubscribe = playback.subscribe(() => {
      ms.playbackState = playback.playing ? "playing" : playback.loaded ? "paused" : "none";
      if (playback.loaded && playback.duration > 0) {
        try {
          ms.setPositionState({ duration: playback.duration, position: Math.min(playback.position(), playback.duration), playbackRate: 1 });
        } catch {
          // 位置が長さを超えたときなど
        }
      }
    });
    return () => {
      unsubscribe();
      for (const [action] of handlers) {
        try {
          ms.setActionHandler(action, null);
        } catch {
          // 同上
        }
      }
      ms.metadata = null;
      ms.playbackState = "none";
    };
  }, []);

  useEffect(() => {
    const ms = navigator.mediaSession;
    if (!ms || current === null) return;
    ms.metadata = new MediaMetadata({ title: songTitle(current), artist: rom.title || rom.name, album: rom.code ? `${rom.code} rev${rom.version}` : rom.name });
  }, [current, rom]);

  return { current, playing, trace, error, repeat, shuffle, playIndex, toggle, next, prev, seek, cycleRepeat, setShuffle, setRepeat };
};

export const songTitle = (index: number) => `Song ${String(index).padStart(3, "0")}`;
