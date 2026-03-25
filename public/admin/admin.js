const ui = {
  loginCard: document.getElementById("loginCard"),
  dashboard: document.getElementById("dashboard"),
  loginForm: document.getElementById("loginForm"),
  loginButton: document.getElementById("loginButton"),
  passwordInput: document.getElementById("passwordInput"),
  loginMessage: document.getElementById("loginMessage"),
  refreshButton: document.getElementById("refreshButton"),
  logoutButton: document.getElementById("logoutButton"),
  overviewCards: document.getElementById("overviewCards"),
  submissionsList: document.getElementById("submissionsList"),
  submissionsMeta: document.getElementById("submissionsMeta"),
  securityBanner: document.getElementById("securityBanner"),
};

function formatTime(timestamp) {
  if (!timestamp) {
    return "Not yet";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(data.error || "Request failed.");
  }

  return data;
}

async function checkSession() {
  try {
    const session = await requestJson("/api/admin/session", {
      headers: {},
    });

    if (session.authenticated) {
      showDashboard();
      await loadDashboard();
    } else {
      showLogin();
    }
  } catch (error) {
    showLogin();
    ui.loginMessage.textContent = "Could not confirm the admin session.";
  }
}

function showLogin() {
  ui.loginCard.classList.remove("hidden");
  ui.dashboard.classList.add("hidden");
}

function showDashboard() {
  ui.loginCard.classList.add("hidden");
  ui.dashboard.classList.remove("hidden");
}

function renderOverview(overview) {
  const cards = [
    {
      label: "Active listeners",
      value: overview.live.activeParticipants,
      detail: "People currently holding the field open.",
    },
    {
      label: "Session peak",
      value: overview.live.peakParticipants,
      detail: "Highest simultaneous live count.",
    },
    {
      label: "Activations",
      value: overview.live.totalJoins,
      detail: "Total joins this server session.",
    },
    {
      label: "Total briefs",
      value: overview.leads.totalSubmissions,
      detail: `Last brief ${formatTime(overview.leads.lastSubmissionAt)}.`,
    },
    {
      label: "New",
      value: overview.leads.byStatus.new,
      detail: "Fresh submissions waiting for review.",
    },
    {
      label: "Contacted",
      value: overview.leads.byStatus.contacted,
      detail: `${overview.leads.submissionsToday} submissions in the last 24h.`,
    },
  ];

  ui.overviewCards.innerHTML = cards
    .map(
      (card) => `
        <article class="metric-card panel">
          <span class="meta-label">${card.label}</span>
          <strong class="metric-value">${card.value}</strong>
          <span class="metric-detail">${card.detail}</span>
        </article>
      `,
    )
    .join("");

  const warnings = [];
  if (overview.security.usingDefaultAdminPassword) {
    warnings.push("ADMIN_PASSWORD is still using the local default.");
  }
  if (overview.security.usingDefaultSessionSecret) {
    warnings.push("SESSION_SECRET is still using the local default.");
  }

  if (warnings.length) {
    ui.securityBanner.classList.remove("hidden");
    ui.securityBanner.textContent = `${warnings.join(" ")} Change both before deploying live.`;
  } else {
    ui.securityBanner.classList.add("hidden");
    ui.securityBanner.textContent = "";
  }
}

