# Study Time Tracker (Windows)

A simple, dark-mode desktop study tracker built with Electron. It includes:
- Stopwatch with start, pause, resume, and finish
- Subject selection and custom subjects
- Daily total and Monday-to-today weekly total
- Adjustable daily goal
- Recent saved sessions
- Local JSON storage on your laptop (no account or cloud service)

## Run it in development

1. Install **Node.js LTS** from https://nodejs.org/ (the installer includes npm).
2. Extract this ZIP to a folder, for example `Documents\StudyTimeTracker`.
3. Open that folder in File Explorer.
4. Click the folder address bar, type `cmd`, and press Enter.
5. In the Command Prompt window, run:

   ```bat
   npm install
   npm start
   ```

The first command downloads the app's development dependencies and needs an internet connection. The second opens the tracker.

## Build a Windows installer

After `npm install`, run:

```bat
npm run dist
```

When the build completes, open the `release` folder inside the project folder. Run the generated `Study Time Tracker Setup 1.0.0.exe` installer. The installer lets you choose an installation folder and creates Start Menu and desktop shortcuts.

Building the Windows installer is best done on Windows. The first build may take a few minutes because Electron and packaging tools need to download.

## Where your data is stored

Your sessions and daily goal are saved locally in Electron's app data folder, typically:

`%APPDATA%\study-time-tracker\study-data.json`

Uninstalling the app may not remove this data file. You can back it up by copying `study-data.json` somewhere safe while the app is closed.

## Notes

- The weekly total runs from Monday through the current day.
- The timer measures elapsed time using timestamps, so it remains accurate when the window is in the background.
- A session is added to history when you click **Finish**. Pausing does not save a separate session.
- This starter version is designed for one laptop and one local data file. It does not sync between devices.
