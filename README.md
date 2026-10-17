# ⚡ BetterFACEIT

[![Platform](https://img.shields.io/badge/Platform-Windows-blue.svg)](https://microsoft.com/windows)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![FACEIT Anti-Cheat](https://img.shields.io/badge/FACEIT%20Anti--Cheat-100%25%20Safe-brightgreen.svg)](https://www.faceit.com)

> The Ultimate Performance Optimizer & Chrome Extension Suite for the FACEIT Desktop Client. 

Turns the laggy, annoying Faceit-Browser experience into a lightweight desktop application designed to be ran alongside Counter-Strike without affecting its performance. 

TLDR: You can have it perma-open on the second monitor for quick trashtalks without sacrificing performance :D

<p align="center">
  <img src="https://raw.githubusercontent.com/sheistyszn/betterfaceit/refs/heads/main/assets/preview2.png" alt="BetterFACEIT MR" width="850">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/sheistyszn/betterfaceit/refs/heads/main/assets/preview.png" alt="BetterFACEIT UI" width="850">
</p>

---

## ✨ Features

- ⚡ **Low-Resource Performance Mode**
  - **GPU Acceleration:** Fixes FACEIT's default bug that forced software CPU rendering (`d3d11-warp-webgl`), reducing idle/background CPU usage from **~10% down to 0%**.
  - **Memory Optimization:** Implements automatic V8 JavaScript heap management (`--max-old-space-size=450`) and background process capping to stop the client from eating 1+ GB of RAM.
  - **Auto Memory Purge on Alt-Tab:** Flushes unused render caches 5 seconds after tabbing into your game.
  - **Telemetry Debloat:** Blocks heavy telemetry and error reporters (`sentry.io`, `datadoghq.com`) for cleaner networking and zero frame hitches.

- 📦 **Pre-bundled Extensions (Toggle with 1 Click)**
  - Comes pre-packaged with my favorite extensions:
    - 🎯 **Repeek** (formerly *FACEIT Enhancer*)
    - 🧹 **Faceit UI Cleaner**
    - 📊 **VisusGG**
  - Pre-installed out of the box and ready to enable instantly inside the manager.

- 🔍 **Interactive Zoom & Resolution Scaling**

- 🧩 **BetterFACEIT Dashboard (`Ctrl + Shift + E`)**

- 🔄 **Built-in Auto-Updater & 1-Click Sync**
  - Automatically checks for updates from GitHub in the background, updates runtime files and extensions, and relaunches with a single click.

---

## 🛡️ Is BetterFACEIT Safe with FACEIT Anti-Cheat?

**Yes, 100% safe.**

- **Strict Isolation:** BetterFACEIT operates purely inside the **FACEIT Desktop Client's web UI** (`%LOCALAPPDATA%\FACEIT\`). It never touches game files (`cs2.exe`), never hooks system memory, and has zero interaction with **FACEIT Anti-Cheat** (`faceit.sys`).
- **Fully Compliant:** Third-party extensions like Repeek and Faceit UI Cleaner are officially recognized and used by millions of competitive and pro players on Google Chrome, Brave, and Edge every day. BetterFACEIT simply brings that exact same capability to the official Desktop Client.

---

## 📥 Quick Installation (1-Click)

1. **Download the latest release:**
   - Click the green **Code** button above ➔ **Download ZIP**, then extract it.
2. **Run Installer:**
   - Double-click **`install.bat`** (or right-click `install.ps1` ➔ *Run with PowerShell*).
3. **Done!**
   - The installer creates a clean verified backup of stock files, configures performance optimizations, and deploys the pre-bundled extensions.

---

## 📄 License

Distributed under the MIT License. See [LICENSE](LICENSE) for more information.
