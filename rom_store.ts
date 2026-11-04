// 開いた ROM を IndexedDB に保存しておき、次からは一覧から開けるようにする (複数保持する)
// localStorage は容量が足りない (ROM は最大 32MB) ので使わない
//
// - 同じ ROM はファイル名が違っても 1 つにまとめる (中身の SHA-1 をキーにする)
// - 一覧を出すだけで ROM 本体を読まなくて済むよう、一覧用の情報 (meta) と本体 (data) を別のストアに置く

const DB_NAME = "m4a-web";
const META = "meta";
const DATA = "data";

export type SavedROM = {
  id: string; // 中身の SHA-1
  name: string; // 最後に開いたときのファイル名
  title: string;
  code: string;
  version: number;
  size: number; // バイト数
  lastOpened: number; // Date.now()
};

const openDB = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(META, { keyPath: "id" });
      req.result.createObjectStore(DATA);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const done = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

// stores をまとめて1つのトランザクションで扱う. f の結果は書き込みが確定してから返す
const transact = async <T>(stores: string[], mode: IDBTransactionMode, f: (tx: IDBTransaction) => Promise<T>): Promise<T> => {
  const db = await openDB();
  try {
    const tx = db.transaction(stores, mode);
    const finished = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
    });
    const result = await f(tx);
    await finished;
    return result;
  } finally {
    db.close();
  }
};

const sha1 = async (data: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest("SHA-1", data))].map((b) => b.toString(16).padStart(2, "0")).join("");

// 最後に開いた順
export const listROMs = async (): Promise<SavedROM[]> => {
  const all = await transact([META], "readonly", (tx) => done(tx.objectStore(META).getAll() as IDBRequest<SavedROM[]>));
  return all.sort((a, b) => b.lastOpened - a.lastOpened);
};

// 保存する (同じ ROM がすでにあれば、ファイル名と開いた日時を新しくする)
export const saveROM = async (rom: Omit<SavedROM, "id" | "size" | "lastOpened">, data: ArrayBuffer): Promise<SavedROM> => {
  const meta: SavedROM = { ...rom, id: await sha1(data), size: data.byteLength, lastOpened: Date.now() };
  await transact([META, DATA], "readwrite", (tx) => {
    tx.objectStore(META).put(meta);
    tx.objectStore(DATA).put(data, meta.id);
    return Promise.resolve();
  });
  return meta;
};

// 本体を読み、開いた日時を新しくする. 無ければ undefined
export const loadROM = (id: string): Promise<{ meta: SavedROM; data: ArrayBuffer } | undefined> =>
  transact([META, DATA], "readwrite", async (tx) => {
    const meta = await done(tx.objectStore(META).get(id) as IDBRequest<SavedROM | undefined>);
    const data = await done(tx.objectStore(DATA).get(id) as IDBRequest<ArrayBuffer | undefined>);
    if (!meta || !data) return undefined;
    const touched = { ...meta, lastOpened: Date.now() };
    tx.objectStore(META).put(touched);
    return { meta: touched, data };
  });

export const deleteROM = (id: string): Promise<void> =>
  transact([META, DATA], "readwrite", (tx) => {
    tx.objectStore(META).delete(id);
    tx.objectStore(DATA).delete(id);
    return Promise.resolve();
  });
