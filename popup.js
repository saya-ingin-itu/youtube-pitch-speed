(() => {
  const speedSlider = document.getElementById("speed-slider");
  const speedValue = document.getElementById("speed-value");
  const pitchSlider = document.getElementById("pitch-slider");
  const pitchValue = document.getElementById("pitch-value");
  const statusEl = document.getElementById("popup-status");

  let currentSpeed = 1.0;
  let currentPitch = 0;

  // Load saved settings
  chrome.storage.local.get(["ytps_speed", "ytps_pitch"], (data) => {
    if (data.ytps_speed != null) {
      currentSpeed = data.ytps_speed;
      speedSlider.value = currentSpeed;
      speedValue.textContent = currentSpeed.toFixed(2) + "x";
    }
    if (data.ytps_pitch != null) {
      currentPitch = data.ytps_pitch;
      pitchSlider.value = currentPitch;
      pitchValue.textContent = (currentPitch > 0 ? "+" : "") + currentPitch;
    }
    updatePresetButtons("speed", currentSpeed);
    updatePresetButtons("pitch", currentPitch);
  });

  function sendToContentScript() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]?.id) return;
      chrome.tabs.sendMessage(tabs[0].id, {
        type: "ytps_update",
        speed: currentSpeed,
        pitch: currentPitch,
      }).then(() => {
        statusEl.textContent = "適用済み";
        statusEl.className = "popup-status success";
        setTimeout(() => { statusEl.textContent = ""; }, 1500);
      }).catch(() => {
        statusEl.textContent = "YouTube動画を開いてください";
        statusEl.className = "popup-status error";
      });
    });
  }

  function saveAndSend() {
    chrome.storage.local.set({ ytps_speed: currentSpeed, ytps_pitch: currentPitch });
    sendToContentScript();
  }

  // Speed slider
  speedSlider.addEventListener("input", () => {
    currentSpeed = parseFloat(speedSlider.value);
    speedValue.textContent = currentSpeed.toFixed(2) + "x";
    updatePresetButtons("speed", currentSpeed);
    saveAndSend();
  });

  // Pitch slider
  pitchSlider.addEventListener("input", () => {
    currentPitch = parseInt(pitchSlider.value);
    pitchValue.textContent = (currentPitch > 0 ? "+" : "") + currentPitch;
    updatePresetButtons("pitch", currentPitch);
    saveAndSend();
  });

  // Speed presets
  document.querySelectorAll("[data-speed]").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentSpeed = parseFloat(btn.dataset.speed);
      speedSlider.value = currentSpeed;
      speedValue.textContent = currentSpeed.toFixed(2) + "x";
      updatePresetButtons("speed", currentSpeed);
      saveAndSend();
    });
  });

  // Pitch presets
  document.querySelectorAll("[data-pitch]").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentPitch = parseInt(btn.dataset.pitch);
      pitchSlider.value = currentPitch;
      pitchValue.textContent = (currentPitch > 0 ? "+" : "") + currentPitch;
      updatePresetButtons("pitch", currentPitch);
      saveAndSend();
    });
  });

  // Reset
  document.getElementById("popup-reset").addEventListener("click", () => {
    currentSpeed = 1.0;
    currentPitch = 0;
    speedSlider.value = 1;
    pitchSlider.value = 0;
    speedValue.textContent = "1.00x";
    pitchValue.textContent = "0";
    updatePresetButtons("speed", 1);
    updatePresetButtons("pitch", 0);
    chrome.storage.local.remove(["ytps_speed", "ytps_pitch"]);
    sendToContentScript();
  });

  // Double-click to reset individual sliders
  speedSlider.addEventListener("dblclick", () => {
    currentSpeed = 1.0;
    speedSlider.value = 1;
    speedValue.textContent = "1.00x";
    updatePresetButtons("speed", 1);
    saveAndSend();
  });

  pitchSlider.addEventListener("dblclick", () => {
    currentPitch = 0;
    pitchSlider.value = 0;
    pitchValue.textContent = "0";
    updatePresetButtons("pitch", 0);
    saveAndSend();
  });

  function updatePresetButtons(type, value) {
    const attr = type === "speed" ? "data-speed" : "data-pitch";
    document.querySelectorAll(`[${attr}]`).forEach((btn) => {
      const btnVal = parseFloat(btn.dataset[type]);
      btn.classList.toggle("active", btnVal === value);
    });
  }
})();
