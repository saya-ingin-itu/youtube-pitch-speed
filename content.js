(() => {
  "use strict";

  // Prevent double injection
  if (document.getElementById("yt-pitch-speed-panel")) return;

  let currentSpeed = 1.0;
  let currentPitch = 0; // semitones
  let panel = null;
  let miniPanel = null;
  let playerButton = null;
  let popover = null;
  let enforceInterval = null;

  // ── Storage ─────────────────────────────────────────────────
  function loadSettings(callback) {
    chrome.storage.local.get(["ytps_speed", "ytps_pitch"], (data) => {
      if (data.ytps_speed != null) currentSpeed = data.ytps_speed;
      if (data.ytps_pitch != null) currentPitch = data.ytps_pitch;
      if (callback) callback();
    });
  }

  function saveSettings() {
    chrome.storage.local.set({ ytps_speed: currentSpeed, ytps_pitch: currentPitch });
  }

  function clearSettings() {
    chrome.storage.local.remove(["ytps_speed", "ytps_pitch"]);
  }

  // ── Listen for popup messages ───────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "ytps_update") {
      currentSpeed = msg.speed;
      currentPitch = msg.pitch;
      forceApply();
      syncAllUI();
      sendResponse({ ok: true });
    }
  });

  // ── Video element ───────────────────────────────────────────
  function getVideo() {
    return document.querySelector("video.html5-main-video") || document.querySelector("video");
  }

  function applySettings() {
    const video = getVideo();
    if (!video) return;

    if (currentPitch === 0) {
      video.preservesPitch = true;
      video.mozPreservesPitch = true;
      video.webkitPreservesPitch = true;
      video.playbackRate = currentSpeed;
    } else {
      const pitchRatio = Math.pow(2, currentPitch / 12);
      video.preservesPitch = false;
      video.mozPreservesPitch = false;
      video.webkitPreservesPitch = false;
      video.playbackRate = currentSpeed * pitchRatio;
    }
  }

  function hookVideoElement() {
    const video = getVideo();
    if (!video) return;

    const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "playbackRate");
    if (descriptor && !video.__ytps_hooked) {
      video.__ytps_hooked = true;
      let _rate = video.playbackRate;

      Object.defineProperty(video, "playbackRate", {
        get() { return _rate; },
        set(val) {
          if (video.__ytps_setting) {
            _rate = val;
            descriptor.set.call(video, val);
            return;
          }
          if (currentSpeed === 1.0 && currentPitch === 0) {
            _rate = val;
            descriptor.set.call(video, val);
          }
        },
        configurable: true,
      });

      const pitchDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "preservesPitch");
      if (pitchDesc) {
        let _preserves = true;
        Object.defineProperty(video, "preservesPitch", {
          get() { return _preserves; },
          set(val) {
            if (video.__ytps_setting) {
              _preserves = val;
              pitchDesc.set.call(video, val);
              return;
            }
            if (currentSpeed === 1.0 && currentPitch === 0) {
              _preserves = val;
              pitchDesc.set.call(video, val);
            }
          },
          configurable: true,
        });
      }
    }
  }

  function forceApply() {
    const video = getVideo();
    if (!video) return;
    video.__ytps_setting = true;
    applySettings();
    video.__ytps_setting = false;
  }

  function startEnforcing() {
    if (enforceInterval) clearInterval(enforceInterval);
    enforceInterval = setInterval(() => {
      const video = getVideo();
      if (!video) return;
      const desired = currentPitch === 0
        ? currentSpeed
        : currentSpeed * Math.pow(2, currentPitch / 12);
      if (Math.abs(video.playbackRate - desired) > 0.01) {
        forceApply();
      }
    }, 500);
  }

  // ── Sync all UI elements ────────────────────────────────────
  function syncAllUI() {
    // Mini panel badge
    if (miniPanel) {
      const badge = miniPanel.querySelector(".ytps-mini-text");
      if (badge) {
        badge.textContent = formatMiniText();
      }
    }

    // Floating panel
    if (panel) {
      const ss = panel.querySelector("#speed-slider");
      const sv = panel.querySelector("#speed-value");
      const ps = panel.querySelector("#pitch-slider");
      const pv = panel.querySelector("#pitch-value");
      if (ss) { ss.value = currentSpeed; sv.textContent = currentSpeed.toFixed(2) + "x"; }
      if (ps) { ps.value = currentPitch; pv.textContent = (currentPitch > 0 ? "+" : "") + currentPitch; }
      updatePresetButtons(panel, "speed", currentSpeed);
      updatePresetButtons(panel, "pitch", currentPitch);
    }

    // Player popover
    if (popover) {
      const ss = popover.querySelector("#ytps-pop-speed-slider");
      const sv = popover.querySelector("#ytps-pop-speed-value");
      const ps = popover.querySelector("#ytps-pop-pitch-slider");
      const pv = popover.querySelector("#ytps-pop-pitch-value");
      if (ss) { ss.value = currentSpeed; sv.textContent = currentSpeed.toFixed(2) + "x"; }
      if (ps) { ps.value = currentPitch; pv.textContent = (currentPitch > 0 ? "+" : "") + currentPitch; }
      updatePresetButtons(popover, "speed", currentSpeed);
      updatePresetButtons(popover, "pitch", currentPitch);
    }
  }

  function formatMiniText() {
    const s = currentSpeed !== 1.0 ? currentSpeed.toFixed(2) + "x" : "";
    const p = currentPitch !== 0 ? ((currentPitch > 0 ? "+" : "") + currentPitch + "st") : "";
    if (s && p) return s + " / " + p;
    if (s) return s;
    if (p) return p;
    return "1.00x";
  }

  // ── Mini floating panel (bottom-right of player) ────────────
  function createMiniPanel() {
    miniPanel = document.createElement("div");
    miniPanel.id = "yt-pitch-speed-panel";
    miniPanel.className = "ytps-mini";
    miniPanel.innerHTML = `
      <span class="ytps-mini-text">${formatMiniText()}</span>
    `;
    miniPanel.addEventListener("click", (e) => {
      e.stopPropagation();
      if (panel) {
        panel.style.display = panel.style.display === "none" ? "" : "none";
      }
    });
    document.body.appendChild(miniPanel);
  }

  // ── Full floating panel (expandable) ────────────────────────
  function createPanel() {
    panel = document.createElement("div");
    panel.id = "ytps-full-panel";
    panel.style.display = "none";
    panel.innerHTML = `
      <div class="panel-header">
        <h3>Pitch & Speed</h3>
        <div class="panel-header-buttons">
          <button id="yps-close" title="閉じる">&#x2715;</button>
        </div>
      </div>
      <div class="panel-body">
        <div class="control-group">
          <div class="control-label">
            <span>再生速度</span>
            <span class="control-value" id="speed-value">${currentSpeed.toFixed(2)}x</span>
          </div>
          <div class="slider-track speed-track">
            <input type="range" class="control-slider" id="speed-slider"
                   min="0.25" max="3" step="0.05" value="${currentSpeed}">
          </div>
          <div class="button-row">
            <button class="preset-btn" data-speed="0.5">0.5x</button>
            <button class="preset-btn" data-speed="0.75">0.75x</button>
            <button class="preset-btn" data-speed="1">1.0x</button>
            <button class="preset-btn" data-speed="1.5">1.5x</button>
            <button class="preset-btn" data-speed="2">2.0x</button>
          </div>
        </div>
        <div class="control-group">
          <div class="control-label">
            <span>ピッチ（半音）</span>
            <span class="control-value pitch-value" id="pitch-value">${(currentPitch > 0 ? "+" : "") + currentPitch}</span>
          </div>
          <div class="slider-track pitch-track">
            <input type="range" class="control-slider pitch-slider" id="pitch-slider"
                   min="-12" max="12" step="1" value="${currentPitch}">
          </div>
          <div class="button-row">
            <button class="preset-btn" data-pitch="-3">-3</button>
            <button class="preset-btn" data-pitch="-1">-1</button>
            <button class="preset-btn" data-pitch="0">0</button>
            <button class="preset-btn" data-pitch="1">+1</button>
            <button class="preset-btn" data-pitch="3">+3</button>
          </div>
        </div>
        <button class="reset-btn" id="yps-reset">リセット</button>
        <div class="shortcut-hint">
          <kbd>Alt+S</kbd> パネル表示/非表示
          <kbd>Alt+&#x2191;&#x2193;</kbd> ピッチ &plusmn;1
          <kbd>Alt+&#x2190;&#x2192;</kbd> 速度 &plusmn;0.1
        </div>
      </div>
    `;
    document.body.appendChild(panel);

    // Drag
    makeDraggable(panel, panel.querySelector(".panel-header"));

    // Speed slider
    const speedSlider = panel.querySelector("#speed-slider");
    const speedValue = panel.querySelector("#speed-value");
    speedSlider.addEventListener("input", () => {
      currentSpeed = parseFloat(speedSlider.value);
      speedValue.textContent = currentSpeed.toFixed(2) + "x";
      updatePresetButtons(panel, "speed", currentSpeed);
      forceApply();
      saveSettings();
      syncAllUI();
    });

    // Double-click to reset speed
    speedSlider.addEventListener("dblclick", () => {
      currentSpeed = 1.0;
      speedSlider.value = 1;
      speedValue.textContent = "1.00x";
      updatePresetButtons(panel, "speed", 1);
      forceApply();
      saveSettings();
      syncAllUI();
    });

    // Pitch slider
    const pitchSlider = panel.querySelector("#pitch-slider");
    const pitchValue = panel.querySelector("#pitch-value");
    pitchSlider.addEventListener("input", () => {
      currentPitch = parseInt(pitchSlider.value);
      pitchValue.textContent = (currentPitch > 0 ? "+" : "") + currentPitch;
      updatePresetButtons(panel, "pitch", currentPitch);
      forceApply();
      saveSettings();
      syncAllUI();
    });

    // Double-click to reset pitch
    pitchSlider.addEventListener("dblclick", () => {
      currentPitch = 0;
      pitchSlider.value = 0;
      pitchValue.textContent = "0";
      updatePresetButtons(panel, "pitch", 0);
      forceApply();
      saveSettings();
      syncAllUI();
    });

    // Speed presets
    panel.querySelectorAll("[data-speed]").forEach((btn) => {
      btn.addEventListener("click", () => {
        currentSpeed = parseFloat(btn.dataset.speed);
        speedSlider.value = currentSpeed;
        speedValue.textContent = currentSpeed.toFixed(2) + "x";
        updatePresetButtons(panel, "speed", currentSpeed);
        forceApply();
        saveSettings();
        syncAllUI();
      });
    });

    // Pitch presets
    panel.querySelectorAll("[data-pitch]").forEach((btn) => {
      btn.addEventListener("click", () => {
        currentPitch = parseInt(btn.dataset.pitch);
        pitchSlider.value = currentPitch;
        pitchValue.textContent = (currentPitch > 0 ? "+" : "") + currentPitch;
        updatePresetButtons(panel, "pitch", currentPitch);
        forceApply();
        saveSettings();
        syncAllUI();
      });
    });

    // Reset
    panel.querySelector("#yps-reset").addEventListener("click", () => {
      currentSpeed = 1.0;
      currentPitch = 0;
      speedSlider.value = 1;
      pitchSlider.value = 0;
      speedValue.textContent = "1.00x";
      pitchValue.textContent = "0";
      updatePresetButtons(panel, "speed", 1);
      updatePresetButtons(panel, "pitch", 0);
      forceApply();
      clearSettings();
      syncAllUI();
    });

    // Close
    panel.querySelector("#yps-close").addEventListener("click", () => {
      panel.style.display = "none";
    });

    // Set initial preset active states
    updatePresetButtons(panel, "speed", currentSpeed);
    updatePresetButtons(panel, "pitch", currentPitch);
  }

  // ── Player bar embedded button & popover ────────────────────
  function createPlayerButton() {
    if (playerButton) return;

    const rightControls = document.querySelector(".ytp-right-controls");
    if (!rightControls) return;

    // Check if already inserted
    if (rightControls.querySelector(".ytps-player-btn")) return;

    playerButton = document.createElement("button");
    playerButton.className = "ytp-button ytps-player-btn";
    playerButton.title = "Pitch & Speed";
    playerButton.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="white">
      <path d="M12 3v9.28a4.39 4.39 0 0 0-1.5-.28C8.01 12 6 13.79 6 16s2.01 4 4.5 4S15 18.21 15 16V6h3V3h-6z"/>
    </svg>`;

    // Insert before settings button
    const settingsBtn = rightControls.querySelector(".ytp-settings-button");
    if (settingsBtn) {
      rightControls.insertBefore(playerButton, settingsBtn);
    } else {
      rightControls.appendChild(playerButton);
    }

    playerButton.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePopover();
    });
  }

  function createPopover() {
    if (popover) return popover;

    popover = document.createElement("div");
    popover.className = "ytps-popover";
    popover.innerHTML = `
      <div class="ytps-popover-content">
        <div class="control-group">
          <div class="control-label">
            <span>再生速度</span>
            <span class="control-value" id="ytps-pop-speed-value">${currentSpeed.toFixed(2)}x</span>
          </div>
          <div class="slider-track speed-track">
            <input type="range" class="control-slider" id="ytps-pop-speed-slider"
                   min="0.25" max="3" step="0.05" value="${currentSpeed}">
          </div>
          <div class="button-row">
            <button class="preset-btn" data-speed="0.5">0.5x</button>
            <button class="preset-btn" data-speed="0.75">0.75x</button>
            <button class="preset-btn" data-speed="1">1.0x</button>
            <button class="preset-btn" data-speed="1.5">1.5x</button>
            <button class="preset-btn" data-speed="2">2.0x</button>
          </div>
        </div>
        <div class="control-group">
          <div class="control-label">
            <span>ピッチ（半音）</span>
            <span class="control-value pitch-value" id="ytps-pop-pitch-value">${(currentPitch > 0 ? "+" : "") + currentPitch}</span>
          </div>
          <div class="slider-track pitch-track">
            <input type="range" class="control-slider pitch-slider" id="ytps-pop-pitch-slider"
                   min="-12" max="12" step="1" value="${currentPitch}">
          </div>
          <div class="button-row">
            <button class="preset-btn" data-pitch="-3">-3</button>
            <button class="preset-btn" data-pitch="-1">-1</button>
            <button class="preset-btn" data-pitch="0">0</button>
            <button class="preset-btn" data-pitch="1">+1</button>
            <button class="preset-btn" data-pitch="3">+3</button>
          </div>
        </div>
        <button class="reset-btn" id="ytps-pop-reset">リセット</button>
      </div>
    `;

    // Prevent click propagation to video player
    popover.addEventListener("click", (e) => e.stopPropagation());
    popover.addEventListener("mousedown", (e) => e.stopPropagation());

    const player = document.querySelector("#movie_player") || document.querySelector(".html5-video-player");
    if (player) {
      player.appendChild(popover);
    } else {
      document.body.appendChild(popover);
    }

    // Wire up popover controls
    const ss = popover.querySelector("#ytps-pop-speed-slider");
    const sv = popover.querySelector("#ytps-pop-speed-value");
    const ps = popover.querySelector("#ytps-pop-pitch-slider");
    const pv = popover.querySelector("#ytps-pop-pitch-value");

    ss.addEventListener("input", () => {
      currentSpeed = parseFloat(ss.value);
      sv.textContent = currentSpeed.toFixed(2) + "x";
      updatePresetButtons(popover, "speed", currentSpeed);
      forceApply(); saveSettings(); syncAllUI();
    });

    ss.addEventListener("dblclick", () => {
      currentSpeed = 1.0; ss.value = 1; sv.textContent = "1.00x";
      updatePresetButtons(popover, "speed", 1);
      forceApply(); saveSettings(); syncAllUI();
    });

    ps.addEventListener("input", () => {
      currentPitch = parseInt(ps.value);
      pv.textContent = (currentPitch > 0 ? "+" : "") + currentPitch;
      updatePresetButtons(popover, "pitch", currentPitch);
      forceApply(); saveSettings(); syncAllUI();
    });

    ps.addEventListener("dblclick", () => {
      currentPitch = 0; ps.value = 0; pv.textContent = "0";
      updatePresetButtons(popover, "pitch", 0);
      forceApply(); saveSettings(); syncAllUI();
    });

    popover.querySelectorAll("[data-speed]").forEach((btn) => {
      btn.addEventListener("click", () => {
        currentSpeed = parseFloat(btn.dataset.speed);
        ss.value = currentSpeed; sv.textContent = currentSpeed.toFixed(2) + "x";
        updatePresetButtons(popover, "speed", currentSpeed);
        forceApply(); saveSettings(); syncAllUI();
      });
    });

    popover.querySelectorAll("[data-pitch]").forEach((btn) => {
      btn.addEventListener("click", () => {
        currentPitch = parseInt(btn.dataset.pitch);
        ps.value = currentPitch; pv.textContent = (currentPitch > 0 ? "+" : "") + currentPitch;
        updatePresetButtons(popover, "pitch", currentPitch);
        forceApply(); saveSettings(); syncAllUI();
      });
    });

    popover.querySelector("#ytps-pop-reset").addEventListener("click", () => {
      currentSpeed = 1.0; currentPitch = 0;
      ss.value = 1; ps.value = 0;
      sv.textContent = "1.00x"; pv.textContent = "0";
      updatePresetButtons(popover, "speed", 1);
      updatePresetButtons(popover, "pitch", 0);
      forceApply(); clearSettings(); syncAllUI();
    });

    updatePresetButtons(popover, "speed", currentSpeed);
    updatePresetButtons(popover, "pitch", currentPitch);

    return popover;
  }

  function togglePopover() {
    if (!popover) createPopover();
    popover.classList.toggle("ytps-popover-visible");
  }

  // Close popover when clicking outside
  document.addEventListener("click", (e) => {
    if (popover && popover.classList.contains("ytps-popover-visible")) {
      if (!popover.contains(e.target) && e.target !== playerButton) {
        popover.classList.remove("ytps-popover-visible");
      }
    }
  });

  // ── Helpers ─────────────────────────────────────────────────
  function updatePresetButtons(container, type, value) {
    const attr = type === "speed" ? "data-speed" : "data-pitch";
    container.querySelectorAll(`[${attr}]`).forEach((btn) => {
      const btnVal = parseFloat(btn.dataset[type]);
      btn.classList.toggle("active", btnVal === value);
    });
  }

  function makeDraggable(el, handle) {
    let offsetX, offsetY, isDragging = false;
    handle.addEventListener("mousedown", (e) => {
      if (e.target.tagName === "BUTTON") return;
      isDragging = true;
      offsetX = e.clientX - el.getBoundingClientRect().left;
      offsetY = e.clientY - el.getBoundingClientRect().top;
      e.preventDefault();
    });
    document.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      el.style.left = (e.clientX - offsetX) + "px";
      el.style.top = (e.clientY - offsetY) + "px";
      el.style.right = "auto";
    });
    document.addEventListener("mouseup", () => { isDragging = false; });
  }

  // ── Keyboard shortcuts ──────────────────────────────────────
  document.addEventListener("keydown", (e) => {
    if (!e.altKey) return;
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable) return;

    switch (e.key) {
      case "s":
      case "S":
        e.preventDefault();
        if (panel) {
          panel.style.display = panel.style.display === "none" ? "" : "none";
        }
        break;
      case "ArrowUp":
        e.preventDefault();
        currentPitch = Math.min(12, currentPitch + 1);
        forceApply(); saveSettings(); syncAllUI();
        break;
      case "ArrowDown":
        e.preventDefault();
        currentPitch = Math.max(-12, currentPitch - 1);
        forceApply(); saveSettings(); syncAllUI();
        break;
      case "ArrowRight":
        e.preventDefault();
        currentSpeed = Math.min(3, Math.round((currentSpeed + 0.1) * 100) / 100);
        forceApply(); saveSettings(); syncAllUI();
        break;
      case "ArrowLeft":
        e.preventDefault();
        currentSpeed = Math.max(0.25, Math.round((currentSpeed - 0.1) * 100) / 100);
        forceApply(); saveSettings(); syncAllUI();
        break;
    }
  });

  // ── Try inserting player button periodically ────────────────
  function tryInsertPlayerButton() {
    createPlayerButton();
    if (!playerButton) {
      setTimeout(tryInsertPlayerButton, 1000);
    }
  }

  // ── Init ────────────────────────────────────────────────────
  function init() {
    loadSettings(() => {
      createMiniPanel();
      createPanel();
      tryInsertPlayerButton();

      // Watch for video element and hook it
      const observer = new MutationObserver(() => {
        const video = getVideo();
        if (video && !video.__ytps_hooked) {
          hookVideoElement();
          forceApply();
        }
        // Re-try player button insertion if DOM changed
        if (!playerButton) {
          createPlayerButton();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });

      // Try immediate setup
      const video = getVideo();
      if (video) {
        hookVideoElement();
        forceApply();
      }

      // Re-apply on YouTube SPA navigation
      document.addEventListener("yt-navigate-finish", () => {
        setTimeout(() => {
          hookVideoElement();
          forceApply();
          // Player controls get recreated on navigation
          playerButton = null;
          if (popover) {
            popover.remove();
            popover = null;
          }
          tryInsertPlayerButton();
        }, 500);
      });

      startEnforcing();
      syncAllUI();
    });
  }

  if (document.body) {
    init();
  } else {
    document.addEventListener("DOMContentLoaded", init);
  }
})();
