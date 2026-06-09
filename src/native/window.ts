import { join } from "node:path";

import {
  BrowserWindow,
  Menu,
  MenuItem,
  app,
  desktopCapturer,
  ipcMain,
  nativeImage,
  session,
} from "electron";

import windowIconAsset from "../../assets/desktop/icon.png?asset";
import serverPickerHtml from "../serverPicker/picker.html?raw";
import themeCss from "./theme.css?raw";

import { config } from "./config";
import { updateTrayMenu } from "./tray";

// global reference to main window
export let mainWindow: BrowserWindow;

// the official, default server the app ships with
export const DEFAULT_SERVER = "https://stoat.chat/app";

/**
 * Resolve the server URL the app should connect to.
 *
 * Priority: `--force-server` CLI flag > user-configured server > default.
 */
export function getServerUrl(): string {
  if (app.commandLine.hasSwitch("force-server")) {
    return app.commandLine.getSwitchValue("force-server");
  }

  return config.serverUrl || DEFAULT_SERVER;
}

/**
 * Currently in-use build URL.
 */
export function getBuildUrl(): URL {
  return new URL(getServerUrl());
}

/**
 * Whether the user has explicitly chosen a server yet.
 */
function hasChosenServer(): boolean {
  return (
    app.commandLine.hasSwitch("force-server") || Boolean(config.serverUrl)
  );
}

/**
 * Load the inline server picker page into the main window.
 */
function loadServerPicker() {
  mainWindow.loadURL(
    "data:text/html;charset=utf-8," + encodeURIComponent(serverPickerHtml),
  );
}

/**
 * Load the configured server, or the picker if none has been chosen.
 */
function loadEntrypoint() {
  if (hasChosenServer()) {
    mainWindow.loadURL(getBuildUrl().toString());
  } else {
    loadServerPicker();
  }
}

/**
 * Persist the chosen server and connect to it.
 */
function selectServer(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return;
  }

  const normalised = url.toString().replace(/\/$/, "");

  // remember the server in the recent list (most-recent first, max 5)
  const recent = [
    normalised,
    ...(config.recentServers ?? []).filter((s) => s !== normalised),
  ].slice(0, 5);
  config.recentServers = recent;

  config.serverUrl = normalised;
  mainWindow.loadURL(getBuildUrl().toString());
}

// register server IPC handlers once
ipcMain.on("getServerInfo", (event) => {
  event.returnValue = {
    current: config.serverUrl,
    default: DEFAULT_SERVER,
    recent: config.recentServers ?? [],
  };
});
ipcMain.on("selectServer", (_, url: string) => selectServer(url));
ipcMain.on("openServerPicker", () => openServerPicker());
// expose whether the custom (frameless) titlebar is in use, synchronously
ipcMain.on("useCustomFrame", (event) => {
  event.returnValue = config.customFrame;
});

/**
 * Show the server picker so the user can switch servers.
 */
export function openServerPicker() {
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.focus();
  loadServerPicker();
}

// internal window state
let shouldQuit = false;

// load the window icon
const windowIcon = nativeImage.createFromDataURL(windowIconAsset);

// windowIcon.setTemplateImage(true);

/**
 * Create the main application window
 */
