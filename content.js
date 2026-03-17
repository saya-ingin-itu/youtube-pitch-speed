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

  // ── Web Audio API state ─────────────────────────────────────
  let audioCtx = null;
  let audioSource = null;
  let pitchNode = null;
  let audioSetupVideo = null; // track which video element we've set up

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
      updatePitchNode();
      syncAllUI();
      sendResponse({ ok: true });
    }
  });

  // ── Video element ───────────────────────────────────────────
  function getVideo() {
    return document.querySelector("video.html5-main-video") || document.querySelector("video");
  }

  // ── Web Audio pitch shifter setup ───────────────────────────
  function setupAudioPipeline(video) {
    if (!video || audioSetupVideo === video) return;

    // Clean up previous pipeline
    if (audioCtx) {
      try { audioCtx.close(); } catch (e) {}
      audioCtx = null;
      audioSource = null;
      pitchNode = null;
    }

    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      audioSource = audioCtx.createMediaElementSource(video);

      // Granular OLA pitch shifter via ScriptProcessorNode
      const BUF_SIZE = 4096;      // process buffer
      const CIRC_SIZE = 16384;    // circular buffer
      const GRAIN_SIZE = 2048;    // grain size
      const HALF_GRAIN = GRAIN_SIZE >> 1;

      pitchNode = audioCtx.createScriptProcessor(BUF_SIZE, 2, 2);

      // Per-channel circular buffers
      const circBuf = [new Float32Array(CIRC_SIZE), new Float32Array(CIRC_SIZE)];
      let wp = 0;
      let rp1 = 0;
      let rp2 = HALF_GRAIN;
      let sampleCount = 0;

      pitchNode.onaudioprocess = function (e) {
        const pitchFactor = Math.pow(2, currentPitch / 12);
        const numCh = Math.min(e.inputBuffer.numberOfChannels, e.outputBuffer.numberOfChannels);
        const len = e.inputBuffer.length;

        // Passthrough when no pitch shift
        if (Math.abs(pitchFactor - 1.0) < 0.001) {
          for (let ch = 0; ch < numCh; ch++) {
            e.outputBuffer.getChannelData(ch).set(e.inputBuffer.getChannelData(ch));
          }
          return;
        }

        const inData = [];
        const outData = [];
        for (let ch = 0; ch < numCh; ch++) {
          inData.push(e.inputBuffer.getChannelData(ch));
          outData.push(e.outputBuffer.getChannelData(ch));
        }

        for (let i = 0; i < len; i++) {
          // Write input to circular buffer
          for (let ch = 0; ch < numCh; ch++) {
            circBuf[ch][wp] = inData[ch][i];
          }

          // Read from two overlapping grain positions with Hann crossfade
          const ri1 = Math.floor(rp1);
          const rf1 = rp1 - ri1;
          const i1a = ((ri1 % CIRC_SIZE) + CIRC_SIZE) % CIRC_SIZE;
          const i1b = (i1a + 1) % CIRC_SIZE;

          const ri2 = Math.floor(rp2);
          const rf2 = rp2 - ri2;
          const i2a = ((ri2 % CIRC_SIZE) + CIRC_SIZE) % CIRC_SIZE;
          const i2b = (i2a + 1) % CIRC_SIZE;

          // Hann window phases based on sample count within grain
          const phase1 = (sampleCount % GRAIN_SIZE) / GRAIN_SIZE;
          const phase2 = ((sampleCount + HALF_GRAIN) % GRAIN_SIZE) / GRAIN_SIZE;
          const w1 = 0.5 * (1 - Math.cos(2 * Math.PI * phase1));
          const w2 = 0.5 * (1 - Math.cos(2 * Math.PI * phase2));
          const wSum = w1 + w2 || 1;

          for (let ch = 0; ch < numCh; ch++) {
            const s1 = circBuf[ch][i1a] * (1 - rf1) + circBuf[ch][i1b] * rf1;
            const s2 = circBuf[ch][i2a] * (1 - rf2) + circBuf[ch][i2b] * rf2;
            outData[ch][i] = (s1 * w1 + s2 * w2) / wSum;
          }

          // Advance pointers
          wp = (wp + 1) % CIRC_SIZE;
          rp1 += pitchFactor;
          rp2 += pitchFactor;
          sampleCount++;

          // Wrap read pointers
          while (rp1 >= CIRC_SIZE) rp1 -= CIRC_SIZE;
          while (rp1 < 0) rp1 += CIRC_SIZE;
          while (rp2 >= CIRC_SIZE) rp2 -= CIRC_SIZE;
          while (rp2 < 0) rp2 += CIRC_SIZE;

          // Keep read pointers at safe distance from write pointer
          const dist1 = (wp - Math.floor(rp1) + CIRC_SIZE) % CIRC_SIZE;
          if (dist1 < GRAIN_SIZE * 2 || dist1 > CIRC_SIZE - GRAIN_SIZE * 2) {
            rp1 = (wp - CIRC_SIZE / 2 + CIRC_SIZE) % CIRC_SIZE;
            rp2 = (rp1 + HALF_GRAIN) % CIRC_SIZE;
          }
        }
      };

      audioSource.connect(pitchNode);
      pitchNode.connect(audioCtx.destination);
      audioSetupVideo = video;

      // Resume audio context if suspended
      if (audioCtx.state === "suspended") {
        audioCtx.resume();
      }

      console.log("[YTPS] Web Audio pitch shifter initialized");
    } catch (err) {
      console.warn("[YTPS] Audio pipeline setup failed:", err);
      audioCtx = null;
      audioSource = null;
      pitchNode = null;
      audioSetupVideo = null;
    }
  }

  function updatePitchNode() {
    // Resume audio context on pitch change (handles suspended state)
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume();
    }
  }

  function isWebAudioActive() {
    return audioCtx && audioSource && pitchNode && audioSetupVideo;
  }

  // ── Apply settings ──────────────────────────────────────────
  function applySettings() {
    const video = getVideo();
    if (!video) return;

    // Always use preservesPitch=true; pitch is handled by Web Audio
    video.preservesPitch = true;
    video.mozPreservesPitch = true;
    video.webkitPreservesPitch = true;
    video.playbackRate = currentSpeed;
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
          // Only allow YouTube's set if we haven't changed speed
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

      // Speed is always just currentSpeed now
      if (Math.abs(video.playbackRate - currentSpeed) > 0.01) {
        forceApply();
      }

      // Try to set up audio pipeline if not done yet
      if (!isWebAudioActive() && video) {
        setupAudioPipeline(video);
      }
    }, 500);
  }

  // ── Sync all UI elements ────────────────────────────────────
  function syncAllUI() {
    if (miniPanel) {
      const badge = miniPanel.querySelector(".ytps-mini-text");
      if (badge) badge.textContent = formatMiniText();
    }

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

  // ── Mini floating panel (bottom-right) ──────────────────────
  function createMiniPanel() {
    miniPanel = document.createElement("div");
    miniPanel.id = "yt-pitch-speed-panel";
    miniPanel.className = "ytps-mini";
    miniPanel.innerHTML = `<span class="ytps-mini-text">${formatMiniText()}</span>`;
    miniPanel.addEventListener("click", (e) => {
      e.stopPropagation();
      if (panel) {
        panel.style.display = panel.style.display === "none" ? "" : "none";
      }
    });
    document.body.appendChild(miniPanel);
  }

  // ── Full floating panel ─────────────────────────────────────
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

    makeDraggable(panel, panel.querySelector(".panel-header"));

    const speedSlider = panel.querySelector("#speed-slider");
    const speedValue = panel.querySelector("#speed-value");
    speedSlider.addEventListener("input", () => {
      currentSpeed = parseFloat(speedSlider.value);
      speedValue.textContent = currentSpeed.toFixed(2) + "x";
      updatePresetButtons(panel, "speed", currentSpeed);
      forceApply(); saveSettings(); syncAllUI();
    });
    speedSlider.addEventListener("dblclick", () => {
      currentSpeed = 1.0;
      speedSlider.value = 1; speedValue.textContent = "1.00x";
      updatePresetButtons(panel, "speed", 1);
      forceApply(); saveSettings(); syncAllUI();
    });

    const pitchSlider = panel.querySelector("#pitch-slider");
    const pitchValue = panel.querySelector("#pitch-value");
    pitchSlider.addEventListener("input", () => {
      currentPitch = parseInt(pitchSlider.value);
      pitchValue.textContent = (currentPitch > 0 ? "+" : "") + currentPitch;
      updatePresetButtons(panel, "pitch", currentPitch);
      forceApply(); updatePitchNode(); saveSettings(); syncAllUI();
    });
    pitchSlider.addEventListener("dblclick", () => {
      currentPitch = 0;
      pitchSlider.value = 0; pitchValue.textContent = "0";
      updatePresetButtons(panel, "pitch", 0);
      forceApply(); updatePitchNode(); saveSettings(); syncAllUI();
    });

    panel.querySelectorAll("[data-speed]").forEach((btn) => {
      btn.addEventListener("click", () => {
        currentSpeed = parseFloat(btn.dataset.speed);
        speedSlider.value = currentSpeed;
        speedValue.textContent = currentSpeed.toFixed(2) + "x";
        updatePresetButtons(panel, "speed", currentSpeed);
        forceApply(); saveSettings(); syncAllUI();
      });
    });

    panel.querySelectorAll("[data-pitch]").forEach((btn) => {
      btn.addEventListener("click", () => {
        currentPitch = parseInt(btn.dataset.pitch);
        pitchSlider.value = currentPitch;
        pitchValue.textContent = (currentPitch > 0 ? "+" : "") + currentPitch;
        updatePresetButtons(panel, "pitch", currentPitch);
        forceApply(); updatePitchNode(); saveSettings(); syncAllUI();
      });
    });

    panel.querySelector("#yps-reset").addEventListener("click", () => {
      currentSpeed = 1.0; currentPitch = 0;
      speedSlider.value = 1; pitchSlider.value = 0;
      speedValue.textContent = "1.00x"; pitchValue.textContent = "0";
      updatePresetButtons(panel, "speed", 1);
      updatePresetButtons(panel, "pitch", 0);
      forceApply(); updatePitchNode(); clearSettings(); syncAllUI();
    });

    panel.querySelector("#yps-close").addEventListener("click", () => {
      panel.style.display = "none";
    });

    updatePresetButtons(panel, "speed", currentSpeed);
    updatePresetButtons(panel, "pitch", currentPitch);
  }

  // ── Player bar button & popover ─────────────────────────────
  function createPlayerButton() {
    if (playerButton) return;
    const rightControls = document.querySelector(".ytp-right-controls");
    if (!rightControls) return;
    if (rightControls.querySelector(".ytps-player-btn")) return;

    playerButton = document.createElement("button");
    playerButton.className = "ytp-button ytps-player-btn";
    playerButton.title = "Pitch & Speed";
    playerButton.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="white">
      <path d="M12 3v9.28a4.39 4.39 0 0 0-1.5-.28C8.01 12 6 13.79 6 16s2.01 4 4.5 4S15 18.21 15 16V6h3V3h-6z"/>
    </svg>`;

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

    popover.addEventListener("click", (e) => e.stopPropagation());
    popover.addEventListener("mousedown", (e) => e.stopPropagation());

    const player = document.querySelector("#movie_player") || document.querySelector(".html5-video-player");
    if (player) {
      player.appendChild(popover);
    } else {
      document.body.appendChild(popover);
    }

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
      forceApply(); updatePitchNode(); saveSettings(); syncAllUI();
    });
    ps.addEventListener("dblclick", () => {
      currentPitch = 0; ps.value = 0; pv.textContent = "0";
      updatePresetButtons(popover, "pitch", 0);
      forceApply(); updatePitchNode(); saveSettings(); syncAllUI();
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
        forceApply(); updatePitchNode(); saveSettings(); syncAllUI();
      });
    });

    popover.querySelector("#ytps-pop-reset").addEventListener("click", () => {
      currentSpeed = 1.0; currentPitch = 0;
      ss.value = 1; ps.value = 0;
      sv.textContent = "1.00x"; pv.textContent = "0";
      updatePresetButtons(popover, "speed", 1);
      updatePresetButtons(popover, "pitch", 0);
      forceApply(); updatePitchNode(); clearSettings(); syncAllUI();
    });

    updatePresetButtons(popover, "speed", currentSpeed);
    updatePresetButtons(popover, "pitch", currentPitch);
    return popover;
  }

  function togglePopover() {
    if (!popover) createPopover();
    popover.classList.toggle("ytps-popover-visible");
  }

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
        forceApply(); updatePitchNode(); saveSettings(); syncAllUI();
        break;
      case "ArrowDown":
        e.preventDefault();
        currentPitch = Math.max(-12, currentPitch - 1);
        forceApply(); updatePitchNode(); saveSettings(); syncAllUI();
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

      const observer = new MutationObserver(() => {
        const video = getVideo();
        if (video && !video.__ytps_hooked) {
          hookVideoElement();
          forceApply();
          setupAudioPipeline(video);
        }
        if (!playerButton) {
          createPlayerButton();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });

      const video = getVideo();
      if (video) {
        hookVideoElement();
        forceApply();
        setupAudioPipeline(video);
      }

      document.addEventListener("yt-navigate-finish", () => {
        setTimeout(() => {
          // Reset audio pipeline for new video element
          const newVideo = getVideo();
          if (newVideo && newVideo !== audioSetupVideo) {
            audioSetupVideo = null;
            setupAudioPipeline(newVideo);
          }
          hookVideoElement();
          forceApply();
          playerButton = null;
          if (popover) {
            popover.remove();
            popover = null;
          }
          tryInsertPlayerButton();
        }, 500);
      });

      // Resume AudioContext on user interaction (Chrome autoplay policy)
      const resumeAudio = () => {
        if (audioCtx && audioCtx.state === "suspended") {
          audioCtx.resume();
        }
      };
      document.addEventListener("click", resumeAudio, { once: false });
      document.addEventListener("keydown", resumeAudio, { once: false });

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
