import { app, BrowserWindow, dialog, Menu, nativeTheme, shell, systemPreferences, type MenuItemConstructorOptions } from "electron";
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { HistoryEntry, Progress, View } from "@shared/contract";
import { USER_DATA_ENV } from "@shared/control";
import { ControlServer } from "./control/ControlServer";
import { accentHex, createHandlers, readCarouselFolder, registerIpc } from "./ipc";
import { InstagramSession } from "./instagram/InstagramSession";
import { handleMediaProtocol, registerMediaScheme } from "./media";
import { InstagramPostingService } from "./posting/InstagramPostingService";
import { PostingService } from "./posting/PostingService";
import { DraftNotifier } from "./posting/DraftNotifier";
import { ImportInbox } from "./posting/ImportInbox";
import { Scheduler } from "./posting/Scheduler";
import { HistoryStore } from "./store/history";
import { IgTokenStore } from "./store/igTokens";
import { SettingsStore } from "./store/settings";
import { TokenStore } from "./store/tokens";
import { TikTokSession } from "./tiktok/TikTokSession";

registerMediaScheme();
// Lets a second copy run on its own data (e.g. trying the CLI in mock mode next to the real app).
if (process.env[USER_DATA_ENV]) app.setPath("userData", resolve(process.env[USER_DATA_ENV]));

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
        { label: "Dashboard", accelerator: "Cmd+0", click: () => navigate("dashboard") },
        { label: "New Carousel", accelerator: "Cmd+1", click: () => navigate("carousel") },
        { label: "New Video", accelerator: "Cmd+2", click: () => navigate("video") },
        { label: "Calendar", accelerator: "Cmd+3", click: () => navigate("calendar") },
        { label: "History", accelerator: "Cmd+4", click: () => navigate("history") },
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
  const notifier = new DraftNotifier(history, () => win);
  const control = new ControlServer();
  const events = {
    progress: (p: Progress) => {
      win?.webContents.send("progress", p);
      control.broadcast("progress", p);
    },
    history: (e: HistoryEntry) => {
      notifier.onHistory(e);
      const decorated = scheduler.decorate([e])[0];
      win?.webContents.send("history", decorated);
      control.broadcast("history", decorated);
    },
  };
  const posting = new PostingService(session, settings, history, events);
  const instagram = new InstagramSession(settings, new IgTokenStore(), () => win);
  const igPosting = new InstagramPostingService(instagram, settings, history, events);
  scheduler = new Scheduler(posting, igPosting, history);

  const handlers = createHandlers({ window: () => win, settings, session, history, posting, instagram, igPosting, scheduler });
  registerIpc(handlers);
  control.start(handlers, {
    ping: async () => ({
      pid: process.pid,
      version: app.getVersion(),
      userData: app.getPath("userData"),
      mockMode: settings.get().mockMode,
      pending: scheduler.pendingCount(),
    }),
    show: async (view) => {
      if (view) navigate(view);
      else {
        if (!win) createWindow();
        win?.show();
      }
      app.focus({ steal: true });
    },
    readCarouselFolder: async (dir) => {
      if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`Not a folder: ${dir}`);
      return readCarouselFolder(dir);
    },
  });
  app.on("will-quit", () => control.stop());
  posting.resumePolling();
  igPosting.resumePolling();
  scheduler.start();
  new ImportInbox(scheduler, session).start();

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