export function createMainWindow() {
  // (CLI arg --hidden or config)
  const startHidden =
    app.commandLine.hasSwitch("hidden") || config.startMinimisedToTray;

  // create the window
  mainWindow = new BrowserWindow({
    minWidth: 300,
    minHeight: 300,
    width: 1280,
    height: 720,
    backgroundColor: "#141414",
    frame: !config.customFrame,
    icon: windowIcon,
    show: !startHidden,
    webPreferences: {
      // relative to `.vite/build`
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  // hide the options
  mainWindow.setMenu(null);

  // restore last position if it was moved previously
  if (config.windowState.x > 0 || config.windowState.y > 0) {
    mainWindow.setPosition(
      config.windowState.x ?? 0,
      config.windowState.y ?? 0,
    );
  }

  // restore last size if it was resized previously
  if (config.windowState.width > 0 && config.windowState.height > 0) {
    mainWindow.setSize(
      config.windowState.width ?? 1280,
      config.windowState.height ?? 720,
    );
  }

  // maximise the window if it was maximised before
  if (config.windowState.isMaximised) {
    mainWindow.maximize();
  }

  // load the entrypoint (configured server, or the picker)
  loadEntrypoint();

  // minimise window to tray
  mainWindow.on("close", (event) => {
    if (!shouldQuit && config.minimiseToTray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  // update tray menu when window is shown/hidden
  mainWindow.on("show", updateTrayMenu);
  mainWindow.on("hide", updateTrayMenu);

  // keep track of window state
  function generateState() {
    config.windowState = {
      x: mainWindow.getPosition()[0],
      y: mainWindow.getPosition()[1],
      width: mainWindow.getSize()[0],
      height: mainWindow.getSize()[1],
      isMaximised: mainWindow.isMaximized(),
    };
  }

  mainWindow.on("maximize", generateState);
  mainWindow.on("unmaximize", generateState);
  mainWindow.on("moved", generateState);
  mainWindow.on("resized", generateState);

  // rebind zoom controls to be more sensible
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.control && (input.key === "=" || input.key === "+")) {
      // zoom in (+)
      event.preventDefault();
      mainWindow.webContents.setZoomLevel(
        mainWindow.webContents.getZoomLevel() + 1,
      );
    } else if (input.control && input.key === "-") {
      // zoom out (-)
      event.preventDefault();
      mainWindow.webContents.setZoomLevel(
        mainWindow.webContents.getZoomLevel() - 1,
      );
    } else if (input.control && input.key === "0") {
      // reset zoom to default.
      event.preventDefault();
      mainWindow.webContents.setZoomLevel(0);
    } else if (
      input.key === "F5" ||
      ((input.control || input.meta) && input.key.toLowerCase() === "r")
    ) {
      event.preventDefault();
      mainWindow.webContents.reload();
    } else if (input.control && input.shift && input.key.toLowerCase() === "s") {
      event.preventDefault();
      openServerPicker();
    }
  });

  // send the config and inject premium theme stylesheet
  mainWindow.webContents.on("did-finish-load", () => {
    config.sync();

    // the local server picker is self-styled; skip injecting chat theming
    if (mainWindow.webContents.getURL().startsWith("data:")) return;

    mainWindow.webContents.insertCSS(themeCss);

    // Inject floating Server Picker button in the bottom-left corner
    const injectJs = `
      (function() {
        if (!window.serverManager || document.getElementById('floating-server-picker-btn')) return;
        const btn = document.createElement('div');
        btn.id = 'floating-server-picker-btn';
        btn.title = 'Switch Server / Szerverválasztó (Ctrl+Shift+S)';
        btn.innerHTML = \`<svg viewBox="0 0 24 24" width="20" height="20"><path d="M19 15v4H5v-4h14m1-2H4c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h16c.55 0 1-.45 1-1v-6c0-.55-.45-1-1-1zM19 5v4H5V5h14m1-2H4c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h16c.55 0 1-.45 1-1V4c0-.55-.45-1-1-1z" fill="currentColor"/></svg>\`;
        Object.assign(btn.style, {
          position: 'fixed',
          bottom: '16px',
          left: '16px',
          width: '40px',
          height: '40px',
          borderRadius: '10px',
          background: 'rgba(30, 30, 30, 0.75)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
          backdropFilter: 'blur(20px)',
          webkitBackdropFilter: 'blur(20px)',
          color: '#9e9e9e',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          zIndex: '999999',
          transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
          pointerEvents: 'auto'
        });
        btn.addEventListener('mouseenter', () => {
          btn.style.color = '#fd6671';
          btn.style.background = 'rgba(253, 102, 113, 0.1)';
          btn.style.borderColor = 'rgba(253, 102, 113, 0.3)';
          btn.style.transform = 'scale(1.05)';
        });
        btn.addEventListener('mouseleave', () => {
          btn.style.color = '#9e9e9e';
          btn.style.background = 'rgba(30, 30, 30, 0.75)';
          btn.style.borderColor = 'rgba(255, 255, 255, 0.08)';
          btn.style.transform = 'scale(1)';
        });
        btn.addEventListener('click', () => {
          window.serverManager.openPicker();
        });
        document.body.appendChild(btn);
      })();
    `;
    mainWindow.webContents.executeJavaScript(injectJs);
  });

  // configure spellchecker context menu
  mainWindow.webContents.on("context-menu", (_, params) => {
    const menu = new Menu();

    // add all suggestions
    for (const suggestion of params.dictionarySuggestions) {
      menu.append(
        new MenuItem({
          label: suggestion,
          click: () => mainWindow.webContents.replaceMisspelling(suggestion),
        }),
      );
    }

    // allow users to add the misspelled word to the dictionary
    if (params.misspelledWord) {
      menu.append(
        new MenuItem({
          label: "Add to dictionary",
          click: () =>
            mainWindow.webContents.session.addWordToSpellCheckerDictionary(
              params.misspelledWord,
            ),
        }),
      );
    }

    // add an option to toggle spellchecker
    menu.append(
      new MenuItem({
        label: "Toggle spellcheck",
        click() {
          config.spellchecker = !config.spellchecker;
        },
      }),
    );

    // show menu if we've generated enough entries
    if (menu.items.length > 0) {
      menu.popup();
    }
  });

  // Create display media request handler
  session.defaultSession.setDisplayMediaRequestHandler(
    (request, callback) => {
      desktopCapturer
        .getSources({ types: ["screen", "window"], fetchWindowIcons: true })
        .then((sources) => {
          // Shortcut for linux wayland.
          if (sources.length == 1) {
            // TODO: Get audio to work with wayland
            // See vencord for an implementation using a virtual microphone.
            callback({
              video: sources[0],
              audio: request.audioRequested ? "loopbackWithMute" : undefined,
            });
            return;
          }
          ipcMain.once(
            "screenPickerCallback",
            (_, idx: number, audio: boolean) => {
              if (idx < 0 || idx > sources.length) {
                callback({});
              } else {
                callback({
                  video: sources[idx],
                  audio: audio ? "loopbackWithMute" : undefined,
                });
              }
            },
          );
          mainWindow.webContents.send(
            "screenPicker",
            sources.map((source, idx) => {
              const image = source.appIcon;
              if (image) {
                if (image.getAspectRatio() > 1) {
                  image.resize({ width: 256 });
                } else {
                  image.resize({ height: 256 });
                }
              }
              return {
                idx: idx,
                name: source.name,
                isFullScreen: source.id.startsWith("screen"),
                image: image?.toDataURL(),
              };
            }),
          );
        });
    },
    { useSystemPicker: true },
  );

  // push world events to the window
  ipcMain.on("minimise", () => mainWindow.minimize());
  ipcMain.on("maximise", () =>
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(),
  );
  ipcMain.on("close", () => mainWindow.close());

  // mainWindow.webContents.openDevTools();

  // let i = 0;
  // setInterval(() => setBadgeCount((++i % 30) + 1), 1000);
}

/**
 * Quit the entire app
 */
export function quitApp() {
  shouldQuit = true;
  mainWindow.close();
}

// Ensure global app quit works properly
app.on("before-quit", () => {
  shouldQuit = true;
});
