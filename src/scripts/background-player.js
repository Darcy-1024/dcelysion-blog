import {
	assignMedia,
	backupMedia,
	managedMedia,
	markMediaPlayed,
} from "@/utils/media-client";
export function ensureBackgroundPlayer() {
	var carrier = document.getElementById("bg-player");
	if (!carrier) return;
	var sourceMap = JSON.parse(carrier.dataset.sources);
	var positionMap = JSON.parse(carrier.dataset.positions);
	var playerMode = carrier.dataset.playerMode;
	var desktopQuery = window.matchMedia("(min-width: 1024px)");
	var root = document.getElementById("bg-player");
	if (!root) return;

	var previousController = window.__fireflyBackgroundPlayer;
	if (previousController && previousController.root === root) return;
	if (previousController && typeof previousController.destroy === "function") {
		previousController.destroy();
	}

	function selectUrls() {
		var preferred = desktopQuery.matches ? sourceMap.desktop : sourceMap.mobile;
		var fallback = desktopQuery.matches ? sourceMap.mobile : sourceMap.desktop;
		return preferred.length ? preferred : fallback;
	}

	function selectPosition() {
		return desktopQuery.matches ? positionMap.desktop : positionMap.mobile;
	}

	var urlList = selectUrls();
	if (!urlList.length) return;
	var isMultiple = urlList.length > 1;

	var overlay = document.getElementById("bg-player-overlay");
	var videoA = document.getElementById("bg-player-video-a");
	var videoB = document.getElementById("bg-player-video-b");
	var prevBtn = document.getElementById("bg-prev-btn");
	var nextBtn = document.getElementById("bg-next-btn");
	var toast = document.getElementById("bg-player-toast");

	if (!videoA || !videoB) return;
	var activeVideo = videoA;
	var standbyVideo = videoB;
	configureVideos();

	var isPlaying = false;
	var currentIndex = -1;
	var activeIndex = -1;
	var nextIndex = -1;
	var errorCount = 0;
	var toastTimer = null;
	var playRequestId = 0;
	var transitionTimer = null;
	var unmuteTimer = null;
	var preloadCheckTimer = null;
	var preloadIdleId = null;
	var preloadIdleKind = null;
	var standbyRequestId = 0;
	var lastStallAt = 0;
	var randomAdvanceOnNextPlay = false;
	var destroyed = false;
	var connection =
		navigator.connection ||
		navigator.mozConnection ||
		navigator.webkitConnection;

	function configureVideos() {
		var position = selectPosition();
		videoA.style.objectPosition = position;
		videoB.style.objectPosition = position;
		videoA.loop = playerMode === "random";
		videoB.loop = playerMode === "random";
		videoA.muted = true;
		videoB.muted = true;
		videoA.volume = 0;
		videoB.volume = 0;
	}

	function showToast() {
		if (!toast) return;
		toast.classList.remove("opacity-0");
		toast.classList.add("opacity-100");
		if (toastTimer) clearTimeout(toastTimer);
		toastTimer = setTimeout(() => {
			toast.classList.remove("opacity-100");
			toast.classList.add("opacity-0");
		}, 3000);
	}

	function pickIndex(except) {
		if (urlList.length <= 1) return 0;
		if (playerMode === "random") {
			var n;
			do {
				n = Math.floor(Math.random() * urlList.length);
			} while (n === except);
			return n;
		}
		return (except + 1) % urlList.length;
	}

	function prevIndex() {
		if (urlList.length <= 1) return 0;
		var base = activeIndex >= 0 ? activeIndex : currentIndex;
		if (playerMode === "random") return pickIndex(base);
		return (base - 1 + urlList.length) % urlList.length;
	}

	function syncAttr() {
		document.body.toggleAttribute("data-bg-video-playing", isPlaying);
		document.documentElement.toggleAttribute(
			"data-bg-video-playing",
			isPlaying,
		);
		window.dispatchEvent(
			new CustomEvent("bg-player-state-change", {
				detail: { playing: isPlaying },
			}),
		);
	}

	function hideOverlay() {
		if (!overlay) return;
		overlay.classList.remove("opacity-100");
		overlay.classList.add("opacity-0");
	}

	function showOverlay() {
		if (!overlay) return;
		overlay.classList.remove("opacity-0");
		overlay.classList.add("opacity-100");
	}

	function initialIndex() {
		if (activeIndex >= 0 && activeIndex < urlList.length) return activeIndex;
		if (currentIndex >= 0 && currentIndex < urlList.length) return currentIndex;
		return playerMode === "random" ? pickIndex(-1) : 0;
	}

	function loadActiveSource(index) {
		if (index < 0 || index >= urlList.length) return;
		activeIndex = index;
		var url = urlList[index];
		if (activeVideo.dataset.mediaOriginal === url && !activeVideo.error) return;
		activeVideo.dataset.mediaOriginal = url;
		activeVideo.preload = "auto";
		assignMedia(activeVideo, url);
		activeVideo.load();
	}

	function clearPreloadScheduling() {
		if (preloadCheckTimer) {
			clearTimeout(preloadCheckTimer);
			preloadCheckTimer = null;
		}
		if (preloadIdleId !== null) {
			if (preloadIdleKind === "idle" && window.cancelIdleCallback) {
				window.cancelIdleCallback(preloadIdleId);
			} else {
				clearTimeout(preloadIdleId);
			}
			preloadIdleId = null;
			preloadIdleKind = null;
		}
	}

	function cancelStandby() {
		clearPreloadScheduling();
		standbyRequestId++;
		nextIndex = -1;
		standbyVideo.pause();
		standbyVideo.removeAttribute("src");
		standbyVideo.preload = "none";
		standbyVideo.load();
	}

	function standbyIsReady(index) {
		return (
			nextIndex === index &&
			standbyVideo.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA
		);
	}

	function promoteStandby(index) {
		if (!standbyIsReady(index)) return false;
		var oldActive = activeVideo;
		activeVideo = standbyVideo;
		standbyVideo = oldActive;
		activeIndex = index;
		nextIndex = -1;
		standbyRequestId++;
		activeVideo.classList.remove("opacity-0");
		activeVideo.classList.add("opacity-100");
		standbyVideo.classList.remove("opacity-100");
		standbyVideo.classList.add("opacity-0");
		standbyVideo.pause();
		standbyVideo.muted = true;
		standbyVideo.volume = 0;
		standbyVideo.removeAttribute("src");
		standbyVideo.preload = "none";
		standbyVideo.load();
		return true;
	}

	function playIndex(index) {
		if (destroyed || index < 0 || index >= urlList.length) return;
		clearPreloadScheduling();
		if (!promoteStandby(index)) {
			if (nextIndex >= 0) cancelStandby();
			loadActiveSource(index);
		}
		var requestId = ++playRequestId;
		activeVideo.muted = true;
		activeVideo.volume = 0;
		activeVideo
			.play()
			.then(() => {
				if (!isPlaying || requestId !== playRequestId || destroyed) {
					activeVideo.pause();
					return;
				}
				currentIndex = index;
				activeIndex = index;
				randomAdvanceOnNextPlay = false;
				errorCount = 0;
				showOverlay();
				syncAttr();
				schedulePreloadCheck();
				if (unmuteTimer) clearTimeout(unmuteTimer);
				unmuteTimer = setTimeout(() => {
					unmuteTimer = null;
					if (isPlaying && requestId === playRequestId && !destroyed) {
						activeVideo.volume = 1;
						activeVideo.muted = false;
					}
				}, 100);
			})
			.catch(() => {
				if (requestId !== playRequestId || destroyed) return;
				handleActiveError();
			});
	}

	function transitionTo(index) {
		if (destroyed || index < 0 || index >= urlList.length) return;
		playRequestId++;
		if (unmuteTimer) {
			clearTimeout(unmuteTimer);
			unmuteTimer = null;
		}
		activeVideo.pause();
		hideOverlay();
		clearPreloadScheduling();
		if (transitionTimer) clearTimeout(transitionTimer);
		transitionTimer = setTimeout(() => {
			transitionTimer = null;
			if (isPlaying && !destroyed) playIndex(index);
		}, 520);
	}

	function requestTrack(index) {
		if (index < 0 || index >= urlList.length) return;
		randomAdvanceOnNextPlay = false;
		if (isPlaying) {
			transitionTo(index);
		} else if (!promoteStandby(index)) {
			if (nextIndex >= 0) cancelStandby();
			loadActiveSource(index);
		}
	}

	function syncTrackButtons() {
		if (prevBtn) prevBtn.style.display = isMultiple ? "" : "none";
		if (nextBtn) nextBtn.style.display = isMultiple ? "" : "none";
	}

	function onViewportChange() {
		var nextUrls = selectUrls();
		if (!nextUrls.length) return;
		var targetIndex = activeIndex >= 0 ? activeIndex : initialIndex();
		cancelStandby();
		urlList = nextUrls;
		isMultiple = urlList.length > 1;
		targetIndex = Math.min(targetIndex, urlList.length - 1);
		if (currentIndex >= urlList.length) currentIndex = -1;
		errorCount = 0;
		configureVideos();
		syncTrackButtons();
		if (isPlaying) {
			transitionTo(targetIndex);
		} else {
			loadActiveSource(targetIndex);
		}
	}

	function toggle() {
		if (isPlaying) {
			isPlaying = false;
			playRequestId++;
			if (unmuteTimer) {
				clearTimeout(unmuteTimer);
				unmuteTimer = null;
			}
			if (transitionTimer) {
				clearTimeout(transitionTimer);
				transitionTimer = null;
			}
			activeVideo.pause();
			hideOverlay();
			syncAttr();
			clearPreloadScheduling();
			if (playerMode === "random" && isMultiple) {
				randomAdvanceOnNextPlay = true;
				if (nextIndex < 0) nextIndex = pickIndex(currentIndex);
			}
		} else {
			if (!runtimeModeAllowsPreload()) return;
			isPlaying = true;
			var target =
				randomAdvanceOnNextPlay && isMultiple
					? nextIndex >= 0
						? nextIndex
						: pickIndex(currentIndex)
					: initialIndex();
			requestAnimationFrame(() => {
				playIndex(target);
			});
		}
	}

	function markPlayed(event) {
		markMediaPlayed(event.currentTarget);
	}
	function onEnded() {
		if (playerMode === "random") {
			// 随机模式在一次播放会话内保持当前视频循环
			playIndex(currentIndex);
		} else if (isMultiple) {
			transitionTo(pickIndex(currentIndex));
		} else {
			isPlaying = false;
			hideOverlay();
			syncAttr();
		}
	}

	function handleActiveError(event) {
		if (event && event.currentTarget !== activeVideo) return;
		if (managedMedia(activeVideo)) {
			if (backupMedia(activeVideo)) {
				activeVideo.load();
				if (isPlaying) void activeVideo.play().catch(() => {});
				return;
			}
			isPlaying = false;
			hideOverlay();
			syncAttr();
			showToast();
			return;
		}
		errorCount++;
		if (isMultiple && errorCount < urlList.length) {
			// 多视频模式下自动尝试下一个
			var failedIndex = activeIndex >= 0 ? activeIndex : currentIndex;
			var fallbackIndex = pickIndex(failedIndex);
			if (isPlaying) transitionTo(fallbackIndex);
			else loadActiveSource(fallbackIndex);
		} else {
			// 所有视频都失败或只有单个视频
			isPlaying = false;
			hideOverlay();
			syncAttr();
			showToast();
		}
	}

	function runtimeModeAllowsPreload() {
		return (
			document.documentElement.getAttribute("data-wallpaper-mode") !== "none"
		);
	}

	function networkAllowsPreload() {
		if (!connection) return true;
		if (connection.saveData) return false;
		return (
			connection.effectiveType !== "slow-2g" &&
			connection.effectiveType !== "2g"
		);
	}

	function basePreloadConditionsMet() {
		return (
			!destroyed &&
			document.visibilityState === "visible" &&
			runtimeModeAllowsPreload() &&
			networkAllowsPreload()
		);
	}

	function bufferedAhead(video) {
		var currentTime = video.currentTime;
		for (var i = 0; i < video.buffered.length; i++) {
			if (
				video.buffered.start(i) <= currentTime &&
				video.buffered.end(i) >= currentTime
			) {
				return video.buffered.end(i) - currentTime;
			}
		}
		return 0;
	}

	function currentBufferIsSufficient() {
		if (
			!isPlaying ||
			activeVideo.paused ||
			activeVideo.ended ||
			currentIndex < 0
		)
			return false;
		var duration = activeVideo.duration;
		if (!Number.isFinite(duration) || duration <= 0) return false;
		var threshold = Math.min(8, Math.max(3, duration * 0.25));
		var fullyBuffered = false;
		if (activeVideo.buffered.length) {
			fullyBuffered =
				activeVideo.buffered.end(activeVideo.buffered.length - 1) >=
				duration - 0.25;
		}
		return fullyBuffered || bufferedAhead(activeVideo) >= threshold;
	}

	function preconnectSource(index) {
		try {
			var origin = new URL(urlList[index], window.location.href).origin;
			if (
				origin === window.location.origin ||
				document.querySelector(
					'link[data-bg-video-preconnect="' + origin + '"]',
				)
			)
				return;
			var link = document.createElement("link");
			link.rel = "preconnect";
			link.href = origin;
			link.setAttribute("data-bg-video-preconnect", origin);
			document.head.appendChild(link);
		} catch (_error) {
			// 无效 URL 会在 video error 事件中按既有流程处理。
		}
	}

	function startStandbyPreload() {
		preloadIdleId = null;
		preloadIdleKind = null;
		if (
			!basePreloadConditionsMet() ||
			!currentBufferIsSufficient() ||
			Date.now() - lastStallAt < 2000 ||
			!isMultiple ||
			nextIndex >= 0
		)
			return;
		var candidate = pickIndex(currentIndex);
		if (candidate === currentIndex) return;
		standbyRequestId++;
		nextIndex = candidate;
		preconnectSource(candidate);
		standbyVideo.pause();
		standbyVideo.muted = true;
		standbyVideo.volume = 0;
		standbyVideo.preload = "auto";
		standbyVideo.dataset.mediaOriginal = urlList[candidate];
		assignMedia(standbyVideo, urlList[candidate]);
		standbyVideo.load();
	}

	function handleStandbyError(event) {
		if (event.currentTarget === standbyVideo && nextIndex >= 0) {
			if (backupMedia(standbyVideo)) standbyVideo.load();
			else cancelStandby();
		}
	}

	function schedulePreloadCheck() {
		clearPreloadScheduling();
		if (!basePreloadConditionsMet()) {
			cancelStandby();
			return;
		}
		if (!isMultiple || nextIndex >= 0 || !isPlaying) return;
		var stallDelay = Math.max(0, 2000 - (Date.now() - lastStallAt));
		if (!currentBufferIsSufficient() || stallDelay > 0) {
			preloadCheckTimer = setTimeout(
				schedulePreloadCheck,
				Math.max(250, stallDelay),
			);
			return;
		}
		if (window.requestIdleCallback) {
			preloadIdleKind = "idle";
			preloadIdleId = window.requestIdleCallback(startStandbyPreload, {
				timeout: 1000,
			});
		} else {
			preloadIdleKind = "timer";
			preloadIdleId = setTimeout(startStandbyPreload, 0);
		}
	}

	function handleStall() {
		lastStallAt = Date.now();
		cancelStandby();
		if (isPlaying) preloadCheckTimer = setTimeout(schedulePreloadCheck, 2000);
	}

	function handlePreloadConditionChange() {
		if (!basePreloadConditionsMet()) cancelStandby();
		else if (isPlaying) schedulePreloadCheck();
	}

	function handleWallpaperModeChange(event) {
		var mode = event.detail && event.detail.mode;
		if (mode === "none") {
			cancelStandby();
			if (transitionTimer) {
				clearTimeout(transitionTimer);
				transitionTimer = null;
			}
			if (unmuteTimer) {
				clearTimeout(unmuteTimer);
				unmuteTimer = null;
			}
			if (isPlaying) {
				isPlaying = false;
				playRequestId++;
				activeVideo.pause();
				hideOverlay();
				syncAttr();
			}
		} else if (isPlaying) {
			schedulePreloadCheck();
		}
	}

	// 监听导航栏播放按钮事件
	window.addEventListener("bg-player-toggle", toggle);
	videoA.addEventListener("playing", markPlayed);
	videoB.addEventListener("playing", markPlayed);
	videoA.addEventListener("ended", onEnded);
	videoB.addEventListener("ended", onEnded);
	videoA.addEventListener("error", handleActiveError);
	videoB.addEventListener("error", handleActiveError);
	videoA.addEventListener("error", handleStandbyError);
	videoB.addEventListener("error", handleStandbyError);
	videoA.addEventListener("progress", schedulePreloadCheck);
	videoB.addEventListener("progress", schedulePreloadCheck);
	videoA.addEventListener("waiting", handleStall);
	videoB.addEventListener("waiting", handleStall);
	videoA.addEventListener("stalled", handleStall);
	videoB.addEventListener("stalled", handleStall);
	if (prevBtn) prevBtn.addEventListener("click", onPrevClick);
	if (nextBtn) nextBtn.addEventListener("click", onNextClick);
	window.addEventListener("wallpaperModeChange", handleWallpaperModeChange);
	document.addEventListener("visibilitychange", handlePreloadConditionChange);
	if (connection && connection.addEventListener)
		connection.addEventListener("change", handlePreloadConditionChange);

	function onPrevClick() {
		requestTrack(prevIndex());
	}

	function onNextClick() {
		var base = activeIndex >= 0 ? activeIndex : currentIndex;
		requestTrack(pickIndex(base));
	}

	// 动态控制 prev/next 按钮显示，并在跨越桌面/移动端断点时切换视频源
	syncTrackButtons();
	if (basePreloadConditionsMet()) loadActiveSource(initialIndex());
	if (desktopQuery.addEventListener)
		desktopQuery.addEventListener("change", onViewportChange);
	else if (desktopQuery.addListener) desktopQuery.addListener(onViewportChange);

	function destroy() {
		if (destroyed) return;
		destroyed = true;
		playRequestId++;
		if (transitionTimer) clearTimeout(transitionTimer);
		if (unmuteTimer) clearTimeout(unmuteTimer);
		if (toastTimer) clearTimeout(toastTimer);
		cancelStandby();
		videoA.pause();
		videoB.pause();
		window.removeEventListener("bg-player-toggle", toggle);
		window.removeEventListener(
			"wallpaperModeChange",
			handleWallpaperModeChange,
		);
		document.removeEventListener(
			"visibilitychange",
			handlePreloadConditionChange,
		);
		videoA.removeEventListener("ended", onEnded);
		videoB.removeEventListener("ended", onEnded);
		videoA.removeEventListener("playing", markPlayed);
		videoB.removeEventListener("playing", markPlayed);
		videoA.removeEventListener("error", handleActiveError);
		videoB.removeEventListener("error", handleActiveError);
		videoA.removeEventListener("error", handleStandbyError);
		videoB.removeEventListener("error", handleStandbyError);
		videoA.removeEventListener("progress", schedulePreloadCheck);
		videoB.removeEventListener("progress", schedulePreloadCheck);
		videoA.removeEventListener("waiting", handleStall);
		videoB.removeEventListener("waiting", handleStall);
		videoA.removeEventListener("stalled", handleStall);
		videoB.removeEventListener("stalled", handleStall);
		if (prevBtn) prevBtn.removeEventListener("click", onPrevClick);
		if (nextBtn) nextBtn.removeEventListener("click", onNextClick);
		if (connection && connection.removeEventListener)
			connection.removeEventListener("change", handlePreloadConditionChange);
		if (desktopQuery.removeEventListener)
			desktopQuery.removeEventListener("change", onViewportChange);
		else if (desktopQuery.removeListener)
			desktopQuery.removeListener(onViewportChange);
		document.body.removeAttribute("data-bg-video-playing");
		document.documentElement.removeAttribute("data-bg-video-playing");
		window.removeEventListener("pagehide", onPageHide);
		if (
			window.__fireflyBackgroundPlayer &&
			window.__fireflyBackgroundPlayer.root === root
		) {
			delete window.__fireflyBackgroundPlayer;
		}
	}

	function onPageHide(event) {
		if (!event.persisted) destroy();
	}

	window.__fireflyBackgroundPlayer = { root: root, destroy: destroy };
	window.addEventListener("pagehide", onPageHide);
}
