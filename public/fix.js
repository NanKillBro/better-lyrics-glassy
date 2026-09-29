/**
 * YOUTUBE MUSIC CUSTOM ENHANCEMENTS
 * Tệp JavaScript tổng hợp các tinh chỉnh giao diện cho Glassy Music
 */

// =========================================================================
// PHẦN 1: YOUTUBE MUSIC - SMOOTH FADE OUT ANIMATIONS
// Mô tả: Thêm hiệu ứng fade out mượt mà khi đóng menu và dialog 
// =========================================================================
(function () {
  'use strict';

  const style = document.createElement('style');
  style.textContent = `
        @keyframes menuFadeOut {
          0% { opacity: 1; margin-top: 0; }
          100% { opacity: 0; margin-top: -10px; }
        }

        @keyframes popupXuatHienNguoc {
          0% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          100% { opacity: 0; transform: translate(-50%, -45%) scale(0.95); }
        }

        .ytm-fade-out-menu {
          animation: menuFadeOut 0.25s cubic-bezier(0.2, 0.8, 0.2, 1) forwards !important;
          display: block !important;
          pointer-events: none !important;
        }

        .ytm-fade-out-dialog {
          animation: popupXuatHienNguoc 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) forwards !important;
          pointer-events: none !important;
        }
    `;
  document.head.appendChild(style);

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      const el = mutation.target;
      if (el.nodeType !== 1) return;

      const isMenu = el.matches('tp-yt-iron-dropdown.ytmusic-popup-container, tp-yt-iron-dropdown#dropdown, tp-yt-iron-dropdown.tp-yt-paper-menu-button');
      const isDialog = el.matches('ytmusic-add-to-playlist-renderer, ytmusic-unified-share-panel-renderer, ytmusic-dialog, ytmusic-engagement-panel-section-list-renderer, tp-yt-paper-dialog');

      if (!isMenu && !isDialog) return;

      // =====================================================================
      // GUARD: Chặn YouTube ghi đè style khi đang fade-out (cả menu & dialog)
      // =====================================================================
      if (el.classList.contains('ytm-is-fading-out')) {
        if (mutation.attributeName === 'style') {
          let needFix = false;
          if (el.style.display !== 'block') needFix = true;
          if (el._ytmSavedZIndex && el.style.zIndex !== el._ytmSavedZIndex) needFix = true;
          if (el._ytmFadeAnim && !el.style.animation.includes('Fade')) needFix = true;

          if (needFix) {
            el.style.setProperty('display', 'block', 'important');
            if (el._ytmFadeAnim) {
              el.style.setProperty('animation', el._ytmFadeAnim, 'important');
            }
            if (el._ytmSavedZIndex) {
              el.style.setProperty('z-index', el._ytmSavedZIndex, 'important');
            }
          }
        }
        return; // Đang fade-out → không xử lý gì thêm
      }

      // Xác định trạng thái hiện tại
      const isHidden = !el.hasAttribute('opened') && (el.style.display === 'none' || el.getAttribute('aria-hidden') === 'true');
      const isVisible = !isHidden;

      if (isVisible) {
        // --- NẾU ĐANG MỞ ---
        el.classList.remove('ytm-fade-out-menu', 'ytm-fade-out-dialog', 'ytm-is-fading-out');
        el._ytmSavedZIndex = null;
        el._ytmFadeAnim = null;
        el.style.removeProperty('animation');
        el.style.removeProperty('pointer-events');
        if (el._ytmCloseTimer) {
          clearTimeout(el._ytmCloseTimer);
          el._ytmCloseTimer = null;
        }

        // Chờ 50ms để xác nhận là nó "mở thật"
        if (el.dataset.stableOpen !== 'true' && !el._ytmOpenTimer) {
          el._ytmOpenTimer = setTimeout(() => {
            el.dataset.stableOpen = 'true';
            el._ytmOpenTimer = null;
          }, 50);
        }
      } else {
        // --- NẾU ĐANG ĐÓNG ---
        if (el._ytmOpenTimer) {
          clearTimeout(el._ytmOpenTimer);
          el._ytmOpenTimer = null;
        }

        if (el.dataset.stableOpen === 'true') {
          el.dataset.stableOpen = 'false';

          el.classList.add('ytm-is-fading-out');

          if (isMenu) {
            // ─── MENU: Cách mới — inline override để hoạt động ở player page ───
            el._ytmSavedZIndex = el.style.zIndex || null;
            if (!el._ytmSavedZIndex) {
              const computed = getComputedStyle(el).zIndex;
              if (computed && computed !== 'auto') el._ytmSavedZIndex = computed;
            }

            el._ytmFadeAnim = 'menuFadeOut 0.25s cubic-bezier(0.2, 0.8, 0.2, 1) forwards';

            el.style.setProperty('display', 'block', 'important');
            el.style.setProperty('animation', el._ytmFadeAnim, 'important');
            el.style.setProperty('pointer-events', 'none', 'important');
            if (el._ytmSavedZIndex) {
              el.style.setProperty('z-index', el._ytmSavedZIndex, 'important');
            }

            el.classList.add('ytm-fade-out-menu');
            console.debug('[GlassyUI: Dialogs] 💨 Fading out menu popup');

            el._ytmCloseTimer = setTimeout(() => {
              el.classList.remove('ytm-fade-out-menu', 'ytm-is-fading-out');
              el.style.setProperty('display', 'none');
              el.style.removeProperty('z-index');
              el.style.removeProperty('animation');
              el.style.removeProperty('pointer-events');
              el._ytmSavedZIndex = null;
              el._ytmFadeAnim = null;
            }, 300);
          } else {
            // ─── DIALOG: Cách mới — inline override để hoạt động ở player page ───
            el._ytmSavedZIndex = el.style.zIndex || null;
            if (!el._ytmSavedZIndex) {
              const computed = getComputedStyle(el).zIndex;
              if (computed && computed !== 'auto') el._ytmSavedZIndex = computed;
            }

            el._ytmFadeAnim = 'popupXuatHienNguoc 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) forwards';

            el.style.setProperty('display', 'block', 'important');
            el.style.setProperty('animation', el._ytmFadeAnim, 'important');
            if (el._ytmSavedZIndex) {
              el.style.setProperty('z-index', el._ytmSavedZIndex, 'important');
            }

            el.classList.add('ytm-fade-out-dialog');
            console.debug('[GlassyUI: Dialogs] 💨 Fading out dialog popup');

            el._ytmCloseTimer = setTimeout(() => {
              el.classList.remove('ytm-fade-out-dialog', 'ytm-is-fading-out');
              el.style.setProperty('display', 'none');
              el.style.removeProperty('z-index');
              el.style.removeProperty('animation');
              el._ytmSavedZIndex = null;
              el._ytmFadeAnim = null;
            }, 300);
          }
        }
      }
    });
  });

  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['opened', 'style', 'aria-hidden'],
    subtree: true
  });
  console.info('[GlassyUI: Dialogs] Observer started. Smooth fade-outs enabled.');
})();




