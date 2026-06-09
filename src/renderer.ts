/**
 * This file will automatically be loaded by vite and run in the "renderer" context.
 * To learn more about the differences between the "main" and the "renderer" context in
 * Electron, visit:
 *
 * https://electronjs.org/docs/tutorial/process-model
 *
 * By default, Node.js integration in this file is disabled. When enabling Node.js integration
 * in a renderer process, please be aware of potential security implications. You can read
 * more about security risks here:
 *
 * https://electronjs.org/docs/tutorial/security
 *
 * To enable Node.js integration in this file, open up `main.ts` and enable the `nodeIntegration`
 * flag:
 *
 * ```
 *  // Create the browser window.
 *  mainWindow = new BrowserWindow({
 *    width: 800,
 *    height: 600,
 *    webPreferences: {
 *      nodeIntegration: true
 *    }
 *  });
 * ```
 */
import "./index.css";

console.log(
  '👋 This message is being logged by "renderer.ts", included via Vite',
);

interface ExtendedWindow extends Window {
  native?: {
    versions: {
      node: () => string;
      chrome: () => string;
      electron: () => string;
      desktop: () => string;
    };
    minimise: () => void;
    maximise: () => void;
    close: () => void;
    useCustomFrame: () => boolean;
  };
}

const extWindow = window as unknown as ExtendedWindow;

// Wait for DOM content to be loaded
document.addEventListener("DOMContentLoaded", () => {
  const native = extWindow.native;

  // Set up version values
  if (native && native.versions) {
    const desktopVer = document.getElementById("ver-desktop");
    const electronVer = document.getElementById("ver-electron");
    const chromeVer = document.getElementById("ver-chrome");
    const nodeVer = document.getElementById("ver-node");

    if (desktopVer) desktopVer.textContent = "v" + native.versions.desktop();
    if (electronVer) electronVer.textContent = "v" + native.versions.electron();
    if (chromeVer) chromeVer.textContent = "v" + native.versions.chrome();
    if (nodeVer) nodeVer.textContent = "v" + native.versions.node();
  }

  // Set up window titlebar controls
  const titlebar = document.getElementById("titlebar");
  const winMinimise = document.getElementById("win-minimise");
  const winMaximise = document.getElementById("win-maximise");
  const winClose = document.getElementById("win-close");

  if (native && titlebar && native.useCustomFrame()) {
    document.body.classList.add("has-custom-titlebar");
    titlebar.style.display = "flex";

    if (winMinimise) winMinimise.addEventListener("click", () => native.minimise());
    if (winMaximise) winMaximise.addEventListener("click", () => native.maximise());
    if (winClose) winClose.addEventListener("click", () => native.close());
  }
});
