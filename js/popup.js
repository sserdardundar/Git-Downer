// Extension popup logic - Handles job monitoring and quick-actions.
(function () {
  "use strict";

  const ONBOARDING_KEY = "gsdOnboardingDismissed";

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    const repoOwner = document.getElementById("repoOwner");
    const repoName = document.getElementById("repoName");
    const downloadBtn = document.getElementById("downloadBtn");
    const settingsBtn = document.getElementById("settingsBtn");
    const copyUrlBtn = document.getElementById("copyUrlBtn");
    const copyBtnText = document.getElementById("copyBtnText");
    const context = document.getElementById("context");
    const jobsList = document.getElementById("jobsList");
    const popupRateCount = document.getElementById("popupRateCount");
    const popupRateReset = document.getElementById("popupRateReset");
    const popupRateBar = document.getElementById("popupRateBar");
    const popupRefreshRateBtn = document.getElementById("popupRefreshRateBtn");
    const onboardingCard = document.getElementById("onboardingCard");
    const dismissOnboardingBtn = document.getElementById("dismissOnboardingBtn");

    // Branch picker elements
    const branchRow = document.getElementById("branchRow");
    const branchPicker = document.getElementById("branchPicker");
    const branchTrigger = document.getElementById("branchTrigger");
    const branchTriggerName = document.getElementById("branchTriggerName");
    const branchPanel = document.getElementById("branchPanel");
    const branchSearch = document.getElementById("branchSearch");
    const branchList = document.getElementById("branchList");
    const branchPathWarning = document.getElementById("branchPathWarning");
    const branchPathWarningText = document.getElementById("branchPathWarningText");

    // Exclusions
    const exclusionsRow = document.getElementById("exclusionsRow");
    const exclPacksContainer = document.getElementById("exclPacks");
    const exclusionsManageLink = document.getElementById("exclusionsManageLink");

    // ── Branch picker state ────────────────────────────────────────────────────
    // API call budget per popup open:
    //   - 0 on popup open (lazy)
    //   - 2 on first trigger click (metadata + branches page 1)
    //   - +1 per extra pagination page if repo has >100 branches
    //   - +1 per unique {path, branch} combo checked (only when branch changes)

    let allBranches = [];       // [{name, isDefault}] — populated lazily on first open
    let defaultBranch = "";
    let selectedBranch = null;  // currently selected branch name
    let originalRef = null;     // branch from URL at popup open; path known to exist here
    let pathExistsOnBranch = true;
    let branchToken = "";
    let branchOwner = "";
    let branchRepo = "";
    let highlightedIndex = -1;
    let pathCheckTimer = null;
    let pickerOpen = false;
    let branchFetchPromise = null; // deduplicates concurrent fetch calls
    const pathCheckCache = new Map(); // "owner/repo/path/branch" → boolean

    // ── General state ──────────────────────────────────────────────────────────
    let currentTabUrl = "";
    let currentRepoInfo = null;
    let activeJobId = null;
    let activeExclusionPacks = [];
    let customExclusionPacks = [];

    const SHARED = window.GitHubSmartDownloaderShared;
    const BUILTIN_PACKS = SHARED?.EXCLUSION_PACKS || [];

    // ── Theme / accent ─────────────────────────────────────────────────────────
    chrome.storage.sync.get(
      { themeMode: "system", buttonColor: "#8b5cf6" },
      (settings) => {
        applyPopupTheme(settings.themeMode);
        document.documentElement.style.setProperty(
          "--gd-accent",
          settings.buttonColor || "#8b5cf6",
        );
      },
    );

    settingsBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());

    if (exclusionsManageLink) {
      exclusionsManageLink.addEventListener("click", (e) => {
        e.preventDefault();
        chrome.runtime.openOptionsPage();
      });
    }

    if (popupRefreshRateBtn) {
      popupRefreshRateBtn.addEventListener("click", () => refreshRateLimit());
    }

    initPopupOnboarding();

    copyUrlBtn.addEventListener("click", async () => {
      if (!currentTabUrl) return;
      try {
        await navigator.clipboard.writeText(currentTabUrl);
        copyBtnText.textContent = "Copied!";
        setTimeout(() => (copyBtnText.textContent = "Copy Repo URL"), 1500);
      } catch (e) {
        copyBtnText.textContent = "Failed to copy";
        setTimeout(() => (copyBtnText.textContent = "Copy Repo URL"), 1500);
      }
    });

    loadRateLimit();

    // ── Bootstrap: load exclusions then resolve tab ────────────────────────────
    chrome.storage.sync.get(
      { activeExclusionPacks: [], customExclusionPacks: [] },
      (stored) => {
        activeExclusionPacks = Array.isArray(stored.activeExclusionPacks)
          ? stored.activeExclusionPacks : [];
        customExclusionPacks = Array.isArray(stored.customExclusionPacks)
          ? stored.customExclusionPacks : [];

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const tab = tabs[0];
          if (!tab || !tab.url || !tab.url.includes("github.com")) {
            disableMainUI("Navigate to a GitHub repository", "Not on GitHub");
            return;
          }

          currentTabUrl = tab.url;
          const info = parseUrl(tab.url);
          if (!info) {
            disableMainUI("Open a repository page", "Invalid page");
            return;
          }

          currentRepoInfo = info;
          repoOwner.textContent = info.owner;
          repoName.textContent = info.repo;

          if (info.path) {
            context.textContent = "Directory: /" + info.path;
            downloadBtn.innerHTML = `
              <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
                <path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2c-.33-.44-.85-.7-1.4-.7H1.75Z"></path>
              </svg>
              Download Directory
            `;
          } else {
            context.textContent = "Full Repository";
          }

          downloadBtn.addEventListener("click", () => {
            downloadBtn.disabled = true;

            // If path is missing on the selected branch, download from root instead
            let downloadUrl = currentTabUrl;
            if (currentRepoInfo.path && !pathExistsOnBranch && selectedBranch) {
              downloadUrl = `https://github.com/${currentRepoInfo.owner}/${currentRepoInfo.repo}`;
            }

            const excludedPaths = resolveActiveExclusions();

            chrome.runtime.sendMessage(
              {
                action: "startDownload",
                url: downloadUrl,
                branchOverride: selectedBranch || undefined,
                excludedPaths: excludedPaths.length > 0 ? excludedPaths : undefined,
              },
              (response) => {
                if (response && response.jobId) activeJobId = response.jobId;
                updateJobsList();
                setTimeout(() => {
                  if (downloadBtn) downloadBtn.disabled = false;
                }, 2000);
              },
            );
          });

          if (branchRow) branchRow.style.display = "flex";
          initBranchPicker(info.owner, info.repo, info.ref || "HEAD");
          renderExclusionChips();
        });
      },
    );

    setInterval(updateJobsList, 1000);
    updateJobsList();

    // ── Branch picker — LAZY LOADING ───────────────────────────────────────────
    // initBranchPicker(): zero API calls — shows current branch from URL,
    //                     resolves the token (internal only), wires up events.
    // fetchBranches():    called only on first picker open — 2+ API calls.

    async function initBranchPicker(owner, repo, currentRef) {
      branchOwner = owner;
      branchRepo = repo;

      // Record the branch the user is currently viewing.
      // We know the path exists here, so no path check needed for this ref.
      originalRef = currentRef !== "HEAD" ? currentRef : null;

      // Resolve token (chrome.storage + internal crypto — no GitHub API call)
      try {
        const stored = await chrome.storage.sync.get({ githubToken: "" });
        if (stored.githubToken) {
          branchToken = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
              { action: "decryptToken", encryptedToken: stored.githubToken },
              (res) => res?.success ? resolve(res.token) : reject(new Error("decrypt")),
            );
          }).catch(() => "");
        }
      } catch (_) {}

      // Show known branch immediately — no API call required
      if (originalRef) {
        selectedBranch = originalRef;
        if (branchTriggerName) branchTriggerName.textContent = originalRef;
      } else {
        // On repo root the exact default branch requires a metadata call;
        // show a neutral label until the picker is opened.
        if (branchTriggerName) branchTriggerName.textContent = "default branch";
      }

      if (branchTrigger) branchTrigger.disabled = false;

      // Wire up events once
      branchTrigger?.addEventListener("click", togglePicker);

      document.addEventListener(
        "click",
        (e) => { if (!branchPicker?.contains(e.target)) closePicker(); },
        { capture: true },
      );

      branchSearch?.addEventListener("keydown", onSearchKeydown);
      branchSearch?.addEventListener("input", () => {
        highlightedIndex = -1;
        renderBranchList(branchSearch.value.trim());
      });
    }

    // Fetches metadata + branches from GitHub API.
    // Deduplicated: concurrent calls share the same promise.
    // Resets on error so the user can retry by opening the picker again.
    async function fetchBranches() {
      if (branchFetchPromise) return branchFetchPromise;

      branchFetchPromise = (async () => {
        const headers = {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        };
        if (branchToken) headers.Authorization = `token ${branchToken}`;

        // metadata + first page in parallel — 2 API calls
        const [metaResp, firstResp] = await Promise.all([
          fetch(`https://api.github.com/repos/${branchOwner}/${branchRepo}`, { headers }),
          fetch(
            `https://api.github.com/repos/${branchOwner}/${branchRepo}/branches?per_page=100&page=1`,
            { headers },
          ),
        ]);

        defaultBranch = "main";
        if (metaResp.ok) {
          const meta = await metaResp.json();
          defaultBranch = meta.default_branch || "main";
        }

        if (!firstResp.ok) throw new Error(`Status ${firstResp.status}`);
        let names = (await firstResp.json()).map((b) => b.name);

        // Paginate until page has < 100 results; cap at 10 pages (≤ 1 000 branches)
        if (names.length === 100) {
          let page = 2;
          while (page <= 10) {
            try {
              const r = await fetch(
                `https://api.github.com/repos/${branchOwner}/${branchRepo}/branches?per_page=100&page=${page}`,
                { headers },
              );
              if (!r.ok) break;
              const data = (await r.json()).map((b) => b.name);
              if (data.length === 0) break;
              names = [...names, ...data];
              if (data.length < 100) break;
              page++;
            } catch (_) { break; }
          }
        }

        // Build ordered list: default branch first, rest alphabetically
        const others = names.filter((n) => n !== defaultBranch).sort((a, b) => a.localeCompare(b));
        const ordered = [defaultBranch, ...others];

        // Ensure the target ref is always present
        const target = selectedBranch || defaultBranch;
        if (!ordered.includes(target)) ordered.unshift(target);

        allBranches = ordered.map((name) => ({ name, isDefault: name === defaultBranch }));

        // If we didn't know the default branch until now, update selection + trigger
        if (!selectedBranch) {
          selectedBranch = defaultBranch;
          if (branchTriggerName) branchTriggerName.textContent = defaultBranch;
        }
      })();

      // Allow retry on failure
      branchFetchPromise = branchFetchPromise.catch((e) => {
        branchFetchPromise = null;
        throw e;
      });

      return branchFetchPromise;
    }

    // ── Picker open / close ────────────────────────────────────────────────────

    function togglePicker() {
      if (pickerOpen) closePicker();
      else openPicker();
    }

    async function openPicker() {
      if (!branchPanel) return;
      pickerOpen = true;
      branchPanel.hidden = false;
      branchTrigger?.setAttribute("aria-expanded", "true");
      highlightedIndex = -1;
      if (branchSearch) { branchSearch.value = ""; branchSearch.focus(); }

      // First open: fetch branches, show loading state in the meantime
      if (allBranches.length === 0) {
        if (branchList) {
          branchList.innerHTML = '<li class="branch-no-results">Loading branches…</li>';
        }
        try {
          await fetchBranches();
        } catch (_) {
          if (branchList) {
            branchList.innerHTML = '<li class="branch-no-results">Could not load branches</li>';
          }
          return;
        }
      }

      renderBranchList("");
      // Scroll currently selected item into view
      setTimeout(() => {
        branchList?.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
      }, 0);
    }

    function closePicker() {
      if (!branchPanel) return;
      pickerOpen = false;
      branchPanel.hidden = true;
      branchTrigger?.setAttribute("aria-expanded", "false");
      highlightedIndex = -1;
    }

    // ── Branch list rendering ──────────────────────────────────────────────────

    function renderBranchList(query) {
      if (!branchList) return;
      const q = query.toLowerCase();
      const filtered = q
        ? allBranches.filter((b) => b.name.toLowerCase().includes(q))
        : allBranches;

      branchList.innerHTML = "";

      if (filtered.length === 0) {
        branchList.innerHTML = '<li class="branch-no-results">No branches match</li>';
        highlightedIndex = -1;
        return;
      }

      filtered.forEach((branch, idx) => {
        const li = document.createElement("li");
        li.className =
          "branch-list-item" +
          (branch.name === selectedBranch ? " selected" : "") +
          (idx === highlightedIndex ? " hl" : "");
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", branch.name === selectedBranch);
        li.dataset.name = branch.name;

        li.innerHTML = `
          <svg class="branch-item-check" viewBox="0 0 16 16" width="12" height="12"
               fill="currentColor" aria-hidden="true"
               style="visibility:${branch.name === selectedBranch ? "visible" : "hidden"}">
            <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.749.749 0 1 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/>
          </svg>
          <span class="branch-item-name">${escapeHtml(branch.name)}</span>
          ${branch.isDefault ? '<span class="branch-default-tag">default</span>' : ""}
        `;

        li.addEventListener("click", () => { selectBranch(branch.name); closePicker(); });
        li.addEventListener("mouseenter", () => {
          highlightedIndex = idx;
          updateHighlight();
        });

        branchList.appendChild(li);
      });
    }

    function updateHighlight() {
      branchList?.querySelectorAll(".branch-list-item").forEach((el, i) => {
        el.classList.toggle("hl", i === highlightedIndex);
      });
    }

    function scrollHighlightedIntoView() {
      const items = branchList?.querySelectorAll(".branch-list-item");
      if (items && highlightedIndex >= 0 && highlightedIndex < items.length) {
        items[highlightedIndex].scrollIntoView({ block: "nearest" });
      }
    }

    function onSearchKeydown(e) {
      const items = branchList?.querySelectorAll(".branch-list-item");
      const count = items?.length || 0;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        highlightedIndex = Math.min(highlightedIndex + 1, count - 1);
        updateHighlight();
        scrollHighlightedIntoView();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        // Only move up if already inside the list; don't snap to item 0
        // from the "nothing highlighted" state (-1) — that should be ArrowDown's job.
        if (highlightedIndex > 0) {
          highlightedIndex--;
          updateHighlight();
          scrollHighlightedIntoView();
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (highlightedIndex >= 0 && items?.[highlightedIndex]) {
          const name = items[highlightedIndex].dataset.name;
          if (name) { selectBranch(name); closePicker(); }
        } else if (count === 1 && items?.[0]) {
          const name = items[0].dataset.name;
          if (name) { selectBranch(name); closePicker(); }
        }
      } else if (e.key === "Escape") {
        closePicker();
        branchTrigger?.focus();
      }
    }

    // ── Branch selection + path check ─────────────────────────────────────────

    function selectBranch(name) {
      selectedBranch = name;
      if (branchTriggerName) branchTriggerName.textContent = name;

      if (branchPathWarning) branchPathWarning.hidden = true;
      pathExistsOnBranch = true;

      // Only check path when branch actually changes from the one we started on.
      // originalRef is known to exist (user is currently viewing it), so skip it.
      if (currentRepoInfo?.path && name !== originalRef) {
        schedulePathCheck(name);
      }
    }

    function schedulePathCheck(branch) {
      if (pathCheckTimer) clearTimeout(pathCheckTimer);
      pathCheckTimer = setTimeout(() => checkPathOnBranch(branch), 400);
    }

    async function checkPathOnBranch(branch) {
      const path = currentRepoInfo?.path;
      if (!path) return;

      // Check in-memory cache first (populated within this popup session)
      const cacheKey = `${branchOwner}/${branchRepo}/${path}/${branch}`;
      if (pathCheckCache.has(cacheKey)) {
        const exists = pathCheckCache.get(cacheKey);
        applyPathCheckResult(branch, path, exists);
        return;
      }

      // 1 API call — GET /repos/:owner/:repo/contents/:path?ref=:branch
      // Each path segment must be encoded individually; encodeURIComponent on the
      // whole path would encode "/" to "%2F" which GitHub rejects.
      const encodedPath = path.split("/").map(encodeURIComponent).join("/");
      const headers = {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      };
      if (branchToken) headers.Authorization = `token ${branchToken}`;

      try {
        const resp = await fetch(
          `https://api.github.com/repos/${branchOwner}/${branchRepo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`,
          { headers },
        );
        const exists = resp.status !== 404;
        pathCheckCache.set(cacheKey, exists);
        applyPathCheckResult(branch, path, exists);
      } catch (_) {
        // Network error — optimistically assume path exists
        pathExistsOnBranch = true;
        if (branchPathWarning) branchPathWarning.hidden = true;
      }
    }

    function applyPathCheckResult(branch, path, exists) {
      // Guard: user may have switched branches again while request was in flight
      if (selectedBranch !== branch) return;

      pathExistsOnBranch = exists;
      if (!exists && branchPathWarning && branchPathWarningText) {
        branchPathWarningText.textContent =
          `"${path}" not found on "${branch}" — will download from root`;
        branchPathWarning.hidden = false;
      } else if (branchPathWarning) {
        branchPathWarning.hidden = true;
      }
    }

    // ── Exclusion chips ────────────────────────────────────────────────────────

    function resolveActiveExclusions() {
      if (!SHARED?.resolveExcludedPaths) return [];
      return SHARED.resolveExcludedPaths(activeExclusionPacks, customExclusionPacks);
    }

    function renderExclusionChips() {
      if (!exclusionsRow || !exclPacksContainer) return;

      const allPacks = [...BUILTIN_PACKS, ...customExclusionPacks];
      const activePacks = allPacks.filter((p) => activeExclusionPacks.includes(p.id));

      exclusionsRow.style.display = "block";
      exclPacksContainer.innerHTML = "";

      if (activePacks.length === 0) {
        exclPacksContainer.innerHTML = '<span class="excl-none">None active</span>';
        return;
      }

      activePacks.forEach((pack) => {
        const chip = document.createElement("button");
        chip.className = "excl-chip active";
        chip.title = pack.paths.join(", ");
        chip.innerHTML = `${escapeHtml(pack.label)} <span class="excl-chip-x">✕</span>`;
        chip.addEventListener("click", () => {
          activeExclusionPacks = activeExclusionPacks.filter((id) => id !== pack.id);
          chrome.storage.sync.set({ activeExclusionPacks });
          renderExclusionChips();
        });
        exclPacksContainer.appendChild(chip);
      });
    }

    // ── Onboarding ─────────────────────────────────────────────────────────────

    function initPopupOnboarding() {
      if (!onboardingCard || !dismissOnboardingBtn) return;

      chrome.storage.local.get(
        { [ONBOARDING_KEY]: false, gsdPopupOnboardingDismissed: false },
        (result) => {
          const dismissed = result[ONBOARDING_KEY] || result.gsdPopupOnboardingDismissed;
          onboardingCard.hidden = Boolean(dismissed);
        },
      );

      dismissOnboardingBtn.addEventListener("click", () => {
        onboardingCard.hidden = true;
        chrome.storage.local.set({ [ONBOARDING_KEY]: true });
      });
    }

    // ── Active jobs list ───────────────────────────────────────────────────────

    function updateJobsList() {
      chrome.runtime.sendMessage({ action: "getAllJobs" }, (response) => {
        if (!response || !response.success || !response.jobs) return;
        renderJobs(response.jobs);
      });
    }

    function renderJobs(jobs) {
      if (jobs.length === 0) {
        jobsList.innerHTML = '<div class="no-jobs">No active downloads</div>';
        return;
      }

      const sortedJobs = jobs.sort((a, b) => b.id.localeCompare(a.id));

      jobsList.innerHTML = sortedJobs
        .map((job) => {
          const state = job.state || {};
          const progress = state.progress || 0;
          const name =
            job.filename ||
            (job.repoInfo ? `${job.repoInfo.owner}/${job.repoInfo.repo}` : "Repository Archive");
          const statusMsg = state.message || "Processing...";
          const metaMsg = getSizeMeta(state);

          return `
          <div class="job-card" id="job-${job.id}">
            <div class="job-top">
              <div class="job-main">
                <span class="job-title" title="${name}">${name}</span>
                <div class="job-msg">${statusMsg}</div>
              </div>
              ${
                state.status !== "idle" &&
                state.status !== "complete" &&
                state.status !== "error"
                  ? `<button class="job-cancel-btn" data-id="${job.id}">Cancel</button>`
                  : ""
              }
            </div>
            <div class="job-progress-container">
              <div class="job-progress-fill" style="width: ${progress}%"></div>
            </div>
            <div class="job-meta">
              <span>${progress}%</span>
              <span>${metaMsg}</span>
            </div>
          </div>
        `;
        })
        .join("");

      jobsList.querySelectorAll(".job-cancel-btn").forEach((btn) => {
        btn.onclick = () => {
          const jobId = btn.dataset.id;
          btn.disabled = true;
          btn.textContent = "...";
          chrome.runtime.sendMessage({ action: "cancelDownload", jobId }, () => {
            updateJobsList();
          });
        };
      });
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    function disableMainUI(msg, name) {
      repoOwner.textContent = "-";
      repoName.textContent = name;
      if (downloadBtn) downloadBtn.disabled = true;
      if (copyUrlBtn) copyUrlBtn.disabled = true;
      context.textContent = msg;
    }

    function parseUrl(url) { return SHARED?.parseGitHubUrl(url) || null; }

    function applyPopupTheme(themeMode) {
      if (themeMode === "light" || themeMode === "dark") {
        document.documentElement.dataset.theme = themeMode;
      } else {
        delete document.documentElement.dataset.theme;
      }
    }

    function getSizeMeta(details) {
      const downloaded = Number(details.bytesDownloaded) || 0;
      const estimated = Number(details.estimatedBytes) || 0;
      if (downloaded > 0 && estimated > 0)
        return `${formatBytes(downloaded)} / ${formatBytes(estimated)}`;
      if (downloaded > 0) return `Downloaded: ${formatBytes(downloaded)}`;
      if (estimated > 0) return `~${formatBytes(estimated)}`;
      return "";
    }

    function formatBytes(bytes) { return SHARED?.formatBytes(bytes) || ""; }

    function escapeHtml(str) {
      if (!str) return "";
      return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    // ── Rate limit ─────────────────────────────────────────────────────────────

    function loadRateLimit() {
      chrome.storage.local.get({ rateLimit: null }, (result) => {
        renderRateLimit(result.rateLimit || { limit: 60, remaining: 60, reset: 0 });
        refreshRateLimit();
      });
    }

    function refreshRateLimit() {
      if (!popupRefreshRateBtn) return;
      popupRefreshRateBtn.disabled = true;
      chrome.runtime.sendMessage({ action: "refreshRateLimit" }, (response) => {
        popupRefreshRateBtn.disabled = false;
        if (response?.success) renderRateLimit(response.rateLimit);
      });
    }

    function renderRateLimit(rateLimit) {
      if (!popupRateCount || !popupRateReset || !popupRateBar) return;
      const data = rateLimit || { limit: 60, remaining: 60, reset: 0 };
      const percent = SHARED?.getRateLimitPercent(data) || 0;

      popupRateCount.textContent = `${data.remaining}/${data.limit}`;
      if (data.tokenError) {
        popupRateReset.textContent = data.tokenError;
        popupRateReset.style.color = "var(--gd-danger)";
      } else if (data.hasToken && data.tokenValid) {
        popupRateReset.textContent = `Token valid • resets ${SHARED?.formatRateLimitReset(data.reset)}`;
        popupRateReset.style.color = "var(--gd-success)";
      } else {
        popupRateReset.textContent = data.reset
          ? `resets ${SHARED?.formatRateLimitReset(data.reset)}`
          : "standard limit";
        popupRateReset.style.color = "";
      }

      popupRateBar.style.width = `${percent}%`;
      popupRateBar.style.background =
        percent < 20 ? "var(--gd-danger)" : percent < 50 ? "#bf8700" : "var(--gd-accent)";
    }
  }
})();
