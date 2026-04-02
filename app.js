const ArchiveViewer = (() => {
  const state = {
    manifest: [],
    manifestIds: new Set(),
    repliesByParentId: new Map(),
    selectedId: null,
    query: "",
    activeFilter: "all",
    page: 1,
    account: "",
    accounts: [],
    accountSuggestions: [],
    activeAccountIndex: -1,
    dateFrom: "",
    dateTo: "",
  };
  const lightbox = {
    host: null,
    preview: null,
    activeSrc: "",
  };
  const PAGE_SIZE = 25;
  const FILTERS = [
    { id: "all", label: "All", predicate: () => true },
    { id: "media", label: "Media", predicate: (tweet) => (tweet.media_count || 0) > 0 },
    { id: "video", label: "Video", predicate: (tweet) => Boolean(tweet.has_video) },
    { id: "managed", label: "Imported", predicate: (tweet) => tweet.source_kind === "managed" },
  ];

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function decodeHtmlEntities(value) {
    const input = String(value ?? "");
    if (!input.includes("&")) {
      return input;
    }

    const textarea = document.createElement("textarea");
    textarea.innerHTML = input;
    return textarea.value.replace(/\u00a0/g, " ");
  }

  function normalizeUrl(rawUrl) {
    if (!rawUrl) {
      return "";
    }

    if (/^https?:\/\//i.test(rawUrl)) {
      return rawUrl;
    }

    if (/^www\./i.test(rawUrl)) {
      return `https://${rawUrl}`;
    }

    return rawUrl;
  }

  function trimUrlMatch(rawMatch) {
    const match = String(rawMatch ?? "");
    const trimmed = match.match(/^(.*?)([),.!?:;"']*)$/);

    if (!trimmed) {
      return { url: match, trailing: "" };
    }

    return {
      url: trimmed[1],
      trailing: trimmed[2],
    };
  }

  function formatTweetText(text, externalLinks = []) {
    const decodedText = decodeHtmlEntities(text);
    const pendingLinks = [...externalLinks];
    const urlPattern = /(?:https?:\/\/|www\.)[^\s<]+/gi;

    return decodedText
      .split("\n")
      .map((line) => {
        urlPattern.lastIndex = 0;
        let cursor = 0;
        let formatted = "";
        let match;

        while ((match = urlPattern.exec(line)) !== null) {
          const matchedText = match[0];
          const { url, trailing } = trimUrlMatch(matchedText);

          formatted += escapeHtml(line.slice(cursor, match.index));

          if (!url) {
            formatted += escapeHtml(matchedText);
            cursor = match.index + matchedText.length;
            continue;
          }

          const fallbackUrl = normalizeUrl(url);
          const nextExternalLink = pendingLinks[0];
          const shouldExpandTco = /^https?:\/\/t\.co\//i.test(fallbackUrl) && nextExternalLink;
          const href = shouldExpandTco ? nextExternalLink.expanded_url : fallbackUrl;
          const label = shouldExpandTco
            ? (nextExternalLink.title || nextExternalLink.display_url || nextExternalLink.expanded_url)
            : url;

          if (shouldExpandTco) {
            pendingLinks.shift();
          }

          formatted += `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
          formatted += escapeHtml(trailing);
          cursor = match.index + matchedText.length;
        }

        formatted += escapeHtml(line.slice(cursor));
        return formatted;
      })
      .join("<br>");
  }

  function isLikelyIncompleteText(text) {
    const value = decodeHtmlEntities(text).trim();
    if (!value) {
      return false;
    }

    const endsWithEllipsis = /(?:…|\.\.\.)$/.test(value);
    const looksLikeManualRetweet = /^RT\s+@\w+:/i.test(value);
    const clippedMidWord = /\b[^\s]+\u2026$/.test(value);
    const clippedAfterQuote = /["'”]\s*$/.test(value) && value.includes("…");

    return endsWithEllipsis && (looksLikeManualRetweet || clippedMidWord || clippedAfterQuote);
  }

  function renderIncompleteTextNotice(tweet, compact = false) {
    if (!isLikelyIncompleteText(tweet.text || "")) {
      return "";
    }

    const className = compact ? "capture-note capture-note--compact" : "capture-note capture-note--banner";
    const label = compact ? "Captured text may be incomplete" : "Captured text may be incomplete";
    const body = compact
      ? ""
      : '<p class="capture-note-copy">This looks like truncated source text from the archive, not a viewer rendering problem.</p>';

    return `
      <section class="${className}">
        <strong>${label}</strong>
        ${body}
      </section>
    `;
  }

  function getParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  function getPageParam() {
    const raw = Number.parseInt(getParam("page") || "1", 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 1;
  }

  function archiveBaseUrl() {
    const current = new URL(window.location.href);
    const archivePath = current.pathname.replace(/\/tweet\.html$/, "/index.html");
    return new URL(archivePath || "index.html", current);
  }

  function archiveUrlForAccount(account, tweetId = "", page = state.page) {
    const url = archiveBaseUrl();
    const normalizedAccount = normalizeAccountInput(account, true);

    if (normalizedAccount) {
      url.searchParams.set("account", normalizedAccount);
    } else {
      url.searchParams.delete("account");
    }

    if (tweetId) {
      url.searchParams.set("tweet_id", tweetId);
    } else {
      url.searchParams.delete("tweet_id");
    }

    if (page > 1) {
      url.searchParams.set("page", String(page));
    } else {
      url.searchParams.delete("page");
    }

    return url.toString();
  }

  function syncArchiveUrl(tweetId = state.selectedId) {
    if ((document.body.dataset.mode || "archive") !== "archive") {
      return;
    }

    window.history.replaceState({}, "", archiveUrlForAccount(state.account, tweetId, state.page));
  }

  function scrollArchiveResultsToTop() {
    const timeline = document.getElementById("tweet-list");
    if (timeline) {
      timeline.scrollTo({ top: 0, behavior: "auto" });
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function localAssetPath(assetPath) {
    if (!assetPath) {
      return "";
    }

    if (/^https?:\/\//.test(assetPath)) {
      return assetPath;
    }

    return `downloads/${assetPath.replace(/^\/+/, "")}`;
  }

  function sourceCandidates(item, kind) {
    const candidates = [];

    if (kind === "avatar") {
      if (item.profile_image_s3) {
        candidates.push(localAssetPath(item.profile_image_s3));
      }
      if (item.profile_image_url) {
        candidates.push(item.profile_image_url);
      }
      return candidates.filter(Boolean);
    }

    if (item.s3_url) {
      if (item.s3_url.includes("/")) {
        candidates.push(localAssetPath(item.s3_url));
      } else {
        candidates.push(localAssetPath(`liked_media/${item.s3_url}`));
        candidates.push(localAssetPath(item.s3_url));
      }
    }

    if (item.url) {
      candidates.push(item.url);
    }

    return candidates.filter(Boolean);
  }

  function encodedFallbacks(candidates) {
    return escapeHtml(JSON.stringify(candidates.slice(1)));
  }

  function formatTimestamp(timestamp) {
    if (!timestamp) {
      return "";
    }

    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) {
      return timestamp;
    }

    return parsed.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  function formatShortDate(timestamp) {
    if (!timestamp) {
      return "";
    }

    const parsed = new Date(timestamp);
    if (Number.isNaN(parsed.getTime())) {
      return timestamp;
    }

    return parsed.toLocaleDateString(undefined, {
      dateStyle: "medium",
    });
  }

  function normalizeTweetId(value) {
    const normalized = String(value ?? "").trim();
    return normalized && normalized !== "None" && normalized !== "null" ? normalized : "";
  }

  function getReplyTarget(tweet) {
    const id = normalizeTweetId(tweet?.in_reply_to_status_id || tweet?.in_reply_to_status_id_str);
    const username = String(tweet?.in_reply_to_screen_name || "").trim().replace(/^@+/, "");
    const userId = normalizeTweetId(tweet?.in_reply_to_user_id || tweet?.in_reply_to_user_id_str);

    if (!id && !username && !userId) {
      return null;
    }

    return { id, username, userId };
  }

  function hasLocalTweet(tweetId) {
    return Boolean(tweetId) && state.manifestIds.has(tweetId);
  }

  function buildReplyIndex(tweets) {
    const repliesByParentId = new Map();

    tweets.forEach((tweet) => {
      const replyTarget = getReplyTarget(tweet);
      if (!replyTarget?.id) {
        return;
      }

      const bucket = repliesByParentId.get(replyTarget.id) || [];
      bucket.push(tweet);
      repliesByParentId.set(replyTarget.id, bucket);
    });

    return repliesByParentId;
  }

  function localRepliesFor(tweetId) {
    return state.repliesByParentId.get(normalizeTweetId(tweetId)) || [];
  }

  function directTweetUrl(tweetId, username = "") {
    const normalizedId = normalizeTweetId(tweetId);
    const normalizedUser = String(username || "").trim().replace(/^@+/, "");

    if (!normalizedId) {
      return normalizedUser ? `https://twitter.com/${normalizedUser}` : "#";
    }

    if (normalizedUser) {
      return `https://twitter.com/${normalizedUser}/status/${normalizedId}`;
    }

    return `https://twitter.com/i/web/status/${normalizedId}`;
  }

  function localTweetUrl(tweetId, username = "") {
    const normalizedId = normalizeTweetId(tweetId);
    if (!normalizedId) {
      return "#";
    }

    if (document.body.dataset.mode === "single") {
      return `tweet.html?tweet_id=${encodeURIComponent(normalizedId)}`;
    }

    return archiveUrlForAccount(username, normalizedId);
  }

  function renderReplyContext(tweet) {
    const replyTarget = getReplyTarget(tweet);
    if (!replyTarget) {
      return "";
    }

    const { id, username, userId } = replyTarget;
    const hasLocalParent = hasLocalTweet(id);
    const localUrl = hasLocalParent ? localTweetUrl(id, username) : "";
    const originalUrl = directTweetUrl(id, username);
    const targetLabel = username ? `@${escapeHtml(username)}` : "unknown account";
    const idLabel = id ? escapeHtml(id) : "unknown tweet id";
    const userIdLine = userId ? `<li>User id: ${escapeHtml(userId)}</li>` : "";

    return `
      <section class="meta-block">
        <h3>Thread</h3>
        <ul class="meta-list">
          <li>In reply to ${targetLabel}</li>
          <li>Parent tweet id: ${idLabel}</li>
          ${userIdLine}
          <li>
            ${hasLocalParent
              ? `<a href="${escapeHtml(localUrl)}">Open parent in archive</a>`
              : "Parent tweet is not in the local archive"}
          </li>
          ${id ? `<li><a href="${escapeHtml(originalUrl)}" target="_blank" rel="noreferrer">Open parent on Twitter</a></li>` : ""}
        </ul>
      </section>
    `;
  }

  function renderTimelineReplyHint(tweet) {
    const replyTarget = getReplyTarget(tweet);
    if (!replyTarget?.id) {
      return "";
    }

    const handle = replyTarget.username ? `@${escapeHtml(replyTarget.username)}` : "archived parent";
    const localUrl = localTweetUrl(replyTarget.id, replyTarget.username);
    const localLabel = hasLocalTweet(replyTarget.id) ? "Open parent in archive" : "Open parent lookup";

    return `
      <div class="timeline-thread-hint">
        <span class="timeline-thread-label">Reply to ${handle}</span>
        <a class="timeline-thread-link" href="${escapeHtml(localUrl)}">${localLabel}</a>
      </div>
    `;
  }

  function renderTimelineChildReplies(tweet) {
    const replies = localRepliesFor(tweet.id);
    if (!replies.length) {
      return "";
    }

    const links = replies
      .slice(0, 3)
      .map((reply) => {
        const author = reply.author || {};
        const label = author.username ? `@${escapeHtml(author.username)}` : escapeHtml(String(reply.id));
        return `<a class="timeline-thread-link" href="${escapeHtml(localTweetUrl(reply.id, author.username || ""))}">${label}</a>`;
      })
      .join("");
    const remainder = replies.length > 3
      ? `<span class="timeline-thread-more">+${replies.length - 3} more</span>`
      : "";

    return `
      <div class="timeline-thread-hint timeline-thread-hint--children">
        <span class="timeline-thread-label">Replies in archive</span>
        <span class="timeline-thread-links">${links}${remainder}</span>
      </div>
    `;
  }

  function currentFilter() {
    return FILTERS.find((filter) => filter.id === state.activeFilter) || FILTERS[0];
  }

  function filteredTweets() {
    const normalized = state.query.trim().toLowerCase();
    const filter = currentFilter();

    return state.manifest.filter((tweet) => {
      if (!filter.predicate(tweet)) {
        return false;
      }

      if (!normalized) {
        // continue to structured filters
      } else {
        const haystack = [
          tweet.id,
          tweet.text,
          tweet.author?.username,
          tweet.author?.display_name,
        ]
          .join(" ")
          .toLowerCase();

        if (!haystack.includes(normalized)) {
          return false;
        }
      }

      if (state.account && tweet.author?.username !== state.account) {
        return false;
      }

      const tweetDate = (tweet.timestamp || "").slice(0, 10);
      if (state.dateFrom && tweetDate && tweetDate < state.dateFrom) {
        return false;
      }
      if (state.dateTo && tweetDate && tweetDate > state.dateTo) {
        return false;
      }

      return true;
    });
  }

  function populateAccountFilter() {
    const input = document.getElementById("account-filter");
    const options = document.getElementById("account-filter-options");
    if (!input || !options) {
      return;
    }

    state.accounts = [...new Set(
      state.manifest
        .map((tweet) => tweet.author?.username)
        .filter(Boolean),
    )].sort((a, b) => a.localeCompare(b));

    state.account = normalizeAccountInput(state.account);
    input.value = state.account;
    renderAccountSuggestions(state.account);
  }

  function normalizeAccountInput(rawValue, allowUnknown = false) {
    const normalized = String(rawValue ?? "").trim().replace(/^@+/, "");

    if (!normalized) {
      return "";
    }

    if (allowUnknown || !state.accounts.length) {
      return normalized;
    }

    return state.accounts.find((account) => account.toLowerCase() === normalized.toLowerCase()) || "";
  }

  function syncAccountFilterInput() {
    const accountFilter = document.getElementById("account-filter");
    if (accountFilter) {
      accountFilter.value = state.account;
    }
  }

  function filteredAccounts(rawValue) {
    const normalized = String(rawValue ?? "").trim().replace(/^@+/, "").toLowerCase();
    if (!normalized) {
      return state.accounts;
    }

    return state.accounts.filter((account) => account.toLowerCase().includes(normalized));
  }

  function closeAccountSuggestions() {
    const options = document.getElementById("account-filter-options");
    const input = document.getElementById("account-filter");
    state.activeAccountIndex = -1;
    if (options) {
      options.classList.remove("is-open");
      options.innerHTML = "";
    }
    if (input) {
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
    }
  }

  function renderAccountSuggestions(rawValue) {
    const options = document.getElementById("account-filter-options");
    const input = document.getElementById("account-filter");
    if (!options || !input) {
      return;
    }

    state.accountSuggestions = filteredAccounts(rawValue).slice(0, 12);
    state.activeAccountIndex = -1;

    if (!document.activeElement || document.activeElement !== input) {
      closeAccountSuggestions();
      return;
    }

    if (!state.accountSuggestions.length) {
      options.innerHTML = '<div class="combo-filter-empty">No matching accounts</div>';
      options.classList.add("is-open");
      input.setAttribute("aria-expanded", "true");
      return;
    }

    options.innerHTML = state.accountSuggestions
      .map((account, index) => `
        <button
          id="account-option-${index}"
          class="combo-filter-option"
          data-account="${escapeHtml(account)}"
          data-index="${index}"
          role="option"
          type="button"
        >
          @${escapeHtml(account)}
        </button>
      `)
      .join("");

    options.classList.add("is-open");
    input.setAttribute("aria-expanded", "true");

    options.querySelectorAll(".combo-filter-option").forEach((button) => {
      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
        state.account = button.dataset.account || "";
        syncAccountFilterInput();
        closeAccountSuggestions();
        applyFilters();
      });
    });
  }

  function updateActiveAccountSuggestion(index) {
    const input = document.getElementById("account-filter");
    const options = document.getElementById("account-filter-options");
    if (!input || !options) {
      return;
    }

    state.activeAccountIndex = index;
    options.querySelectorAll(".combo-filter-option").forEach((button) => {
      const isActive = Number(button.dataset.index) === index;
      button.classList.toggle("is-active", isActive);
      if (isActive) {
        input.setAttribute("aria-activedescendant", button.id);
        button.scrollIntoView({ block: "nearest" });
      }
    });

    if (index < 0) {
      input.removeAttribute("aria-activedescendant");
    }
  }

  function renderArchiveSummary() {
    const summary = document.getElementById("archive-summary");
    if (!summary) {
      return;
    }

    const activeAccountProfile = state.account
      ? state.manifest.find((tweet) => tweet.author?.username === state.account)?.author || null
      : null;
    const total = state.manifest.length;
    const withMedia = state.manifest.filter((tweet) => (tweet.media_count || 0) > 0).length;
    const withVideo = state.manifest.filter((tweet) => tweet.has_video).length;
    const imported = state.manifest.filter((tweet) => tweet.source_kind === "managed").length;
    const avatarCandidates = activeAccountProfile ? sourceCandidates(activeAccountProfile, "avatar") : [];
    const avatarSrc = avatarCandidates[0];
    const accountSummary = activeAccountProfile ? `
      <section class="account-summary-card">
        <div class="account-summary-header">
          ${avatarSrc ? `<img class="account-summary-avatar" src="${escapeHtml(avatarSrc)}" alt="" data-fallbacks="${encodedFallbacks(avatarCandidates)}">` : '<div class="account-summary-avatar account-summary-avatar--placeholder"></div>'}
          <div class="account-summary-copy">
            <div class="account-summary-name-row">
              <strong>${escapeHtml(activeAccountProfile.display_name || activeAccountProfile.username || state.account)}</strong>
              ${activeAccountProfile.verified ? '<span class="verified-badge">Verified</span>' : ""}
            </div>
            <div class="account-summary-handle">@${escapeHtml(activeAccountProfile.username || state.account)}</div>
          </div>
        </div>
        ${activeAccountProfile.description ? `<p class="account-summary-description">${escapeHtml(activeAccountProfile.description)}</p>` : ""}
      </section>
    ` : "";

    summary.innerHTML = `
      ${accountSummary}
      <div class="summary-card">
        <span class="summary-value">${total}</span>
        <span class="summary-label">Loaded</span>
      </div>
      <div class="summary-card">
        <span class="summary-value">${withMedia}</span>
        <span class="summary-label">With media</span>
      </div>
      <div class="summary-card">
        <span class="summary-value">${withVideo}</span>
        <span class="summary-label">Video</span>
      </div>
      <div class="summary-card">
        <span class="summary-value">${imported}</span>
        <span class="summary-label">Imported</span>
      </div>
    `;

    activateFallbacks(summary);
  }

  function renderFilterChips() {
    const host = document.getElementById("filter-chips");
    if (!host) {
      return;
    }

    host.innerHTML = FILTERS.map((filter) => `
      <button
        class="filter-chip ${filter.id === state.activeFilter ? "is-active" : ""}"
        data-filter-id="${filter.id}"
        type="button"
      >
        ${escapeHtml(filter.label)}
      </button>
    `).join("");

    host.querySelectorAll(".filter-chip").forEach((button) => {
      button.addEventListener("click", () => {
        state.activeFilter = button.dataset.filterId;
        state.page = 1;
        applyFilters();
      });
    });
  }

  function pageCount(totalTweets) {
    return Math.max(1, Math.ceil(totalTweets / PAGE_SIZE));
  }

  function clampPage(page, totalTweets) {
    return Math.min(Math.max(page, 1), pageCount(totalTweets));
  }

  function currentPageSlice(tweets) {
    const safePage = clampPage(state.page, tweets.length);
    if (safePage !== state.page) {
      state.page = safePage;
    }

    const start = tweets.length ? (safePage - 1) * PAGE_SIZE : 0;
    const end = Math.min(start + PAGE_SIZE, tweets.length);

    return {
      pageTweets: tweets.slice(start, end),
      start,
      end,
      total: tweets.length,
      page: safePage,
      pages: pageCount(tweets.length),
      newestTimestamp: tweets[0]?.timestamp || "",
    };
  }

  function renderResultsMeta(view) {
    const meta = document.getElementById("results-meta");
    if (!meta) {
      return;
    }

    const filterLabel = currentFilter().label;
    const selectionDate = view.total ? formatShortDate(view.newestTimestamp) : "";
    const accountLabel = state.account ? ` · @${state.account}` : "";
    const dateLabel = state.dateFrom || state.dateTo
      ? ` · ${state.dateFrom || "start"} to ${state.dateTo || "now"}`
      : "";
    meta.textContent = view.total
      ? `${filterLabel} · ${view.total} result${view.total === 1 ? "" : "s"}${accountLabel}${dateLabel}${selectionDate ? ` · newest ${selectionDate}` : ""}`
      : "No tweets match the current filters";
  }

  function renderPaginationControls(view) {
    const host = document.getElementById("pagination-controls");
    if (!host) {
      return;
    }

    if (!view.total) {
      host.innerHTML = "";
      return;
    }

    const previousDisabled = view.page <= 1 ? "disabled" : "";
    const nextDisabled = view.page >= view.pages ? "disabled" : "";

    host.innerHTML = `
      <span class="pagination-range">${view.start + 1}-${view.end} of ${view.total}</span>
      <button class="pagination-button" type="button" data-page-direction="prev" ${previousDisabled} aria-label="Previous page">‹</button>
      <button class="pagination-button" type="button" data-page-direction="next" ${nextDisabled} aria-label="Next page">›</button>
    `;

    host.querySelectorAll("[data-page-direction]").forEach((button) => {
      button.addEventListener("click", () => {
        const nextPage = button.dataset.pageDirection === "prev" ? state.page - 1 : state.page + 1;
        state.page = clampPage(nextPage, view.total);
        applyFilters();
        scrollArchiveResultsToTop();
      });
    });
  }

  function renderMedia(media = []) {
    if (!media.length) {
      return "";
    }

    const items = media
      .map((item) => {
        const candidates = sourceCandidates(item, "media");
        const src = candidates[0];
        const alt = escapeHtml(item.alt_text || item.type || "Tweet media");

        if (!src) {
          return "";
        }

        if (item.type === "video") {
          return `
            <figure class="media-card">
              <video class="media-video" controls playsinline preload="metadata" data-current-src="${escapeHtml(src)}" data-fallbacks="${encodedFallbacks(candidates)}">
                <source src="${escapeHtml(src)}" type="video/mp4">
                Your browser could not play this local video file.
              </video>
              <figcaption class="media-caption">
                <a href="${escapeHtml(item.url || src)}" target="_blank" rel="noreferrer">Open video source</a>
              </figcaption>
            </figure>
          `;
        }

        return `
          <figure class="media-card">
            <img class="media-image" src="${escapeHtml(src)}" alt="${alt}" data-fallbacks="${encodedFallbacks(candidates)}" data-lightbox-src="${escapeHtml(src)}">
          </figure>
        `;
      })
      .join("");

    return `<section class="media-grid">${items}</section>`;
  }

  function renderLinks(links = []) {
    if (!links.length) {
      return "";
    }

    const items = links
      .map((link) => {
        const label = link.title || link.display_url || link.expanded_url;
        return `
          <li>
            <a href="${escapeHtml(link.expanded_url)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>
          </li>
        `;
      })
      .join("");

    return `
      <section class="meta-block">
        <h3>Links</h3>
        <ul class="meta-list">${items}</ul>
      </section>
    `;
  }

  function renderMentions(mentions = []) {
    if (!mentions.length) {
      return "";
    }

    const items = mentions
      .map((mention) => `<li>@${escapeHtml(mention.user_name)}</li>`)
      .join("");

    return `
      <section class="meta-block">
        <h3>Mentions</h3>
        <ul class="meta-list">${items}</ul>
      </section>
    `;
  }

  function renderTweet(tweet) {
    const author = tweet.author || {};
    const avatarCandidates = sourceCandidates(author, "avatar");
    const avatarSrc = avatarCandidates[0];
    const archiveAuthorUrl = author.username ? archiveUrlForAccount(author.username) : "#";
    const profileUrl = author.username ? `https://twitter.com/${author.username}` : "#";
    const tweetUrl = tweet.direct_link || profileUrl;

    return `
      <article class="tweet-card">
        ${renderIncompleteTextNotice(tweet)}
        <header class="tweet-header">
          <a class="author-link" href="${escapeHtml(archiveAuthorUrl)}">
            ${avatarSrc ? `<img class="author-avatar" src="${escapeHtml(avatarSrc)}" alt="" data-fallbacks="${encodedFallbacks(avatarCandidates)}">` : '<div class="author-avatar author-avatar--placeholder"></div>'}
            <div class="author-copy">
              <div class="author-name-row">
                <strong>${escapeHtml(author.display_name || author.username || "Unknown author")}</strong>
                ${author.verified ? '<span class="verified-badge">Verified</span>' : ""}
              </div>
              <div class="author-handle">@${escapeHtml(author.username || "unknown")}</div>
            </div>
          </a>
          <a class="tweet-link" href="${escapeHtml(tweetUrl)}" target="_blank" rel="noreferrer">Open original</a>
        </header>
        <div class="tweet-body">
          <p class="tweet-text">${formatTweetText(tweet.text || "", tweet.external_links || [])}</p>
          ${renderMedia(tweet.media)}
        </div>
        <footer class="tweet-footer">
          <span>${escapeHtml(formatTimestamp(tweet.timestamp))}</span>
          <span>${(tweet.media || []).length} media item${(tweet.media || []).length === 1 ? "" : "s"}</span>
        </footer>
        <div class="tweet-meta">
          ${renderReplyContext(tweet)}
          ${renderLinks(tweet.external_links)}
          ${renderMentions(tweet.mentions)}
        </div>
      </article>
    `;
  }

  function renderSelectionSummary(tweet) {
    const author = tweet.author || {};
    const archiveAuthorUrl = author.username ? archiveUrlForAccount(author.username) : "#";
    const profileUrl = author.username ? `https://twitter.com/${author.username}` : "#";
    const tweetUrl = tweet.direct_link || profileUrl;
    const mediaCount = (tweet.media || []).length;
    const externalLinkCount = (tweet.external_links || []).length;
    const mentionCount = (tweet.mentions || []).length;
    const replyTarget = getReplyTarget(tweet);
    const replyLabel = replyTarget?.username
      ? `@${replyTarget.username}`
      : replyTarget?.id
        ? replyTarget.id
        : "No";

    return `
      <section class="selection-card">
        ${renderIncompleteTextNotice(tweet)}
        <div class="selection-row">
          <span class="selection-label">Author</span>
          <a class="selection-value-link" href="${escapeHtml(archiveAuthorUrl)}">
            ${escapeHtml(author.display_name || author.username || "Unknown author")}
          </a>
        </div>
        <div class="selection-row">
          <span class="selection-label">Handle</span>
          <span class="selection-value">@${escapeHtml(author.username || "unknown")}</span>
        </div>
        <div class="selection-row">
          <span class="selection-label">Posted</span>
          <span class="selection-value">${escapeHtml(formatTimestamp(tweet.timestamp))}</span>
        </div>
        <div class="selection-row">
          <span class="selection-label">Tweet id</span>
          <span class="selection-value">${escapeHtml(String(tweet.id || ""))}</span>
        </div>
        <div class="selection-row">
          <span class="selection-label">Reply</span>
          <span class="selection-value">${escapeHtml(replyLabel)}</span>
        </div>
        <div class="selection-grid">
          <div class="selection-pill">
            <strong>${mediaCount}</strong>
            <span>Media</span>
          </div>
          <div class="selection-pill">
            <strong>${externalLinkCount}</strong>
            <span>Links</span>
          </div>
          <div class="selection-pill">
            <strong>${mentionCount}</strong>
            <span>Mentions</span>
          </div>
          <div class="selection-pill">
            <strong>${tweet.has_video ? "Yes" : "No"}</strong>
            <span>Video</span>
          </div>
        </div>
        <div class="selection-actions">
          <a class="tweet-link" href="${escapeHtml(profileUrl)}" target="_blank" rel="noreferrer">Open profile</a>
          <a class="tweet-link" href="${escapeHtml(tweetUrl)}" target="_blank" rel="noreferrer">Open original</a>
        </div>
        ${renderReplyContext(tweet)}
      </section>
    `;
  }

  function renderTimelineTweet(tweet) {
    const author = tweet.author || {};
    const avatarCandidates = sourceCandidates(author, "avatar");
    const avatarSrc = avatarCandidates[0];
    const archiveAuthorUrl = author.username ? archiveUrlForAccount(author.username) : "#";
    const profileUrl = author.username ? `https://twitter.com/${author.username}` : "#";
    const tweetUrl = tweet.direct_link || profileUrl;
    const badges = [];

    if (tweet.source_kind === "managed") {
      badges.push('<span class="tweet-list-badge">Imported</span>');
    }
    if (isLikelyIncompleteText(tweet.text || "")) {
      badges.push('<span class="tweet-list-badge tweet-list-badge--warning">Possibly truncated</span>');
    }
    if (tweet.has_video) {
      badges.push('<span class="tweet-list-badge">Video</span>');
    } else if ((tweet.media_count || 0) > 0) {
      badges.push(`<span class="tweet-list-badge">${tweet.media_count} media</span>`);
    }
    if (getReplyTarget(tweet)?.id) {
      badges.push('<span class="tweet-list-badge">Reply</span>');
    }
    if (localRepliesFor(tweet.id).length) {
      badges.push('<span class="tweet-list-badge">Has replies</span>');
    }

    return `
      <article class="timeline-tweet ${tweet.id === state.selectedId ? "is-selected" : ""}" data-tweet-id="${escapeHtml(tweet.id)}">
        <div class="timeline-avatar-col">
          ${avatarSrc ? `<img class="tweet-list-avatar" src="${escapeHtml(avatarSrc)}" alt="" data-fallbacks="${encodedFallbacks(avatarCandidates)}">` : '<span class="tweet-list-avatar tweet-list-avatar--placeholder"></span>'}
        </div>
        <div class="timeline-body">
          ${renderIncompleteTextNotice(tweet, true)}
          <header class="timeline-meta-row">
            <a class="timeline-author-link" href="${escapeHtml(archiveAuthorUrl)}">
              <span class="tweet-list-title">${escapeHtml(author.display_name || author.username || "Unknown author")}</span>
              <span class="tweet-list-handle">@${escapeHtml(author.username || "unknown")}</span>
            </a>
            <span class="tweet-list-dot">·</span>
            <span class="tweet-list-date">${escapeHtml(formatTimestamp(tweet.timestamp))}</span>
            <span class="timeline-badges">${badges.join("")}</span>
          </header>
          <button class="timeline-open" data-tweet-id="${escapeHtml(tweet.id)}" type="button">
            <p class="timeline-text">${formatTweetText(tweet.text || "", tweet.external_links || [])}</p>
            ${renderTimelineReplyHint(tweet)}
            ${renderTimelineChildReplies(tweet)}
            ${renderMedia(tweet.media)}
          </button>
          <footer class="timeline-footer">
            <a class="tweet-link" href="${escapeHtml(tweetUrl)}" target="_blank" rel="noreferrer">Open original</a>
          </footer>
        </div>
      </article>
    `;
  }

  async function fetchJson(path) {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`Unable to load ${path}`);
    }

    return response.json();
  }

  function setStatus(message) {
    document.querySelectorAll("[data-role='status']").forEach((node) => {
      node.textContent = message;
    });
  }

  function updateSelectionDetails(tweet) {
    const panel = document.getElementById("tweet-detail");
    if (!panel) {
      return;
    }

    panel.innerHTML = renderSelectionSummary(tweet);
    activateFallbacks(panel);
    attachMediaLightbox(panel);
  }

  function nextFallback(node, applySource) {
    const fallbackList = JSON.parse(node.dataset.fallbacks || "[]");
    const next = fallbackList.shift();

    if (!next) {
      return;
    }

    node.dataset.fallbacks = JSON.stringify(fallbackList);
    applySource(next);
  }

  function activateFallbacks(scope) {
    scope.querySelectorAll("img[data-fallbacks]").forEach((node) => {
      node.addEventListener("error", () => {
        nextFallback(node, (next) => {
          node.src = next;
          if (node.dataset.lightboxSrc !== undefined) {
            node.dataset.lightboxSrc = next;
          }
        });
      });
    });

    scope.querySelectorAll("video[data-fallbacks]").forEach((node) => {
      node.addEventListener("error", () => {
        nextFallback(node, (next) => {
          const source = node.querySelector("source");
          if (source) {
            source.src = next;
          } else {
            node.src = next;
          }
          node.dataset.currentSrc = next;
          node.load();
        });
      });
    });
  }

  function closeLightbox() {
    if (!lightbox.host || lightbox.host.hidden) {
      return;
    }

    lightbox.host.hidden = true;
    lightbox.host.setAttribute("aria-hidden", "true");
    document.body.classList.remove("lightbox-open");
    lightbox.activeSrc = "";

    if (lightbox.preview) {
      lightbox.preview.removeAttribute("src");
      lightbox.preview.alt = "";
    }
  }

  function openLightbox(src, alt) {
    if (!lightbox.host || !lightbox.preview || !src) {
      return;
    }

    if (!lightbox.host.hidden && lightbox.activeSrc === src) {
      closeLightbox();
      return;
    }

    lightbox.preview.src = src;
    lightbox.preview.alt = alt || "Full size tweet image";
    lightbox.host.hidden = false;
    lightbox.host.setAttribute("aria-hidden", "false");
    document.body.classList.add("lightbox-open");
    lightbox.activeSrc = src;
  }

  function attachMediaLightbox(scope) {
    scope.querySelectorAll("img[data-lightbox-src]").forEach((node) => {
      if (node.dataset.lightboxBound === "true") {
        return;
      }

      node.dataset.lightboxBound = "true";
      node.setAttribute("role", "button");
      node.setAttribute("tabindex", "0");
      node.setAttribute("aria-label", `${node.alt || "Tweet image"}. Open full size view`);

      const previewImage = () => {
        const src = node.currentSrc || node.dataset.lightboxSrc || node.src;
        openLightbox(src, node.alt);
      };

      node.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        previewImage();
      });

      node.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          previewImage();
        }
      });
    });
  }

  function initLightbox() {
    lightbox.host = document.getElementById("image-lightbox");
    lightbox.preview = document.getElementById("image-lightbox-preview");

    if (!lightbox.host || !lightbox.preview || lightbox.host.dataset.initialized === "true") {
      return;
    }

    lightbox.host.dataset.initialized = "true";

    lightbox.host.addEventListener("click", (event) => {
      if (event.target === lightbox.preview) {
        closeLightbox();
        return;
      }

      if (event.target.closest("[data-lightbox-close='true']") || event.target === lightbox.host) {
        closeLightbox();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeLightbox();
      }
    });
  }

  function updateSelectedListItem() {
    document.querySelectorAll(".timeline-tweet").forEach((node) => {
      node.classList.toggle("is-selected", node.dataset.tweetId === state.selectedId);
    });
  }

  function scrollSelectedListItemIntoView() {
    const selected = document.querySelector(`.timeline-tweet[data-tweet-id="${CSS.escape(state.selectedId || "")}"]`);
    if (!selected) {
      return;
    }

    selected.scrollIntoView({
      block: "center",
      inline: "nearest",
      behavior: "auto",
    });
  }

  async function selectTweet(tweetId, pushHistory = true) {
    if (!tweetId) {
      return;
    }

    state.selectedId = tweetId;
    updateSelectedListItem();
    scrollSelectedListItemIntoView();
    setStatus("Loading tweet...");

    try {
      const tweet = await fetchJson(`downloads/${tweetId}.json`);
      updateSelectionDetails(tweet);
      setStatus(`${state.manifest.length} archived tweets loaded`);

      if (pushHistory) {
        syncArchiveUrl(tweetId);
      }
    } catch (error) {
      updateSelectionDetails({
        text: "This tweet JSON could not be loaded from the local viewer cache.",
        author: { username: "viewer", display_name: "Archive Viewer" },
        media: [],
        mentions: [],
        external_links: [],
      });
      setStatus(error.message);
    }
  }

  function renderList(tweets) {
    const list = document.getElementById("tweet-list");
    if (!list) {
      return;
    }

    const view = currentPageSlice(tweets);

    if (!view.total) {
      list.innerHTML = '<div class="empty-state">No local hydrated tweets matched that search.</div>';
      return view;
    }

    list.innerHTML = view.pageTweets.map((tweet) => renderTimelineTweet(tweet)).join("");

    list.querySelectorAll("[data-tweet-id]").forEach((button) => {
      button.addEventListener("click", () => selectTweet(button.dataset.tweetId));
    });

    updateSelectedListItem();
    scrollSelectedListItemIntoView();
    activateFallbacks(list);
    attachMediaLightbox(list);
    return view;
  }

  function applyFilter(query) {
    state.query = query;
    state.page = 1;
    applyFilters();
  }

  function applyFilters() {
    const filtered = filteredTweets();
    const view = renderList(filtered);
    renderArchiveSummary();
    renderFilterChips();
    renderResultsMeta(view);
    renderPaginationControls(view);

    if (!filtered.length) {
      state.selectedId = null;
      syncArchiveUrl("");
      return;
    }

    const currentPageIds = new Set(view.pageTweets.map((tweet) => tweet.id));
    const nextSelectedId = currentPageIds.has(state.selectedId) ? state.selectedId : view.pageTweets[0]?.id;

    if (nextSelectedId && nextSelectedId !== state.selectedId) {
      selectTweet(nextSelectedId, false);
      syncArchiveUrl(nextSelectedId);
      return;
    }

    syncArchiveUrl(nextSelectedId || state.selectedId);
  }

  async function initArchivePage() {
    try {
      const manifestData = await fetchJson("downloads/index.json");
      state.manifest = manifestData.tweets || [];
      state.manifestIds = new Set(state.manifest.map((tweet) => normalizeTweetId(tweet.id)).filter(Boolean));
      state.repliesByParentId = buildReplyIndex(state.manifest);
      state.page = getPageParam();
      state.account = normalizeAccountInput(getParam("account"), true);
      setStatus(`${state.manifest.length} archived tweets loaded`);
      renderArchiveSummary();
      populateAccountFilter();
      renderFilterChips();

      const requestedId = getParam("tweet_id");
      if (requestedId) {
        const initialFiltered = filteredTweets();
        const requestedIndex = initialFiltered.findIndex((tweet) => tweet.id === requestedId);
        if (requestedIndex >= 0) {
          state.page = Math.floor(requestedIndex / PAGE_SIZE) + 1;
          state.selectedId = requestedId;
        }
      }

      applyFilters();

      const filterInput = document.getElementById("tweet-filter");
      if (filterInput) {
        filterInput.addEventListener("input", (event) => applyFilter(event.target.value));
      }

      const accountFilter = document.getElementById("account-filter");
      if (accountFilter) {
        const updateAccountFilter = (event) => {
          state.account = normalizeAccountInput(event.target.value);
          state.page = 1;
          syncAccountFilterInput();
          closeAccountSuggestions();
          applyFilters();
        };

        accountFilter.addEventListener("input", (event) => {
          renderAccountSuggestions(event.target.value);
        });
        accountFilter.addEventListener("focus", (event) => {
          renderAccountSuggestions(event.target.value);
        });
        accountFilter.addEventListener("keydown", (event) => {
          if (!state.accountSuggestions.length) {
            if (event.key === "Escape") {
              closeAccountSuggestions();
            }
            return;
          }

          if (event.key === "ArrowDown") {
            event.preventDefault();
            const nextIndex = Math.min(state.activeAccountIndex + 1, state.accountSuggestions.length - 1);
            updateActiveAccountSuggestion(nextIndex);
            return;
          }

          if (event.key === "ArrowUp") {
            event.preventDefault();
            const nextIndex = Math.max(state.activeAccountIndex - 1, 0);
            updateActiveAccountSuggestion(nextIndex);
            return;
          }

          if (event.key === "Enter" && state.activeAccountIndex >= 0) {
            event.preventDefault();
            state.account = state.accountSuggestions[state.activeAccountIndex] || "";
            syncAccountFilterInput();
            closeAccountSuggestions();
            applyFilters();
            return;
          }

          if (event.key === "Escape") {
            closeAccountSuggestions();
          }
        });
        accountFilter.addEventListener("change", updateAccountFilter);
        accountFilter.addEventListener("blur", () => {
          window.setTimeout(() => updateAccountFilter({ target: accountFilter }), 0);
        });
      }

      document.addEventListener("click", (event) => {
        if (!event.target.closest(".combo-filter")) {
          closeAccountSuggestions();
        }
      });

      const dateFrom = document.getElementById("date-from");
      if (dateFrom) {
        dateFrom.addEventListener("change", (event) => {
          state.dateFrom = event.target.value;
          state.page = 1;
          applyFilters();
        });
      }

      const dateTo = document.getElementById("date-to");
      if (dateTo) {
        dateTo.addEventListener("change", (event) => {
          state.dateTo = event.target.value;
          state.page = 1;
          applyFilters();
        });
      }

      const clearFilters = document.getElementById("clear-filters");
      if (clearFilters) {
        clearFilters.addEventListener("click", () => {
          state.query = "";
          state.account = "";
          state.dateFrom = "";
          state.dateTo = "";
          state.activeFilter = "all";
          state.page = 1;
          document.getElementById("tweet-filter").value = "";
          syncAccountFilterInput();
          document.getElementById("date-from").value = "";
          document.getElementById("date-to").value = "";
          applyFilters();
        });
      }

    } catch (error) {
      setStatus(error.message);
      renderList([]);
      updateSelectionDetails({
        text: "Run `make refresh-viewer-data` after adding some hydrated tweet JSON files.",
        author: { username: "viewer", display_name: "Archive Viewer" },
        media: [],
        mentions: [],
        external_links: [],
      });
    }
  }

  async function initSingleTweetPage() {
    const tweetId = getParam("tweet_id");
    const panel = document.getElementById("tweet-detail");
    if (!tweetId) {
      panel.innerHTML = renderTweet({
        text: "Add `?tweet_id=<id>` to the URL, or open the archive browser instead.",
        author: { username: "viewer", display_name: "Archive Viewer" },
        media: [],
        mentions: [],
        external_links: [],
      });
      setStatus("No tweet_id provided");
      return;
    }

    try {
      try {
        const manifestData = await fetchJson("downloads/index.json");
        state.manifest = manifestData.tweets || [];
        state.manifestIds = new Set(state.manifest.map((tweet) => normalizeTweetId(tweet.id)).filter(Boolean));
        state.repliesByParentId = buildReplyIndex(state.manifest);
      } catch (manifestError) {
        state.manifest = [];
        state.manifestIds = new Set();
        state.repliesByParentId = new Map();
      }

      const tweet = await fetchJson(`downloads/${tweetId}.json`);
      panel.innerHTML = renderTweet(tweet);
      activateFallbacks(panel);
      attachMediaLightbox(panel);
      setStatus(`Viewing tweet ${tweetId}`);
    } catch (error) {
      panel.innerHTML = renderTweet({
        text: `Could not load downloads/${tweetId}.json`,
        author: { username: "viewer", display_name: "Archive Viewer" },
        media: [],
        mentions: [],
        external_links: [],
      });
      setStatus(error.message);
    }
  }

  async function init() {
    initLightbox();

    const mode = document.body.dataset.mode || "archive";
    if (mode === "single") {
      await initSingleTweetPage();
      return;
    }

    await initArchivePage();
  }

  return { init };
})();

window.addEventListener("DOMContentLoaded", () => {
  ArchiveViewer.init();
});
