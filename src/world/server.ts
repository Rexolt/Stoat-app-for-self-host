import { contextBridge, ipcRenderer } from "electron";

// fetch synchronously so the picker UI has the data available immediately
const serverInfo = ipcRenderer.sendSync("getServerInfo") as {
  current: string;
  default: string;
  recent: string[];
};

contextBridge.exposeInMainWorld("serverManager", {
  getCurrent: () => serverInfo.current,
  getDefault: () => serverInfo.default,
  getRecent: () => serverInfo.recent,
  select: (url: string) => ipcRenderer.send("selectServer", url),
  openPicker: () => ipcRenderer.send("openServerPicker"),
});
