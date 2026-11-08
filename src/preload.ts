import { contextBridge, ipcRenderer } from "electron";
import type { Bridge, State } from "./types";
const api: Bridge = {
  checkUpdate: () => ipcRenderer.invoke("checkUpdate"),
  installUpdate: () => ipcRenderer.invoke("installUpdate"),
  readDocuments: (input) => ipcRenderer.invoke("readDocuments", input),
  stopReader: (id) => ipcRenderer.invoke("stopReader", id),
  agents: (id) => ipcRenderer.invoke("agents", id),
  research: (id, a, p) => ipcRenderer.invoke("research", id, a, p),
  retryAgent: (id, r, a) => ipcRenderer.invoke("retryAgent", id, r, a),
  openSource: (id, m, i) => ipcRenderer.invoke("openSource", id, m, i),
  team: (id) => ipcRenderer.invoke("team", id),
  openTeam: (id, model) => ipcRenderer.invoke("openTeam", id, model),
  customAddress: (v) => ipcRenderer.invoke("customAddress", v),
  apiAddress: (v, k) => ipcRenderer.invoke("apiAddress", v, k),
  testKey: (p, v) => ipcRenderer.invoke("testKey", p, v),
  readChat: (id) => ipcRenderer.invoke("readChat", id),
  deleteChat: (id, scope) => ipcRenderer.invoke("deleteChat", id, scope),
  state: () => ipcRenderer.invoke("state"),
  listen: (fn) => {
    const receive = (_: unknown, s: State) => fn(s);
    ipcRenderer.on("update", receive);
    return () => {
      ipcRenderer.removeListener("update", receive);
    };
  },
  pair: (t) => ipcRenderer.invoke("pair", t),
  unlink: () => ipcRenderer.invoke("unlink"),
  key: (p, k) => ipcRenderer.invoke("key", p, k),
  open: (p) => ipcRenderer.invoke("open", p),
  send: (i) => ipcRenderer.invoke("send", i),
  stop: () => ipcRenderer.invoke("stop"),
  refresh: () => ipcRenderer.invoke("refresh"),
};
contextBridge.exposeInMainWorld("companion", api);