function renderSubmissions(submissions) {
  ui.submissionsMeta.textContent = `${submissions.length} loaded`;

  if (!submissions.length) {
    ui.submissionsList.innerHTML =
      '<div class="empty-state">No launch briefs yet. Public form submissions will appear here.</div>';
    return;
  }

  ui.submissionsList.innerHTML = submissions
    .map(
      (submission) => `
        <article class="submission-card" data-submission-id="${submission.id}">
          <div class="submission-header">
            <div>
              <h3 class="submission-title">${escapeHtml(submission.name)}</h3>
              <p class="submission-meta">
                <a href="mailto:${escapeHtml(submission.email)}">${escapeHtml(submission.email)}</a>
                ${submission.company ? ` · ${escapeHtml(submission.company)}` : ""}
              </p>
            </div>
            <span class="status-pill">${escapeHtml(submission.status)}</span>
          </div>

          <div class="submission-grid">
            <div class="meta-block">
              <span class="meta-label">Project type</span>
              <strong>${escapeHtml(submission.projectType)}</strong>
            </div>
            <div class="meta-block">
              <span class="meta-label">Timeline</span>
              <strong>${escapeHtml(submission.timeline)}</strong>
            </div>
            <div class="meta-block">
              <span class="meta-label">Budget</span>
              <strong>${escapeHtml(submission.budgetRange)}</strong>
            </div>
            <div class="meta-block">
              <span class="meta-label">Requested demo</span>
              <strong>${submission.wantsDemo ? "Yes" : "No"}</strong>
            </div>
            <div class="meta-block">
              <span class="meta-label">Submitted</span>
              <strong>${formatTime(submission.createdAt)}</strong>
            </div>
            <div class="meta-block">
              <span class="meta-label">IP address</span>
              <strong>${escapeHtml(submission.ipAddress || "Unavailable")}</strong>
            </div>
          </div>

          <p class="submission-copy">${escapeHtml(submission.message)}</p>

          <div class="submission-editor">
            <div class="submission-meta-row">
              <label class="field">
                <span>Status</span>
                <select data-field="status">
                  ${renderStatusOptions(submission.status)}
                </select>
              </label>
              <button class="button button-primary" type="button" data-action="save">
                Save Update
              </button>
            </div>

            <label class="field">
              <span>Admin notes</span>
              <textarea data-field="adminNotes">${escapeHtml(submission.adminNotes || "")}</textarea>
            </label>
          </div>
        </article>
      `,
    )
    .join("");
}

function renderStatusOptions(currentStatus) {
  return ["new", "reviewing", "contacted", "closed"]
    .map(
      (status) =>
        `<option value="${status}" ${status === currentStatus ? "selected" : ""}>${status}</option>`,
    )
    .join("");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function loadDashboard() {
  ui.refreshButton.disabled = true;

  try {
    const [overviewResponse, submissionsResponse] = await Promise.all([
      requestJson("/api/admin/overview", { headers: {} }),
      requestJson("/api/admin/submissions", { headers: {} }),
    ]);

    renderOverview(overviewResponse.overview);
    renderSubmissions(submissionsResponse.submissions);
  } catch (error) {
    ui.submissionsList.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  } finally {
    ui.refreshButton.disabled = false;
  }
}

async function handleLogin(event) {
  event.preventDefault();

  ui.loginButton.disabled = true;
  ui.loginMessage.textContent = "Signing in...";

  try {
    await requestJson("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({
        password: ui.passwordInput.value,
      }),
    });

    ui.passwordInput.value = "";
    ui.loginMessage.textContent = "";
    showDashboard();
    await loadDashboard();
  } catch (error) {
    ui.loginMessage.textContent = error.message;
  } finally {
    ui.loginButton.disabled = false;
  }
}

async function handleLogout() {
  ui.logoutButton.disabled = true;

  try {
    await requestJson("/api/admin/logout", {
      method: "POST",
      body: JSON.stringify({}),
    });
  } catch (error) {
    console.error(error);
  } finally {
    ui.logoutButton.disabled = false;
    showLogin();
  }
}

async function handleSubmissionSave(button) {
  const card = button.closest("[data-submission-id]");
  if (!card) {
    return;
  }

  const submissionId = card.getAttribute("data-submission-id");
  const status = card.querySelector('[data-field="status"]').value;
  const adminNotes = card.querySelector('[data-field="adminNotes"]').value;

  button.disabled = true;
  button.textContent = "Saving...";

  try {
    await requestJson(`/api/admin/submissions/${submissionId}`, {
      method: "PATCH",
      body: JSON.stringify({
        status,
        adminNotes,
      }),
    });

    await loadDashboard();
  } catch (error) {
    button.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "Save Update";
  }
}

ui.loginForm.addEventListener("submit", handleLogin);
ui.refreshButton.addEventListener("click", loadDashboard);
ui.logoutButton.addEventListener("click", handleLogout);

ui.submissionsList.addEventListener("click", (event) => {
  const button = event.target.closest('[data-action="save"]');
  if (!button) {
    return;
  }

  handleSubmissionSave(button);
});

checkSession();
