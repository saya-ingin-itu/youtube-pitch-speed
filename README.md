# YouTube Pitch & Speed Controller

<p align="center">
  <img src="icons/icon128.png" alt="icon" width="96">
</p>

YouTubeの再生速度とピッチ（音程）を独立して変更できるChrome拡張機能。

A Chrome extension that lets you independently control playback speed and pitch on YouTube.

---

## Features / 機能

### Speed Control / 再生速度コントロール
- 0.25x ~ 3.0x の範囲で自由に調整
- Adjust freely from 0.25x to 3.0x

### Pitch Control / ピッチコントロール
- -12 ~ +12 半音の範囲でピッチを変更
- Shift pitch from -12 to +12 semitones

### Mini Mode / ミニモード
- 画面右下に小さなバッジで現在値を表示
- 邪魔にならない半透明デザイン、クリックでフルパネルを展開
- Compact badge at bottom-right showing current values
- Semi-transparent design, click to expand full panel

### Player Bar Button / プレーヤーバーボタン
- YouTube動画プレーヤーの設定ボタン横にアイコンを追加
- クリックでプレーヤー内にポップオーバーを表示
- Adds an icon next to YouTube's settings button
- Click to open a popover within the player

### Toolbar Popup / ツールバーポップアップ
- 拡張機能アイコンをクリックしてどこからでも操作可能
- Control from anywhere by clicking the extension icon

### Settings Persistence / 設定の永続化
- 速度・ピッチの設定が自動保存される
- ページ遷移・リロード後も設定が維持される
- Speed and pitch settings are automatically saved
- Settings persist across page navigation and reloads

### Keyboard Shortcuts / キーボードショートカット
| Shortcut | Action |
|----------|--------|
| `Alt + S` | パネル表示/非表示 Toggle panel |
| `Alt + ↑↓` | ピッチ ±1半音 Pitch ±1 semitone |
| `Alt + ←→` | 速度 ±0.1x Speed ±0.1x |

### Double-click Reset / ダブルクリックリセット
- 速度スライダーをダブルクリック → 1.0x に戻る
- ピッチスライダーをダブルクリック → 0 に戻る
- Double-click speed slider → reset to 1.0x
- Double-click pitch slider → reset to 0

---

## Install / インストール

1. このリポジトリをダウンロードまたはクローン / Clone or download this repo
   ```
   git clone https://github.com/saya-ingin-itu/youtube-pitch-speed.git
   ```
2. Chromeで `chrome://extensions/` を開く / Open `chrome://extensions/` in Chrome
3. 「デベロッパーモード」を有効にする / Enable "Developer mode"
4. 「パッケージ化されていない拡張機能を読み込む」をクリック / Click "Load unpacked"
5. ダウンロードしたフォルダを選択 / Select the downloaded folder

---

## Usage / 使い方

### プレーヤー内操作 / In-Player Controls
動画プレーヤーの右下にある音符アイコン（♪）をクリックすると、プレーヤー内にコントロールパネルが開きます。

Click the music note icon (♪) at the bottom-right of the video player to open the control panel.

### ミニバッジ / Mini Badge
画面右下の小さなバッジに現在の設定値が表示されます。クリックするとフルパネルが開きます。

A small badge at the bottom-right of the screen shows current settings. Click to open the full panel.

### ポップアップ / Popup
ブラウザツールバーの拡張機能アイコンをクリックすると、ポップアップからも操作できます。

Click the extension icon in the browser toolbar to control via popup.

---

## How It Works / 仕組み

- **速度変更**: `HTMLMediaElement.playbackRate` を使用
- **ピッチ変更**: `preservesPitch = false` にした上で `playbackRate` を調整し、速度とピッチの比率を計算して適用
- YouTubeが `playbackRate` を上書きするのを防ぐため、プロパティをフックして設定を維持

- **Speed**: Uses `HTMLMediaElement.playbackRate`
- **Pitch**: Sets `preservesPitch = false` and adjusts `playbackRate` to achieve the desired pitch ratio
- Hooks the `playbackRate` property to prevent YouTube from overriding settings

---

## License / ライセンス

MIT
