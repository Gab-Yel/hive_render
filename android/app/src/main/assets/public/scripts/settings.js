// scripts/settings.js
// -----------------------------------------------------------------------------
// The user settings modal: view your account details, change your display
// name, change your profile picture, log out. Kept intentionally small — you
// said you weren't sure what belongs here, so we stuck to the essentials
// (identity + housekeeping) rather than guessing at extra preferences.
// -----------------------------------------------------------------------------

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderSettingsBody(user, room) {
  const body = document.getElementById("settings-body");
  const initials = user.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  body.innerHTML = `
    <div class="settings-avatar-row">
      <div class="settings-avatar" id="settings-avatar" style="${user.avatar ? `background-image:url(${user.avatar});background-size:cover;background-position:center;` : ""}">
        ${user.avatar ? "" : initials}
      </div>
      <div>
        <button class="composer-secondary" id="change-avatar-btn">Change Photo</button>
        <input type="file" accept="image/*" id="avatar-input" class="visually-hidden">
      </div>
    </div>

    <div class="auth-field">
      <label>Username</label>
      <input type="text" id="settings-name" value="${user.name}">
    </div>

    <div class="settings-detail-row"><span>Phone</span><span class="value">${user.phone}</span></div>
    <div class="settings-detail-row"><span>Role</span><span class="value" style="text-transform:capitalize;">${user.role || "—"}</span></div>

    ${
      room
        ? `
    <div class="auth-field">
      <label>Room Invite Code <span class="optional">(share this with roommates)</span></label>
      <div class="settings-room-code-row">
        <div class="room-code-display" id="settings-room-code">${room.code}</div>
        <button class="composer-secondary" id="copy-room-code" type="button">Copy</button>
      </div>
    </div>
    `
        : ""
    }

    <p class="auth-error" id="settings-error"></p>
    <button class="composer-submit flex" id="save-settings">Save Changes</button>
    <button class="auth-btn secondary full" id="settings-logout" style="margin-top:10px;">Log Out</button>
  `;

  if (room) {
    document.getElementById("copy-room-code").onclick = async (e) => {
      try {
        await navigator.clipboard.writeText(room.code);
        const btn = e.currentTarget;
        const original = btn.textContent;
        btn.textContent = "Copied!";
        setTimeout(() => (btn.textContent = original), 1500);
      } catch (_) {
        // Clipboard API unavailable (rare, e.g. very old WebViews) — the
        // code is already selectable as plain text right above the button.
        alert(`Room code: ${room.code}`);
      }
    };
  }

  document.getElementById("change-avatar-btn").onclick = () => document.getElementById("avatar-input").click();

  document.getElementById("avatar-input").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    const avatarEl = document.getElementById("settings-avatar");
    avatarEl.style.backgroundImage = `url(${dataUrl})`;
    avatarEl.style.backgroundSize = "cover";
    avatarEl.style.backgroundPosition = "center";
    avatarEl.textContent = "";
    avatarEl.dataset.pending = dataUrl;
  };

  document.getElementById("save-settings").onclick = async () => {
    const errorEl = document.getElementById("settings-error");
    const name = document.getElementById("settings-name").value.trim();
    const avatarEl = document.getElementById("settings-avatar");
    const avatar = avatarEl.dataset.pending || undefined;

    try {
      const { user: updated } = await api("/users/me", { method: "PATCH", body: { name, avatar } });
      Auth.setUser(updated);
      renderSidebarUser();
      closeSettings();
    } catch (err) {
      errorEl.textContent = err.message;
    }
  };

  document.getElementById("settings-logout").onclick = () => {
    Auth.logout();
    location.reload();
  };
}

async function openSettings() {
  const user = Auth.getUser();
  if (!user) return;
  document.getElementById("settings-modal").classList.add("open");
  renderSettingsBody(user, null); // show immediately, room code fills in a moment later

  if (user.roomId) {
    try {
      const { room } = await api("/rooms/mine");
      // Guard against the modal having been closed (or user changed) while
      // this was in flight.
      if (document.getElementById("settings-modal").classList.contains("open")) {
        renderSettingsBody(Auth.getUser(), room);
      }
    } catch (_) {
      // Non-critical — settings still works without the room code showing.
    }
  }
}

function closeSettings() {
  document.getElementById("settings-modal").classList.remove("open");
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("close-settings").addEventListener("click", closeSettings);
  document.getElementById("settings-modal").addEventListener("click", (e) => {
    if (e.target.id === "settings-modal") closeSettings();
  });
});
