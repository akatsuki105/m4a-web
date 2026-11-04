// 曲の一覧と、選んだ曲の再生
// 選んだ曲を m4a/ で PCM に書き出して WebAudio で鳴らす. 選んでいる曲は URL の #番号 に入れておく

import { FunctionComponent } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { encodeWav, readSongHeader, type Rendered, renderSong, type SongEntry, type SongHeader } from "./m4a/mod.ts";
import { audioOutput, useVolume } from "./audio.ts";
import type { ROM } from "./rom.ts";
import { hex8, InfoTable, NumberStepper } from "./components.tsx";

// 再生の設定 (ROM から読んだもの, 画面で変えたもの)
export type PlaySettings = {
  mixerRate: number; // ミキサーのサンプリング周波数 (Hz)
  maxVoices: number; // DirectSound の同時発音数
};

const songNum = (index: number) => String(index).padStart(3, "0");

// 曲ヘッダを読む. 曲テーブルの位置を手で入れたときなどに、ROM の外を指していたら null
const tryHeader = (rom: DataView, address: number): SongHeader | null => {
  try {
    return readSongHeader(rom, address);
  } catch {
    return null;
  }
};

// URL の #番号, 無ければ undefined
const hashIndex = (): number | undefined => {
  const m = location.hash.match(/^#(\d+)$/);
  return m ? Number(m[1]) : undefined;
};

// 全体の音量 (上の1行に出す)
export const VolumeControl: FunctionComponent = () => {
  const [volume, setVolume] = useVolume();
  return (
    <label>
      音量 <input type="range" min={0} max={1} step={0.05} value={volume} onInput={(e) => setVolume(Number(e.currentTarget.value))} />
    </label>
  );
};

export const SongViewer: FunctionComponent<{ rom: ROM; songs: SongEntry[]; settings: PlaySettings }> = ({ rom, songs, settings }) => {
  const headers = useMemo(() => songs.map((s) => tryHeader(rom.data, s.header)), [rom, songs]);
  const pick = (i: number | undefined) => (i !== undefined && songs[i] ? songs[i] : songs.find((_, k) => (headers[k]?.trackCount ?? 0) > 0));
  const [selected, setSelected] = useState<SongEntry | undefined>(() => pick(hashIndex()));
  const [repeat, setRepeat] = useState(false); // 繰り返し再生 (曲を切り替えても保つ)

  useEffect(() => {
    const onHash = () => {
      const i = hashIndex();
      if (i !== undefined && songs[i]) setSelected(songs[i]);
    };
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, [songs]);

  // URL で選んだ曲が見えるように一覧をスクロールする
  useEffect(() => {
    document.querySelector(".song-list li.selected")?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (songs.length === 0) return <p class="message">曲テーブルに曲がありません</p>;

  return (
    <div class="viewer">
      <ul class="song-list">
        {songs.map((s, k) => (
          <li key={s.index} class={s === selected ? "selected" : ""}>
            <a href={`#${s.index}`} class={(headers[k]?.trackCount ?? 0) === 0 ? "dim" : ""}>{songNum(s.index)}</a>
          </li>
        ))}
      </ul>
      {selected && <SongView key={`${selected.index}/${selected.header}`} rom={rom} song={selected} header={headers[songs.indexOf(selected)]} settings={settings} repeat={repeat} setRepeat={setRepeat} />}
    </div>
  );
};

const formatTime = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

// repeat: 書き出した PCM の最後まで来たら最初から鳴らし直す (曲データのループとは別)
const SongView: FunctionComponent<{ rom: ROM; song: SongEntry; header: SongHeader | null; settings: PlaySettings; repeat: boolean; setRepeat: (v: boolean) => void }> = ({ rom, song, header, settings, repeat, setRepeat }) => {
  const [loops, setLoops] = useState(1);
  const [rendered, setRendered] = useState<Rendered | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0); // 再生位置 (秒)
  const srcRef = useRef<AudioBufferSourceNode | null>(null);
  const startRef = useRef({ at: 0, offset: 0 }); // 鳴らし始めた AudioContext の時刻と、そのときの再生位置
  const duration = rendered ? rendered.left.length / rendered.sampleRate : 0;

  const stopSource = () => {
    const src = srcRef.current;
    srcRef.current = null;
    src?.stop();
  };
  useEffect(() => stopSource, []);

  // 再生の設定が変わったら書き出し直す
  useEffect(() => {
    stop();
    setRendered(null);
  }, [settings.mixerRate, settings.maxVoices]);

  // 再生中は再生位置を画面の更新ごとに読む
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const loop = () => {
      if (srcRef.current) setPos(current()); // 止めた直後に1回呼ばれることがあるので、そのときは一時停止で取った位置のままにする
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // 書き出す. 曲データが壊れているなどで失敗したら null
  const render = (): Rendered | null => {
    try {
      const r = renderSong(rom.data, song.header, { loops, mixerRate: settings.mixerRate, maxDirectVoices: settings.maxVoices });
      setRendered(r);
      setError(null);
      return r;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  };

  // offset 秒の位置から鳴らす
  const start = (offset: number) => {
    stopSource();
    const r = rendered ?? render();
    if (!r) return;
    const { ctx, dest } = audioOutput();
    const buf = ctx.createBuffer(2, Math.max(1, r.left.length), r.sampleRate);
    buf.copyToChannel(r.left, 0);
    buf.copyToChannel(r.right, 1);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = repeat;
    src.connect(dest);
    src.onended = () => {
      if (srcRef.current !== src) return; // 止めたり位置を変えたりしたもの
      srcRef.current = null;
      setPlaying(false);
      setPos(0);
    };
    offset = Math.max(0, Math.min(offset, buf.duration));
    src.start(0, offset);
    srcRef.current = src;
    startRef.current = { at: ctx.currentTime, offset };
    setPos(offset);
    setPlaying(true);
  };

  // 今の再生位置 (秒), 繰り返し再生中は PCM の長さで折り返す
  const current = () => {
    const p = startRef.current.offset + audioOutput().ctx.currentTime - startRef.current.at;
    const src = srcRef.current;
    return src?.loop && src.buffer ? p % src.buffer.duration : p;
  };

  // 再生中に切り替えたら、今の位置から数え直す
  useEffect(() => {
    const src = srcRef.current;
    if (!src) return;
    const p = current();
    src.loop = repeat;
    startRef.current = { at: audioOutput().ctx.currentTime, offset: p };
  }, [repeat]);

  const pause = () => {
    if (srcRef.current) setPos(Math.min(current(), duration));
    stopSource();
    setPlaying(false);
  };

  const stop = () => {
    pause();
    setPos(0);
  };

  const seek = (v: number) => {
    if (playing) start(v);
    else setPos(v);
  };

  const download = () => {
    const r = rendered ?? render();
    if (!r) return;
    const url = URL.createObjectURL(new Blob([encodeWav(r.sampleRate, r.left, r.right)], { type: "audio/wav" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${rom.name.replace(/\.[^.]*$/, "")}_song${songNum(song.index)}.wav`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const info: [string, string | number][] = [
    ["header", hex8(song.header)],
    ...(header
      ? [
        ["tracks", header.trackCount],
        ["voicegroup", hex8(header.voicegroup)],
        ["priority", header.priority],
        ["reverb", header.reverb & 0x80 ? header.reverb & 0x7F : "-"],
      ] as [string, string | number][]
      : []),
    ["player", song.ms],
  ];

  return (
    <div class="song-view">
      <h2>song {songNum(song.index)}</h2>
      {!header ? <p class="error">曲ヘッダが ROM の外を指しています</p> : header.trackCount === 0 ? <p class="dim">トラックが無い曲です</p> : (
        <>
          <div class="controls">
            <button type="button" onClick={() => (playing ? pause() : start(pos))}>{playing ? "一時停止" : "再生"}</button>
            <button type="button" onClick={stop} disabled={!playing && pos === 0}>停止</button>
            <NumberStepper
              label="ループ"
              value={loops}
              min={1}
              max={9}
              onChange={(v) => {
                stop();
                setLoops(v);
                setRendered(null);
              }}
            />
            <label>
              <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.currentTarget.checked)} /> 繰り返し再生
            </label>
            <button type="button" onClick={download}>WAV で保存</button>
          </div>
          <div class="controls seek">
            <input type="range" min={0} max={duration || 1} step={0.01} value={pos} disabled={!rendered} onInput={(e) => seek(Number(e.currentTarget.value))} />
            <span class="mono">{formatTime(pos)} / {rendered ? formatTime(duration) : "-:--"}</span>
          </div>
          {error && <p class="error">書き出せませんでした: {error}</p>}
          {rendered?.looped && <p>{loops} 回ループしたところでフェードアウトします</p>}
          <p class="dim">ループは GOTO で戻った回数です。実機のミキサーやリバーブは再現しておらず、それらしく鳴らす程度です。</p>
        </>
      )}
      <InfoTable rows={info} />
    </div>
  );
};
