import { app, BrowserWindow, dialog, Menu, nativeTheme, shell, systemPreferences, type MenuItemConstructorOptions } from "electron";
import { join } from "node:path";
import type { View } from "@shared/contract";
import { accentHex, registerIpc } from "./ipc";
import { handleMediaProtocol, registerMediaScheme } from "./media";
import { PostingService } from "./posting/PostingService";
import { Scheduler } from "./posting/Scheduler";
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
    // Matches --bg so there's no flash before the first paint.
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0b0b0d" : "#f6f6f7",
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

function navigate(view: View) {
  if (!win) createWindow();
  win?.show();
  win?.webContents.send("navigate", view);
}

function buildMenu() {
  const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { label: "Settings…", accelerator: "Cmd+,", click: () => navigate("settings") },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        { label: "New Carousel", accelerator: "Cmd+1", click: () => navigate("carousel") },
        { label: "New Video", accelerator: "Cmd+2", click: () => navigate("video") },
        { label: "History", accelerator: "Cmd+3", click: () => navigate("history") },
        { type: "separator" },
        { role: "close" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        ...(isDev ? ([{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }] as const) : []),
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  // Packaged builds get the .icns from electron-builder; in dev, set the Dock icon by hand.
  if (!app.isPackaged) app.dock?.setIcon(join(__dirname, "../../build/icon.png"));
  handleMediaProtocol();

  const settings = new SettingsStore();
  nativeTheme.themeSource = settings.get().appearance;
  const history = new HistoryStore();
  const session = new TikTokSession(settings, new TokenStore());
  // `scheduler` is assigned right below; events only fire after that.
  let scheduler: Scheduler;
  const posting = new PostingService(session, settings, history, {
    progress: (p) => win?.webContents.send("progress", p),
    history: (e) => win?.webContents.send("history", scheduler.decorate([e])[0]),
  });
  scheduler = new Scheduler(posting, history);

  registerIpc({ window: () => win, settings, session, history, posting, scheduler });
  posting.resumePolling();
  scheduler.start();

  // Scheduled posts only go out while the app runs, so ask before quitting with any pending.
  let quitConfirmed = false;
  app.on("before-quit", (e) => {
    if (quitConfirmed) return;
    const ok = scheduler.confirmQuit(
      (n) =>
        dialog.showMessageBoxSync({
          type: "warning",
          message: `${n} scheduled post${n === 1 ? "" : "s"} won't go out while TikTok Poster is closed.`,
          detail: "Closing the window is fine. Quitting stops the schedule until you open the app again.",
          buttons: ["Quit Anyway", "Keep Running"],
          defaultId: 1,
          cancelId: 1,
        }) === 0,
    );
    if (ok) quitConfirmed = true;
    else e.preventDefault();
  });
  buildMenu();
  createWindow();

  // Accent colour changes in System Settings → Appearance.
  systemPreferences.subscribeNotification("AppleColorPreferencesChangedNotification", () =>
    win?.webContents.send("accent", accentHex()),
  );

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
