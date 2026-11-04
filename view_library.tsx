// 左のライブラリ (保存した ROM) と、ROM を開いていないときのドロップ欄

import type { ComponentChildren, FunctionComponent } from "preact";
import type { SavedROM } from "./rom_store.ts";
import type { ROM } from "./rom.ts";
import { CartridgeIcon, CloseIcon, PlusIcon } from "./icons.tsx";
import { coverStyle } from "./components.tsx";

const formatSize = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(bytes < 1024 * 1024 ? 2 : 0)} MB`;

// ファイルを選ぶボタン (見た目は children)
export const FilePicker: FunctionComponent<{ open: (file: File) => void; class?: string; children: ComponentChildren }> = ({ open, class: cls, children }) => (
  <label class={cls}>
    <input
      type="file"
      accept=".gba,.bin,.agb"
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
      <span>ライブラリ</span>
      <FilePicker open={open} class="icon-button">
        <span title="ROM を追加">
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
              <span class="lib-sub">保存していません</span>
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
          <button type="button" class="lib-remove" title="ライブラリから削除" onClick={() => remove(r)}>
            <CloseIcon size={14} />
          </button>
        </li>
      ))}
    </ul>
    {saved.length === 0 && !current && <p class="sidebar-empty">開いた ROM はここに並びます</p>}
  </aside>
);

export const DropZone: FunctionComponent<{ open: (file: File) => void; dragging: boolean }> = ({ open, dragging }) => (
  <div class={dragging ? "dropzone dragging" : "dropzone"}>
    <div class="dropzone-icon">
      <CartridgeIcon size={40} />
    </div>
    <h2>GBA の ROM をドロップ</h2>
    <p>MP2K (m4a) のサウンドドライバを探して、曲を一覧にします</p>
    <FilePicker open={open} class="button primary">ファイルを選ぶ</FilePicker>
    <p class="muted small">ROM はブラウザの中だけで読み、どこにも送りません。開いた ROM はこのブラウザに保存し、左の一覧から開き直せます。</p>
  </div>
);
