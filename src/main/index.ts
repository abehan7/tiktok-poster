import { app, BrowserWindow, shell } from "electron";
import { join } from "node:path";
import { handleMediaProtocol, registerMediaScheme } from "./media";
import { registerIpc } from "./ipc";
import { PostingService } from "./posting/PostingService";
import { HistoryStore } from "./store/history";
import { SettingsStore } from "./store/settings";
import { TokenStore } from "./store/tokens";
import { TikTokSession } from "./tiktok/TikTokSession";

registerMediaScheme();

let win: BrowserWindow | null = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    title: "TikTok Poster",
    titleBarStyle: "hiddenInset",
    backgroundColor: "#0b0b0d",
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once("ready-to-show", () => win?.show());
  win.on("closed", () => (win = null));
  // Links in the renderer open in the real browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(__dirname, "../renderer/index.html"));
}

app.whenReady().then(() => {
  handleMediaProtocol();

  const settings = new SettingsStore();
  const history = new HistoryStore();
  const session = new TikTokSession(settings, new TokenStore());
  const posting = new PostingService(session, settings, history, {
    progress: (p) => win?.webContents.send("progress", p),
    history: (e) => win?.webContents.send("history", e),
  });

  registerIpc({ window: () => win, settings, session, history, posting });
  posting.resumePolling();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