// =========================================================================
// PHẦN 3: PLAYER BAR - HIỆU ỨNG FADE OUT KHI CHUYỂN BÀI
// Mô tả: Tạo overlay snapshot thông tin bài cũ rồi fade out mượt mà
// Fix: YouTube xóa nội dung (text, ảnh) ngay lập tức → CSS transition
//      không thấy được → cần JS overlay để giữ hình ảnh cũ fade ra
// =========================================================================

(function () {
  'use strict';

  let normalState = null;      // Cache thông tin bài hát — player bar mode thường
  let fullscreenState = null;  // Cache thông tin bài hát — player bar trong fullscreen
  let fadeOverlay = null;  // Overlay đang fade
  let fadeTimer = null;    // Timer dọn dẹp
  let resizeTimer = null;  // Debounce resize
  let currentBar = null;   // Bar host đang được theo dõi (cũ hoặc mới)
  let layoutObserver = null; // Theo dõi player-fullscreened trên #layout (chỉ bar mới)

  // YTM đang A/B test 2 phiên bản bar: bar cũ (ytmusic-player-bar) và bar mới
  // (ytmusic-miniplayer). Ưu tiên bar mới khi cả hai cùng tồn tại.
  function findBar() {
    return document.querySelector('ytmusic-miniplayer') || document.querySelector('ytmusic-player-bar');
  }

  function isNewBar(bar) {
    return !!bar && bar.tagName.toLowerCase() === 'ytmusic-miniplayer';
  }

  // YTM đánh dấu fullscreen player UI bằng attribute riêng
  // - Bar cũ: player-fullscreened nằm trên chính bar
  // - Bar mới: player-fullscreened nằm trên ytmusic-app-layout#layout
  // (tin được cho cả fullscreen thật lẫn fullscreen giả — không phụ thuộc window resize)
  function isPlayerFullscreen(el) {
    const bar = el ? el.closest('ytmusic-miniplayer, ytmusic-player-bar') : (currentBar && currentBar.isConnected ? currentBar : findBar());
    if (isNewBar(bar)) return !!document.querySelector('ytmusic-app-layout[player-fullscreened]');
    return !!bar && bar.hasAttribute('player-fullscreened');
  }

  // Cache tương ứng mode hiện tại của player bar
  function getCache(bar) {
    return isPlayerFullscreen(bar || currentBar) ? fullscreenState : normalState;
  }

  // Descriptor UI hiện tại — trừu tượng hóa khác biệt giữa 2 phiên bản bar.
  // Dựng lại mỗi lần gọi để luôn trỏ tới node còn sống.
  function getUi(bar) {
    const host = bar || (currentBar && currentBar.isConnected ? currentBar : findBar());
    if (!host) return null;

    if (isNewBar(host)) {
      const container = host.querySelector('.ytMusicMiniPlayerLeftSection');
      if (!container) return null;
      return {
        host: host,
        isNew: true,
        container: container,
        title: container.querySelector('.ytmusicTrackInfoTitle'),
        byline: container.querySelector('.ytmusicTrackInfoBylineItem'),
        img: container.querySelector('img.ytmusicTrackInfoThumbnail'),
        thumbWrapper: container.querySelector('.ytmusicTrackInfoThumbnailWrapper'),
        contentWrapper: container.querySelector('.ytmusicTrackInfoContentInfoWrapper'),
        fadeTargets: '.ytmusicTrackInfoThumbnailWrapper, .ytmusicTrackInfoContentInfoWrapper'
      };
    }

    const container = host.querySelector('.middle-controls.ytmusic-player-bar');
    if (!container) return null;
    return {
      host: host,
      isNew: false,
      container: container,
      title: container.querySelector('yt-formatted-string.title.ytmusic-player-bar'),
      byline: container.querySelector('yt-formatted-string.byline'),
      img: container.querySelector('.thumbnail-image-wrapper img.image'),
      thumbWrapper: container.querySelector('.thumbnail-image-wrapper'),
      contentWrapper: container.querySelector('.content-info-wrapper'),
      fadeTargets: ':scope > .thumbnail-image-wrapper, :scope > .content-info-wrapper, :scope > .middle-controls-buttons'
    };
  }

  // Trạng thái rỗng/đang tải của title — bar cũ dùng attribute is-empty,
  // bar mới để trống attribute title trong lúc tải bài/quảng cáo.
  function isTitleEmpty(ui) {
    if (!ui.title) return true;
    if (ui.isNew) {
      const v = ui.title.getAttribute('title');
      return v === null || v === '';
    }
    return ui.title.hasAttribute('is-empty');
  }

  // Cache trạng thái bài hát hiện tại (chỉ khi có dữ liệu)
  function captureState(bar) {
    const ui = getUi(bar);
    if (!ui) return;

    // Bar mới: đồng bộ class loading với trạng thái title (belt-and-braces)
    if (ui.isNew) ui.host.classList.toggle('blyrics-track-loading', isTitleEmpty(ui));

    if (!ui.title || isTitleEmpty(ui)) return;

    // Bar cũ: text nằm trong DOM; bar mới: metadata nằm ở attribute title
    const titleText = ui.isNew
      ? (ui.title.getAttribute('title') || '').trim()
      : (ui.title.textContent || '').trim();
    if (!titleText) return;

    const bylineText = ui.isNew
      ? (ui.byline?.getAttribute('title') || ui.byline?.textContent?.trim() || '')
      : (ui.byline?.title || ui.byline?.textContent?.trim() || '');

    const container = ui.container;

    // Tính vị trí thực tế so với container (overlay được gắn vào container)
    const containerRect = container.getBoundingClientRect();
    const wrapperRect = ui.thumbWrapper?.getBoundingClientRect();
    const cwRect = ui.contentWrapper?.getBoundingClientRect();

    const thumbLeft = wrapperRect ? (wrapperRect.left - containerRect.left) : 0;
    const gap = (wrapperRect && cwRect) ? (cwRect.left - wrapperRect.right) : 12;

    // Capture computed font styles để overlay khớp pixel-perfect
    const titleCS = getComputedStyle(ui.title);
    const bylineCS = ui.byline ? getComputedStyle(ui.byline) : null;

    const st = {
      imgSrc: ui.img?.src || '',
      titleText: titleText,
      bylineText: bylineText,
      thumbW: ui.thumbWrapper?.offsetWidth || 48,
      thumbH: ui.thumbWrapper?.offsetHeight || 48,
      thumbLeft: thumbLeft,
      gap: gap,
      // Font styles cho title
      titleFontSize: titleCS.fontSize,
      titleFontWeight: titleCS.fontWeight,
      titleFontFamily: titleCS.fontFamily,
      titleLineHeight: titleCS.lineHeight,
      titleColor: titleCS.color,
      // Font styles cho subtitle
      bylineFontSize: bylineCS?.fontSize || '14px',
      bylineFontWeight: bylineCS?.fontWeight || '400',
      bylineFontFamily: bylineCS?.fontFamily || 'inherit',
      bylineLineHeight: bylineCS?.lineHeight || '20px',
      bylineColor: bylineCS?.color || 'rgba(255,255,255,0.7)'
    };
    if (isPlayerFullscreen(container)) fullscreenState = st; else normalState = st;
  }

  // Dọn dẹp overlay
  function killOverlay() {
    if (fadeTimer) { clearTimeout(fadeTimer); fadeTimer = null; }
    if (fadeOverlay) { fadeOverlay.remove(); fadeOverlay = null; }
  }

  // Tạo overlay snapshot với thông tin bài cũ
  function createOverlay(container, lastState) {
    lastState = lastState || getCache();
    if (!lastState || !lastState.titleText) return null;
    killOverlay();

    // Đảm bảo container là containing block cho overlay absolute (belt-and-braces với CSS)
    if (getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }

    const ov = document.createElement('div');
    ov.className = 'ytm-songinfo-fade-overlay';
    Object.assign(ov.style, {
      position: 'absolute', inset: '0',
      display: 'flex', alignItems: 'center',
      paddingLeft: lastState.thumbLeft + 'px',
      gap: lastState.gap + 'px',
      opacity: '1', pointerEvents: 'none', zIndex: '10',
      transition: 'opacity 0.35s cubic-bezier(0.2, 0.8, 0.2, 1), transform 0.35s cubic-bezier(0.2, 0.8, 0.2, 1)',
      transform: 'translateY(0)', overflow: 'hidden'
    });

    // Thumbnail
    if (lastState.imgSrc) {
      const wrap = document.createElement('div');
      Object.assign(wrap.style, {
        width: lastState.thumbW + 'px', height: lastState.thumbH + 'px',
        borderRadius: '12px', overflow: 'hidden', flexShrink: '0',
        boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
      });
      const img = document.createElement('img');
      img.src = lastState.imgSrc;
      Object.assign(img.style, { width: '100%', height: '100%', objectFit: 'cover', display: 'block' });
      wrap.appendChild(img);
      ov.appendChild(wrap);
    }

    // Text container (dùng gap thật thay vì paddingLeft)
    const txt = document.createElement('div');
    Object.assign(txt.style, {
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
      overflow: 'hidden', minWidth: '0', flex: '1'
    });

    // Title (dùng computed styles thay vì hardcode)
    const t = document.createElement('span');
    t.textContent = lastState.titleText;
    Object.assign(t.style, {
      color: lastState.titleColor, fontSize: lastState.titleFontSize,
      fontWeight: lastState.titleFontWeight, fontFamily: lastState.titleFontFamily,
      lineHeight: lastState.titleLineHeight,
      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
    });
    txt.appendChild(t);

    // Subtitle (dùng computed styles thay vì hardcode)
    if (lastState.bylineText) {
      const s = document.createElement('span');
      s.textContent = lastState.bylineText;
      Object.assign(s.style, {
        color: lastState.bylineColor, fontSize: lastState.bylineFontSize,
        fontWeight: lastState.bylineFontWeight, fontFamily: lastState.bylineFontFamily,
        lineHeight: lastState.bylineLineHeight,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
      });
      txt.appendChild(s);
    }

    ov.appendChild(txt);
    container.appendChild(ov);
    return ov;
  }

  // Helper: tạo overlay rồi fade out
  function triggerFadeOut(ui) {
    fadeOverlay = createOverlay(ui.container, getCache(ui.host));
    if (fadeOverlay) {
      void fadeOverlay.offsetWidth; // force reflow
      console.info('[GlassyUI: Player] 💨 Fading out old track info...');
      fadeOverlay.style.opacity = '0';
      fadeOverlay.style.transform = 'translateY(5px)';
      fadeTimer = setTimeout(killOverlay, 400);
    }
  }

  // Helper: ẩn children tức thì rồi fade in (dùng cho bài cached)
  // Tạo hiệu ứng crossfade: overlay (bài cũ) fade out ↔ children (bài mới) fade in
  function fadeInChildren(ui) {
    const children = ui.container.querySelectorAll(ui.fadeTargets);

    // Bước 1: Ẩn tức thì (tắt transition)
    children.forEach(child => {
      child.style.setProperty('transition', 'none', 'important');
      child.style.setProperty('opacity', '0', 'important');
      child.style.setProperty('transform', 'translateY(5px)', 'important');
    });

    // Bước 2: Force reflow để browser ghi nhận state opacity:0
    void ui.container.offsetWidth;

    // Bước 3: Gỡ inline → CSS transition kicks in → fade from 0→1
    requestAnimationFrame(() => {
      children.forEach(child => {
        child.style.removeProperty('transition');
        child.style.removeProperty('opacity');
        child.style.removeProperty('transform');
      });
    });
  }

  // === Bar mới (ytmusic-miniplayer): title attribute là nguồn dữ liệu chính ===
  function handleNewBarMutation(mut, el) {
    // Node bị re-render/thay thế → descriptor cũ vô hiệu, dựng lại rồi capture
    if (!el.isConnected) {
      const ui = getUi();
      if (ui && ui.title && !isTitleEmpty(ui)) ui.host.classList.remove('blyrics-track-loading');
      setTimeout(captureState, 50);
      return;
    }

    if (mut.attributeName !== 'title') return; // src chỉ có trong filter làm lưới an toàn

    const ui = getUi();
    if (!ui || !ui.isNew || !ui.title || el !== ui.title) return;

    const oldTitle = mut.oldValue;
    const newTitle = el.getAttribute('title');

    if (oldTitle && newTitle && oldTitle !== newTitle) {
      // Bài cached/đổi trực tiếp → crossfade
      console.info('[GlassyUI: Player] 🔄 Crossfading cached track info...');
      triggerFadeOut(ui);
      fadeInChildren(ui);
      // Cache state mới ngay (nội dung đã sẵn sàng)
      setTimeout(captureState, 50);
    } else if (oldTitle && !newTitle) {
      // Đang tải bài mới / quảng cáo → giữ overlay bài cũ fade out, ẩn info gốc
      console.info('[GlassyUI: Player] ⏳ Track loading — fading out old info...');
      ui.host.classList.add('blyrics-track-loading');
      triggerFadeOut(ui);
    } else if (!oldTitle && newTitle) {
      // Metadata bài mới đã về → hiện info mới
      console.info('[GlassyUI: Player] ✅ New track metadata arrived.');
      ui.host.classList.remove('blyrics-track-loading');
      killOverlay();
      setTimeout(captureState, 200);
    }
  }

  // Observer: theo dõi cả is-empty (non-cached) VÀ title attribute (cached)
  const observer = new MutationObserver((mutations) => {
    for (const mut of mutations) {
      if (mut.type !== 'attributes') continue;

      const el = mut.target;

      // === CASE 0: bật/tắt fullscreen player UI (bar cũ) → capture lại geometry ===
      if (mut.attributeName === 'player-fullscreened') {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(captureState, 300);
        continue;
      }

      // === Bar mới: luồng riêng theo title attribute ===
      if (currentBar && isNewBar(currentBar)) {
        handleNewBarMutation(mut, el);
        continue;
      }

      if (!el.matches || !el.matches('yt-formatted-string.title.ytmusic-player-bar')) continue;

      const ui = getUi();
      if (!ui || ui.isNew) continue;

      // === CASE 1: is-empty thay đổi (bài CHƯA cache — có loading) ===
      if (mut.attributeName === 'is-empty') {
        if (el.hasAttribute('is-empty')) {
          // Bắt đầu chuyển bài → fade out overlay
          triggerFadeOut(ui);
        } else {
          // Bài mới đã load xong → dọn overlay, cache state mới
          killOverlay();
          setTimeout(captureState, 200);
        }
      }

      // === CASE 2: title attribute thay đổi (bài ĐÃ cache — đổi liền) ===
      if (mut.attributeName === 'title') {
        // Bỏ qua nếu đang trong flow is-empty (Case 1 đã xử lý)
        if (el.hasAttribute('is-empty')) continue;

        const oldTitle = mut.oldValue;
        const newTitle = el.getAttribute('title');

        // Chỉ xử lý khi title thực sự thay đổi sang bài khác
        if (oldTitle && newTitle && oldTitle !== newTitle) {
          console.info('[GlassyUI: Player] 🔄 Crossfading cached track info...');
          // Bài cached → Overlay (bài cũ) fade out + Children (bài mới) fade in = crossfade
          triggerFadeOut(ui);
          fadeInChildren(ui);
          // Cache state mới ngay (nội dung đã sẵn sàng)
          setTimeout(captureState, 50);
        }
      }
    }
  });

  // Bar mới báo fullscreen qua attribute trên #layout (bar cũ báo trên chính bar)
  function startLayoutObserver() {
    if (layoutObserver) return;
    const layout = document.querySelector('ytmusic-app-layout');
    if (!layout) return;
    layoutObserver = new MutationObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(captureState, 300);
    });
    layoutObserver.observe(layout, { attributes: true, attributeFilter: ['player-fullscreened'] });
  }

  // Gắn observer vào bar hiện tại (tự nhận biết bar cũ/mới)
  function bind() {
    const bar = findBar();
    if (!bar) return false;
    if (bar === currentBar) return true;

    currentBar = bar;
    observer.disconnect();
    killOverlay();

    if (isNewBar(bar)) {
      observer.observe(bar, {
        attributes: true,
        // Chỉ title + src: lọc bỏ churn mỗi giây của progress bar
        attributeFilter: ['title', 'src'],
        attributeOldValue: true,
        subtree: true
      });
      startLayoutObserver();
      console.info('[GlassyUI: Player] Observer started (ytmusic-miniplayer). Smooth track transitions enabled.');
    } else {
      observer.observe(bar, {
        attributes: true,
        attributeFilter: ['is-empty', 'title', 'player-fullscreened'],
        attributeOldValue: true,
        subtree: true
      });
      console.info('[GlassyUI: Player] Observer started (ytmusic-player-bar). Smooth track transitions enabled.');
    }

    captureState(bar);
    if (!getCache(bar)) setTimeout(() => captureState(bar), 2000);

    return true;
  }

  // Recapture khi resize cửa sổ (debounce 300ms)
  // — backup cho fullscreen ở bar mới khi #layout chưa kịp có attribute
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(captureState, 300);
  });

  // Bar có thể được render lại sau khi điều hướng → gắn lại observer
  document.addEventListener('yt-navigate-finish', () => {
    if (!bind()) setTimeout(bind, 1000);
  });

  function init() {
    if (!bind()) setTimeout(init, 1000);
  }

  init();
})();
