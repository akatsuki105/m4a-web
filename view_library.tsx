// 左のライブラリ (保存した ROM) と、ROM を開いていないときのドロップ欄

import type { ComponentChildren, FunctionComponent } from "preact";
import type { SavedROM } from "./rom_store.ts";
import type { ROM } from "./rom.ts";
import { CartridgeIcon, CloseIcon, PlusIcon } from "./icons.tsx";
import { coverStyle } from "./components.tsx";

const formatSize = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(bytes < 1024 * 1024 ? 2 : 0)} MB`;

// ファイルを選ぶボタン (見た目は children)
// accept で拡張子を絞らない: iOS は .gba を知らないので、絞るとファイルが全部選べなくなる (ROM でないものは読むときに弾く)
export const FilePicker: FunctionComponent<{ open: (file: File) => void; class?: string; children: ComponentChildren }> = ({ open, class: cls, children }) => (
  <label class={cls}>
    <input
      type="file"
      hidden
      onChange={(e) => {
        const file = e.currentTarget.files?.[0];
        e.currentTarget.value = ""; // 同じファイルをもう一度選んでも反応するように
        if (file) open(file);
      }}
    />
    {children}
  </label>
);

const Cover: FunctionComponent<{ seed: string; size: "s" | "m" }> = ({ seed, size }) => (
  <span class={`cover cover-${size}`} style={coverStyle(seed)}>
    <CartridgeIcon size={size === "s" ? 18 : 22} />
  </span>
);

// current: 開いている ROM と、保存してあればそのキー
export const Sidebar: FunctionComponent<{
  saved: SavedROM[];
  current: { rom: ROM; savedId: string | null } | null;
  open: (file: File) => void;
  openSaved: (id: string) => void;
  remove: (r: SavedROM) => void;
  home: () => void;
}> = ({ saved, current, open, openSaved, remove, home }) => (
  <aside class="sidebar">
    <a
      class="brand"
      href="./"
      onClick={(e) => {
        e.preventDefault();
        home();
      }}
    >
      <span class="brand-mark">♪</span> m4a-web
    </a>
    <div class="sidebar-head">
      <span>Library</span>
      <FilePicker open={open} class="icon-button">
        <span title="Add a ROM">
          <PlusIcon size={18} />
        </span>
      </FilePicker>
    </div>
    <ul class="library">
      {/* ?rom= で開いたものは保存しないので、一覧の先頭に別に出す */}
      {current && current.savedId === null && (
        <li class="active">
          <span class="lib-item">
            <Cover seed={current.rom.code || current.rom.name} size="s" />
            <span class="lib-text">
              <span class="lib-title">{current.rom.title || current.rom.name}</span>
              <span class="lib-sub">Not saved</span>
            </span>
          </span>
        </li>
      )}
      {saved.map((r) => (
        <li key={r.id} class={current?.savedId === r.id ? "active" : ""}>
          <button type="button" class="lib-item" onClick={() => openSaved(r.id)} title={r.name}>
            <Cover seed={r.code || r.name} size="s" />
            <span class="lib-text">
              <span class="lib-title">{r.title || r.name}</span>
              <span class="lib-sub">{r.code || "?"} · {formatSize(r.size)}</span>
            </span>
          </button>
          <button type="button" class="lib-remove" title="Remove from library" onClick={() => remove(r)}>
            <CloseIcon size={14} />
          </button>
        </li>
      ))}
    </ul>
    {saved.length === 0 && !current && <p class="sidebar-empty">ROMs you open will appear here</p>}
  </aside>
);

export const DropZone: FunctionComponent<{ open: (file: File) => void; dragging: boolean }> = ({ open, dragging }) => (
  <div class={dragging ? "dropzone dragging" : "dropzone"}>
    <div class="dropzone-icon">
      <CartridgeIcon size={40} />
    </div>
    <h2>Drop a GBA ROM</h2>
    <p>Finds the MP2K (m4a) sound driver and lists its songs</p>
    <FilePicker open={open} class="button primary">Choose a file</FilePicker>
    <p class="muted small">The ROM is read only in your browser and never uploaded. ROMs you open are saved in this browser, so you can reopen them from the library.</p>
  </div>
);
