// biome-ignore-all lint/correctness/noInnerDeclarations: Preserve var scoping in the existing widget callbacks during extraction.
import { ensureMusicManager } from "./music-manager.js";

(() => {
	var carrier = document.getElementById("firefly-music-view-config");
	if (!carrier?.dataset.config) return;
	var cfg = JSON.parse(carrier.dataset.config);

	var mgr = ensureMusicManager();
	if (!mgr) return;

	var initScheduled = false;
	function scheduleInit() {
		if (initScheduled) return;
		initScheduled = true;

		var fired = false;
		function go() {
			if (fired) return;
			fired = true;
			document.removeEventListener("pointerdown", go, true);
			document.removeEventListener("keydown", go, true);
			mgr.init();
		}
		document.addEventListener("pointerdown", go, true);
		document.addEventListener("keydown", go, true);

		function afterLoad() {
			if (window.requestIdleCallback)
				window.requestIdleCallback(go, { timeout: 2000 });
			else setTimeout(go, 800);
		}
		if (document.readyState === "complete") afterLoad();
		else window.addEventListener("load", afterLoad, { once: true });
	}

	function initWidget(widget) {
		// ── UI element refs ──────────────────────────────────────
		var ui = {
			widget: widget,
			loading: widget.querySelector(".music-loading"),
			cover: widget.querySelector(".music-cover"),
			title: widget.querySelector(".music-title"),
			artist: widget.querySelector(".music-artist"),
			progressBar: widget.querySelector(".progress-bar"),
			progressThumb: widget.querySelector(".progress-thumb"),
			progressContainer: widget.querySelector(".progress-container"),
			currentTime: widget.querySelector(".current-time"),
			totalTime: widget.querySelector(".total-time"),
			btnPlay: widget.querySelector(".btn-play"),
			iconPlay: widget.querySelector(".icon-play"),
			iconPause: widget.querySelector(".icon-pause"),
			btnPrev: widget.querySelector(".btn-prev"),
			btnNext: widget.querySelector(".btn-next"),
			btnRepeat: widget.querySelector(".btn-repeat"),
			iconRepeat: widget.querySelector(".icon-repeat"),
			iconRepeatOne: widget.querySelector(".icon-repeat-one"),
			iconShuffle: widget.querySelector(".icon-shuffle"),
			btnMute: widget.querySelector(".btn-mute"),
			iconVolHigh: widget.querySelector(".icon-vol-high"),
			iconVolMute: widget.querySelector(".icon-vol-mute"),
			volContainer: widget.querySelector(".vol-container"),
			volBar: widget.querySelector(".vol-bar"),
			btnLrc: widget.querySelector(".btn-lrc-toggle"),
			iconLrcOn: widget.querySelector(".icon-lrc-on"),
			iconLrcOff: widget.querySelector(".icon-lrc-off"),
			lrcDrawer: widget.querySelector(".lrc-drawer"),
			lrcContainer: widget.querySelector(".lrc-container"),
			btnDrawer: widget.querySelector(".btn-drawer-toggle"),
			playlistDrawer: widget.querySelector(".playlist-drawer"),
			playlistContainer: widget.querySelector(".playlist-container"),
			itemTemplate: document.getElementById("playlist-item-template"),
		};

		// Verify critical elements
		var _critical = [
			ui.btnPlay,
			ui.btnRepeat,
			ui.btnMute,
			ui.volContainer,
			ui.btnDrawer,
			ui.btnLrc,
			ui.lrcDrawer,
			ui.lrcContainer,
			ui.progressContainer,
			ui.btnNext,
			ui.btnPrev,
			ui.loading,
			ui.cover,
			ui.title,
			ui.artist,
			ui.playlistContainer,
			ui.itemTemplate,
		];
		if (_critical.some((el) => !el)) return;

		// ── Local state (drawers, user scrolling, virtual scroll) ──
		var ITEM_H = 42;
		var OVERSCAN = 8;
		var local = {
			isUserScrolling: false,
			scrollTimeout: null,
			currentLrcIndex: -1,
			vs: {
				playlist: [],
				currentIndex: -1,
				renderedStart: -1,
				renderedEnd: -1,
				renderedEls: {},
				scrollRaf: 0,
				drawerOpen: false,
			},
		};

		// ── UI update functions ──────────────────────────────────
		function setLoading(bool) {
			if (bool) {
				ui.loading.classList.remove("opacity-0", "pointer-events-none");
			} else {
				ui.loading.classList.add("opacity-0", "pointer-events-none");
			}
		}

		function updatePlayStateUI(isPlaying) {
			if (isPlaying) {
				ui.btnPlay.classList.add(
					"bg-(--primary)",
					"text-white",
					"hover:brightness-110",
				);
				ui.btnPlay.classList.remove(
					"bg-(--btn-regular-bg)",
					"hover:bg-(--btn-regular-bg-hover)",
					"active:bg-(--btn-regular-bg-active)",
					"text-(--primary)",
				);
				ui.iconPlay.classList.add("hidden");
				ui.iconPause.classList.remove("hidden");
				ui.cover.style.animationPlayState = "running";
				ui.btnPlay.setAttribute("aria-label", cfg.i18n.pause);
				ui.btnPlay.title = cfg.i18n.pause;
			} else {
				ui.btnPlay.classList.remove(
					"bg-(--primary)",
					"text-white",
					"hover:brightness-110",
				);
				ui.btnPlay.classList.add(
					"bg-(--btn-regular-bg)",
					"hover:bg-(--btn-regular-bg-hover)",
					"active:bg-(--btn-regular-bg-active)",
					"text-(--primary)",
				);
				ui.iconPlay.classList.remove("hidden");
				ui.iconPause.classList.add("hidden");
				ui.cover.style.animationPlayState = "paused";
				ui.btnPlay.setAttribute("aria-label", cfg.i18n.play);
				ui.btnPlay.title = cfg.i18n.play;
			}
			// Toggle eq-bars / play icon in playlist
			var activeItems = ui.playlistContainer.querySelectorAll(
				'.playlist-item[aria-current="true"]',
			);
			activeItems.forEach((item) => {
				var eqBars = item.querySelector(".eq-bars");
				var playIcon = item.querySelector(".eq-play-icon");
				if (isPlaying) {
					eqBars.classList.remove("hidden");
					eqBars.classList.add("flex");
					playIcon.classList.add("hidden");
				} else {
					eqBars.classList.add("hidden");
					eqBars.classList.remove("flex");
					playIcon.classList.remove("hidden");
				}
			});
		}

		function updateModeUI(playMode) {
			var primaryColor = "text-(--primary)";
			if (playMode === 0) {
				ui.btnRepeat.className =
					"p-2 active:scale-95 transition-colors text-neutral-300 dark:text-neutral-600 hover:text-(--primary)";
				ui.iconRepeat.classList.remove("hidden");
				ui.iconRepeatOne.classList.add("hidden");
				ui.iconShuffle.classList.add("hidden");
			} else if (playMode === 1) {
				ui.btnRepeat.className = `p-2 active:scale-95 transition-colors ${primaryColor}`;
				ui.iconRepeat.classList.add("hidden");
				ui.iconRepeatOne.classList.remove("hidden");
				ui.iconShuffle.classList.add("hidden");
			} else {
				ui.btnRepeat.className = `p-2 active:scale-95 transition-colors ${primaryColor}`;
				ui.iconRepeat.classList.add("hidden");
				ui.iconRepeatOne.classList.add("hidden");
				ui.iconShuffle.classList.remove("hidden");
			}
		}

		function updateVolumeUI(volume, isMuted) {
			var pct = isMuted ? 0 : volume * 100;
			ui.volBar.style.width = `${pct}%`;
			ui.volContainer.setAttribute("aria-valuenow", Math.round(pct).toString());
			if (isMuted || volume === 0) {
				ui.iconVolHigh.classList.add("hidden");
				ui.iconVolMute.classList.remove("hidden");
			} else {
				ui.iconVolHigh.classList.remove("hidden");
				ui.iconVolMute.classList.add("hidden");
			}
		}

		function updateTrackUI(track) {
			if (!track) return;
			ui.title.innerText = track.name;
			ui.title.title = track.name;
			ui.artist.innerText = track.artist;
			ui.artist.title = track.artist;

			if (track.pic) {
				ui.cover.classList.add("opacity-0");
				ui.cover.src = track.pic;
				ui.cover.alt = `${track.name} - ${track.artist}`;
			} else {
				ui.cover.src = "";
				ui.cover.classList.add("opacity-0");
				ui.cover.alt = cfg.i18n.noCover;
			}

			// Reset cover rotation
			ui.cover.classList.remove("animate-spin-slow");
			void ui.cover.offsetWidth;
			ui.cover.classList.add("animate-spin-slow");
			ui.cover.style.animationPlayState = "paused";

			// Reset progress
			ui.progressBar.style.width = "0%";
			ui.progressThumb.style.left = "0%";
			ui.progressContainer.setAttribute("aria-valuenow", "0");
			ui.currentTime.innerText = "0:00";
			ui.totalTime.innerText = "0:00";
		}

		// ── Virtual scroll helpers (absolute-position based) ──────
		var PRIMARY_COLOR =
			getComputedStyle(document.documentElement)
				.getPropertyValue("--primary")
				.trim() || "#6366f1";

		function vsApplyActiveStyle(el, isActive) {
			var overlay = el.querySelector(".item-active-overlay");
			var title = el.querySelector(".item-title");
			var eqBars = el.querySelector(".eq-bars");
			var playIcon = el.querySelector(".eq-play-icon");
			var isPlaying = mgr.getState().isPlaying;
			if (isActive) {
				el.classList.add("bg-neutral-100", "dark:bg-white/10");
				el.setAttribute("aria-current", "true");
				overlay.classList.remove("hidden");
				overlay.classList.add("flex");
				title.style.color = PRIMARY_COLOR;
				if (isPlaying) {
					eqBars.classList.remove("hidden");
					eqBars.classList.add("flex");
					playIcon.classList.add("hidden");
				} else {
					eqBars.classList.add("hidden");
					eqBars.classList.remove("flex");
					playIcon.classList.remove("hidden");
				}
			} else {
				el.classList.remove("bg-neutral-100", "dark:bg-white/10");
				el.removeAttribute("aria-current");
				overlay.classList.add("hidden");
				overlay.classList.remove("flex");
				title.style.color = "";
			}
		}

		function vsCreateItemEl(idx) {
			var vs = local.vs;
			var track = vs.playlist[idx];
			var clone = ui.itemTemplate.content.cloneNode(true);
			var itemEl = clone.querySelector(".playlist-item");
			var img = clone.querySelector(".item-cover");
			var title = clone.querySelector(".item-title");
			var artist = clone.querySelector(".item-artist");

			img.src = track.pic || "";
			img.alt = `${track.name} - ${track.artist}`;
			title.innerText = track.name;
			artist.innerText = track.artist;

			itemEl.dataset.index = idx;
			itemEl.setAttribute("role", "option");
			itemEl.setAttribute("aria-label", `${track.name} - ${track.artist}`);
			itemEl.onclick = () => {
				mgr.playTrackByIndex(idx);
			};

			// Absolute positioning for virtual scroll
			itemEl.style.position = "absolute";
			itemEl.style.left = "0";
			itemEl.style.right = "0";
			itemEl.style.top = `${idx * ITEM_H}px`;
			itemEl.style.height = `${ITEM_H}px`;

			if (idx === vs.currentIndex) {
				vsApplyActiveStyle(itemEl, true);
			}
			return clone;
		}

		function vsCommitRange() {
			var vs = local.vs;
			if (vs.playlist.length === 0 || !vs.drawerOpen) return;

			var container = ui.playlistContainer;
			var scrollTop = container.scrollTop;
			var viewHeight = container.clientHeight;
			var start = Math.max(0, Math.floor(scrollTop / ITEM_H) - OVERSCAN);
			var end = Math.min(
				vs.playlist.length,
				Math.ceil((scrollTop + viewHeight) / ITEM_H) + OVERSCAN,
			);

			if (start === vs.renderedStart && end === vs.renderedEnd) return;

			if (vs.renderedStart === -1) {
				// First render: batch via fragment
				var frag = document.createDocumentFragment();
				for (var i = start; i < end; i++) {
					frag.appendChild(vsCreateItemEl(i));
				}
				container.appendChild(frag);
			} else {
				// Incremental: remove out-of-range, add new items
				var oldEls = vs.renderedEls;
				for (var ri = vs.renderedStart; ri < vs.renderedEnd; ri++) {
					if (ri < start || ri >= end) {
						if (oldEls[ri]) {
							oldEls[ri].remove();
							delete oldEls[ri];
						}
					}
				}
				for (var ai = start; ai < end; ai++) {
					if (!oldEls[ai]) {
						var newEl = vsCreateItemEl(ai);
						var inserted = false;
						for (var ni = ai + 1; ni < end; ni++) {
							if (oldEls[ni]) {
								container.insertBefore(newEl, oldEls[ni]);
								inserted = true;
								break;
							}
						}
						if (!inserted) container.appendChild(newEl);
						oldEls[ai] = newEl;
					}
				}
			}

			// Rebuild reference map
			vs.renderedEls = {};
			var children = container.children;
			for (var ci = 0; ci < children.length; ci++) {
				var idx = Number.parseInt(children[ci].dataset.index, 10);
				if (!Number.isNaN(idx)) vs.renderedEls[idx] = children[ci];
			}

			vs.renderedStart = start;
			vs.renderedEnd = end;
		}

		function vsRequestUpdate() {
			var vs = local.vs;
			if (vs.scrollRaf) return;
			vs.scrollRaf = requestAnimationFrame(() => {
				vs.scrollRaf = 0;
				vsCommitRange();
			});
		}

		function vsSetContainerHeight() {
			ui.playlistContainer.style.height = `${local.vs.playlist.length * ITEM_H}px`;
		}

		function renderPlaylist(playlist, currentIndex) {
			var vs = local.vs;
			vs.playlist = playlist;
			vs.currentIndex = currentIndex;
			vs.renderedStart = -1;
			vs.renderedEnd = -1;
			vs.renderedEls = {};
			vs.drawerOpen = ui.playlistDrawer.style.gridTemplateRows === "1fr";
			ui.playlistContainer.innerHTML = "";
			if (vs.drawerOpen) {
				vsSetContainerHeight();
				vsCommitRange();
			}
		}

		function updatePlaylistActiveUI(currentIndex) {
			var vs = local.vs;
			var oldIndex = vs.currentIndex;
			vs.currentIndex = currentIndex;

			if (vs.renderedEls[oldIndex]) {
				vsApplyActiveStyle(vs.renderedEls[oldIndex], false);
			}

			if (currentIndex >= 0 && currentIndex < vs.playlist.length) {
				if (currentIndex < vs.renderedStart || currentIndex >= vs.renderedEnd) {
					ui.playlistContainer.scrollTop = currentIndex * ITEM_H;
					vsCommitRange();
				}
				if (vs.renderedEls[currentIndex]) {
					vsApplyActiveStyle(vs.renderedEls[currentIndex], true);
				}
			}
		}

		function renderLyricsUI(lyrics, status) {
			local.currentLrcIndex = -1;
			ui.lrcContainer.innerHTML = "";
			if (status === "loading") {
				ui.lrcContainer.innerHTML =
					'<div class="text-neutral-400 text-sm py-10">' +
					cfg.i18n.loadingLyrics +
					"</div>";
				return;
			}
			if (status === "failed") {
				ui.lrcContainer.innerHTML =
					'<div class="text-neutral-400 text-sm py-10">' +
					cfg.i18n.failedLyrics +
					"</div>";
				return;
			}
			if (!lyrics || lyrics.length === 0) {
				ui.lrcContainer.innerHTML =
					'<div class="text-neutral-400 text-sm py-10" role="option">' +
					cfg.i18n.noLyrics +
					"</div>";
				return;
			}
			lyrics.forEach((line, index) => {
				var lineEl = document.createElement("div");
				lineEl.className =
					"lrc-line transition-all duration-300 text-sm text-neutral-400 py-1 cursor-pointer hover:text-(--primary)";
				lineEl.innerText = line.text;
				lineEl.dataset.index = index;
				lineEl.setAttribute("role", "option");
				lineEl.setAttribute("aria-label", line.text);
				lineEl.onclick = () => {
					mgr.seekToTime(line.time);
				};
				ui.lrcContainer.appendChild(lineEl);
			});
		}

		function updateLrcHighlight(index) {
			if (index === local.currentLrcIndex) return;
			local.currentLrcIndex = index;

			var lines = ui.lrcContainer.querySelectorAll(".lrc-line");
			lines.forEach((line, i) => {
				if (i === index) {
					line.classList.add("text-(--primary)", "font-bold", "text-base");
					line.classList.remove("text-neutral-400", "text-sm");
				} else {
					line.classList.remove("text-(--primary)", "font-bold", "text-base");
					line.classList.add("text-neutral-400", "text-sm");
				}
			});

			// Auto-scroll unless user is scrolling
			if (index !== -1 && !local.isUserScrolling) {
				var line = ui.lrcContainer.querySelector(
					`.lrc-line[data-index="${index}"]`,
				);
				if (line) {
					var containerHeight = ui.lrcContainer.clientHeight;
					var lineOffset = line.offsetTop;
					var lineHeight = line.offsetHeight;
					var targetScroll = lineOffset - containerHeight / 2 + lineHeight / 2;
					ui.lrcContainer.scrollTo({ top: targetScroll, behavior: "smooth" });
				}
			}
		}

		// ── Full sync from manager state (for late-mount) ────────
		function syncAll() {
			var s = mgr.getState();
			if (!s.initialized) return;

			// Loading off
			setLoading(false);

			if (s.playlist.length === 0) {
				ui.title.innerText = s.error || cfg.i18n.noSongs;
				return;
			}

			renderPlaylist(s.playlist, s.currentIndex);
			if (s.track) updateTrackUI(s.track);
			updatePlayStateUI(s.isPlaying);
			updateModeUI(s.playMode);
			updateVolumeUI(s.volume, s.isMuted);

			// Progress
			if (s.duration > 0) {
				ui.progressBar.style.width = `${s.progress}%`;
				ui.progressThumb.style.left = `${s.progress}%`;
				ui.progressContainer.setAttribute(
					"aria-valuenow",
					Math.round(s.progress).toString(),
				);
				ui.currentTime.innerText = s.currentTimeStr;
				ui.totalTime.innerText = s.durationStr;
			}

			// Lyrics
			renderLyricsUI(s.lyrics, s.lyrics.length > 0 ? "loaded" : "none");
			if (s.currentLrcIndex >= 0) updateLrcHighlight(s.currentLrcIndex);

			// Cover image: if already set, show it
			if (
				s.track?.pic &&
				ui.cover.src &&
				ui.cover.complete &&
				ui.cover.naturalWidth > 0
			) {
				ui.cover.classList.remove("opacity-0");
			}
			// Update cover animation state to match play state
			ui.cover.style.animationPlayState = s.isPlaying ? "running" : "paused";
		}

		// ── Event listeners (fm:* from manager) ──────────────────
		var handlers = {};

		function on(name, fn) {
			handlers[name] = fn;
			window.addEventListener(name, fn);
		}

		on("fm:init", (e) => {
			var d = e.detail;
			setLoading(false);
			if (d.playlist.length > 0) {
				renderPlaylist(d.playlist, 0);
				updateModeUI(d.playMode);
				updateVolumeUI(d.volume, d.isMuted);
			} else {
				ui.title.innerText = cfg.i18n.noSongs;
			}
		});

		on("fm:track", (e) => {
			var d = e.detail;
			updateTrackUI(d.track);
			updatePlaylistActiveUI(d.index);
		});

		on("fm:play-state", (e) => {
			updatePlayStateUI(e.detail.isPlaying);
		});

		on("fm:time", (e) => {
			var d = e.detail;
			ui.progressBar.style.width = `${d.progress}%`;
			ui.progressThumb.style.left = `${d.progress}%`;
			ui.progressContainer.setAttribute(
				"aria-valuenow",
				Math.round(d.progress).toString(),
			);
			ui.currentTime.innerText = d.currentTimeStr;
			ui.totalTime.innerText = d.durationStr;
		});

		on("fm:volume", (e) => {
			updateVolumeUI(e.detail.volume, e.detail.isMuted);
		});

		on("fm:mode", (e) => {
			updateModeUI(e.detail.playMode);
		});

		on("fm:lyrics", (e) => {
			renderLyricsUI(e.detail.lyrics, e.detail.status);
		});

		on("fm:lrc-index", (e) => {
			updateLrcHighlight(e.detail.index);
		});

		on("fm:error", (e) => {
			ui.title.innerText = e.detail.message || cfg.i18n.error;
		});

		// ── Button click delegates ───────────────────────────────
		ui.btnPlay.addEventListener("click", () => {
			mgr.togglePlay();
		});
		ui.btnNext.addEventListener("click", () => {
			mgr.playNext();
		});
		ui.btnPrev.addEventListener("click", () => {
			mgr.playPrev();
		});
		ui.btnRepeat.addEventListener("click", () => {
			mgr.cyclePlayMode();
		});
		ui.btnMute.addEventListener("click", () => {
			mgr.toggleMute();
		});

		ui.volContainer.addEventListener("click", (e) => {
			var rect = ui.volContainer.getBoundingClientRect();
			var x = e.clientX - rect.left;
			var val = Math.max(0, Math.min(1, x / rect.width));
			mgr.setVolume(val);
		});

		ui.progressContainer.addEventListener("click", (e) => {
			var rect = ui.progressContainer.getBoundingClientRect();
			var clickX = e.clientX - rect.left;
			var percent = Math.min(Math.max(clickX / rect.width, 0), 1);
			mgr.seek(percent);
		});

		// ── Drawer logic (local state) ───────────────────────────
		ui.btnLrc.addEventListener("click", () => {
			var isOpen = ui.lrcDrawer.style.gridTemplateRows === "1fr";
			if (isOpen) {
				ui.lrcDrawer.style.gridTemplateRows = "0fr";
				ui.lrcDrawer.classList.remove("opacity-100");
				ui.lrcDrawer.classList.add("opacity-0");
				ui.btnLrc.classList.remove("text-(--primary)");
				ui.btnLrc.classList.add("text-neutral-400");
				ui.iconLrcOn.classList.add("hidden");
				ui.iconLrcOff.classList.remove("hidden");
			} else {
				// Close playlist if open
				ui.playlistDrawer.style.gridTemplateRows = "0fr";
				ui.playlistDrawer.classList.remove("opacity-100");
				ui.playlistDrawer.classList.add("opacity-0");
				ui.btnDrawer.classList.remove("text-(--primary)");
				ui.btnDrawer.classList.add("text-neutral-400");

				ui.lrcDrawer.style.gridTemplateRows = "1fr";
				ui.lrcDrawer.classList.add("opacity-100");
				ui.lrcDrawer.classList.remove("opacity-0");
				ui.btnLrc.classList.add("text-(--primary)");
				ui.btnLrc.classList.remove("text-neutral-400");
				ui.iconLrcOn.classList.remove("hidden");
				ui.iconLrcOff.classList.add("hidden");
			}
		});

		ui.btnDrawer.addEventListener("click", () => {
			var isOpen = ui.playlistDrawer.style.gridTemplateRows === "1fr";
			if (isOpen) {
				ui.playlistDrawer.style.gridTemplateRows = "0fr";
				ui.playlistDrawer.classList.remove("opacity-100");
				ui.playlistDrawer.classList.add("opacity-0");
				ui.btnDrawer.classList.add("text-neutral-400");
				ui.btnDrawer.classList.remove("text-(--primary)");
				local.vs.drawerOpen = false;
			} else {
				// Close lyrics if open
				ui.lrcDrawer.style.gridTemplateRows = "0fr";
				ui.lrcDrawer.classList.remove("opacity-100");
				ui.lrcDrawer.classList.add("opacity-0");
				ui.btnLrc.classList.remove("text-(--primary)");
				ui.btnLrc.classList.add("text-neutral-400");
				ui.iconLrcOn.classList.add("hidden");
				ui.iconLrcOff.classList.remove("hidden");

				ui.playlistDrawer.style.gridTemplateRows = "1fr";
				ui.playlistDrawer.classList.add("opacity-100");
				ui.playlistDrawer.classList.remove("opacity-0");
				ui.btnDrawer.classList.remove("text-neutral-400");
				ui.btnDrawer.classList.add("text-(--primary)");
				local.vs.drawerOpen = true;

				// Render playlist after drawer transition settles
				if (local.vs.playlist.length > 0) {
					requestAnimationFrame(() => {
						vsSetContainerHeight();
						vsCommitRange();
					});
				}
			}
		});

		// ── Playlist virtual scroll listener ──────────────────────
		ui.playlistContainer.addEventListener("scroll", () => {
			vsRequestUpdate();
		});

		// ── Lyrics user scroll detection ─────────────────────────
		function resetScrollTimeout() {
			clearTimeout(local.scrollTimeout);
			local.scrollTimeout = setTimeout(() => {
				local.isUserScrolling = false;
				// Snap back to current lyric
				var s = mgr.getState();
				if (s.currentLrcIndex >= 0) {
					var line = ui.lrcContainer.querySelector(
						`.lrc-line[data-index="${s.currentLrcIndex}"]`,
					);
					if (line) {
						var containerHeight = ui.lrcContainer.clientHeight;
						var lineOffset = line.offsetTop;
						var lineHeight = line.offsetHeight;
						var targetScroll =
							lineOffset - containerHeight / 2 + lineHeight / 2;
						ui.lrcContainer.scrollTo({ top: targetScroll, behavior: "auto" });
					}
				}
			}, 3000);
		}

		ui.lrcContainer.addEventListener("wheel", () => {
			local.isUserScrolling = true;
			resetScrollTimeout();
		});
		ui.lrcContainer.addEventListener("touchstart", () => {
			local.isUserScrolling = true;
			resetScrollTimeout();
		});

		// ── Cover image events ───────────────────────────────────
		ui.cover.addEventListener("load", () => {
			ui.cover.classList.remove("opacity-0");
		});
		ui.cover.addEventListener("error", () => {
			ui.cover.classList.add("opacity-0");
		});

		// ── Cleanup on DOM removal ───────────────────────────────
		var observer = new MutationObserver(() => {
			if (widget.isConnected) return;
			Object.keys(handlers).forEach((name) => {
				window.removeEventListener(name, handlers[name]);
			});
			observer.disconnect();
			clearTimeout(local.scrollTimeout);
			if (local.vs.scrollRaf) cancelAnimationFrame(local.vs.scrollRaf);
		});
		observer.observe(document.body, { childList: true, subtree: true });

		// ── Init: either sync existing state or trigger init ─────
		var currentState = mgr.getState();
		if (currentState.initialized) {
			// Manager already initialized (late mount) – sync all UI
			syncAll();
		} else {
			// First widget to mount – show loading and trigger init
			setLoading(true);
			scheduleInit();
		}
		return true;
	}

	// 导航栏 widget 保留标记，Swup 新换入的侧栏 widget 由页面事件初始化。
	function initAll() {
		var widgets = document.querySelectorAll(".music-player-widget");
		for (var i = 0; i < widgets.length; i++) {
			var w = widgets[i];
			if (w.dataset.musicInit === "1") continue;
			if (initWidget(w)) w.dataset.musicInit = "1";
		}
	}

	initAll();
	document.addEventListener("astro:page-load", initAll);
	document.addEventListener("swup:content:replace", initAll);
})();
