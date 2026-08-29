// Dán CSS theme "cucu" của bạn vào giữa 2 dấu huyền (`) ở dưới
const MY_CUSTOM_CSS = `
/* =============================================================================================================*/
/* MERGED THEME: Some UI Update                                                                                 */
/* Based on: Dynamic Background (chengg), Big Blurry Slow Lyrics for TV (zobiron), Luxurious Glass (SKMJi),     */
/*           better-ytm (WolfTheE), blyrics-am-theme (tposejank), Sustain (boidushya)                           */
/* Made by: Gemini and NanKill                                                                                  */
/* ============================================================================================================ */

:root,
html,
body,
ytmusic-app {
    --ytmusic-title-line-height-dynamic: 1.2 !important;
    --ytmusic-body-line-height-dynamic: 1.4 !important;
    --ytmusic-title-line-height: 1.2 !important;
    --ytmusic-body-line-height: 1.4 !important;
    --ytmusic-guide-background: transparent !important;
    --ytmusic-mini-guide-background: transparent !important;
    --tp-yt-app-drawer-content-container-background-color: transparent !important;
    --ytmusic-guide-wrapper-background: transparent !important;
}

/* ============================================== */
/* 1. BIẾN CẤU HÌNH (ROOT VARIABLES)              */
/* ============================================== */
:root {
  /* -- [ Cấu hình chung ] -- */
  --blyrics-lyric-active-color: white;
  --blyrics-lyric-inactive-color: rgba(255, 255, 255, 0.4);
  --blyrics-font-family: "Verdana", var(--noto-sans-universal), sans-serif;
  
  /* Font size & Line height */
  --blyrics-font-size: 4.5rem; 
  --blyrics-font-weight: 700;
  --blyrics-line-height: 1.4;

  /* -- [ Layout Variables ] -- */
  --yt-cover-size: 650px;
  --side-panel-width: 55%;
  --blyrics-bottom-spacing: 50px;

  /* -- [ Glassmorphism Variables ] -- */
  --blyrics-bg-color: rgba(0, 0, 0, 0.25);
  --blyrics-border-radius: 18px;
  --blyrics-img-max-width: 576px;
  
  /* Shadow: Toạ độ 0 0 để đều 4 cạnh */
  --blyrics-box-shadow: 0 0 60px rgba(0, 0, 0, 0.4), 0 0 25px rgba(255, 255, 255, 0.12) inset;
  
  --blyrics-background-filter: blur(70px) saturate(2.5) brightness(70%);
}

/* ============================================== */
/* 2. TINH CHỈNH GIAO DIỆN CHUNG (GLOBAL FIXES)   */
/* ============================================== */
/* Xóa thanh cuộn cho gọn mắt */
html, #items, #tab-renderer, #chips, ytmusic-menu-popup-renderer, .ytmusicMultiPageMenuHost, .scrollable-content, .scroller, .dropdown-content, .ytmusic-settings-page {
  scrollbar-width: none !important;
}
body::-webkit-scrollbar {
  display: none;
}

/* FINAL FIX: DIỆT TẬN GỐC SCROLLBAR (V3) */
/* Ẩn thanh cuộn của TẤT CẢ phần tử con khi đang Fullscreen */
ytmusic-player-page[player-fullscreened] *::-webkit-scrollbar {
  display: none !important;
  width: 0 !important;
  height: 0 !important;
  background: transparent !important;
}

ytmusic-player-page[player-fullscreened] * {
  scrollbar-width: none !important;
  -ms-overflow-style: none !important;
}

/* Chặn trang web (body) bị cuộn nếu nội dung bị tràn ra ngoài màn hình */
/* Dùng :has để check nếu đang fullscreen thì khóa body lại */
body:has(ytmusic-player-page[player-fullscreened]) {
  overflow: hidden !important;
}

/* Đảm bảo khung lyric vẫn cuộn được (nhưng không hiện thanh) */
ytmusic-player-page[player-fullscreened] .blyrics-container {
  overflow-y: auto !important;
}

/* ============================================== */
/* CLEAN UI: TẮT VIỀN XANH & BÔI ĐEN              */
/* ============================================== */

/* Tắt viền xanh (Outline) khi bấm Alt, Tab hoặc Click vào các nút */
*:focus, *:focus-visible {
    outline: none !important;
    border: none !important;
    box-shadow: none !important;
}

/* Tắt tính năng bôi đen text/ảnh (Selection) khi lỡ tay kéo chuột */
/* Giúp app nhìn xịn hơn, giống Spotify app */
body, html, #player, ytmusic-player-page {
    user-select: none !important;
    -webkit-user-select: none !important; /* Dành cho Chrome/Chromium */
}

/* Cho phép bôi đen lại ở khung tìm kiếm để còn gõ chữ */
input, textarea, #input, .ytmusic-search-box {
    user-select: text !important;
    -webkit-user-select: text !important;
    /* Giữ lại outline nhẹ để biết đang gõ ở đâu (tuỳ thích) */
    /* outline: 1px solid rgba(255,255,255,0.2) !important; */
}

/* FIX: XÓA NỀN GỐC (IMMERSIVE BACKGROUND) */
div#background.immersive-background {
  display: none !important;      /* Xóa hoàn toàn khỏi layout */
  visibility: hidden !important; /* Đảm bảo không nhìn thấy */
  opacity: 0 !important;         /* Độ trong suốt về 0 */
  background: transparent !important;
}

/* Ẩn luôn cả thẻ con bên trong cho chắc chắn */
ytmusic-fullbleed-thumbnail-renderer[is-background] {
  display: none !important;
}

/* [GỘP TỰ ĐỘNG MỌI CLASS CHUNG] Xóa nền, làm trong suốt */
.menu.ytmusic-multi-row-list-item-renderer,
/* Podcast Header */
ytmusic-visual-header-renderer[has-banner-image] .gradient-container.ytmusic-visual-header-renderer,
.ytmusic-browse-response .content-container-wrapper,
.content-container-wrapper .gradient-container,
/* Làm trong suốt các dòng item đơn lẻ */
ytmusic-multi-select-menu-item-renderer,
ytmusic-multi-select-menu-item-renderer button,
/* BẢNG XÁC NHẬN (Ví dụ: Hủy đăng ký), BẢNG THÔNG TIN BÀI HÁT (Credits)*/
/* Áp dụng cho bảng Sắp xếp và Chọn quốc gia */
ytmusic-multi-select-menu-renderer,
/* Xử lý nền của Avatar và các phần tử nhỏ hơn */
yt-avatar-shape,
.yt-spec-avatar-shape,
.yt-spec-avatar-shape--avatar-size-extra-large,
/* Triệt tiêu nền xám của bảng Engagement Panel và các thành phần con */
ytmusic-engagement-panel-section-list-renderer,
ytmusic-engagement-panel-title-header-renderer,
playlist-collaboration-view-model,
content-list-item-view-model,
.ytContentListItemViewModelContentListItemWrapper,
#header.ytmusic-engagement-panel-section-list-renderer,
#content.ytmusic-engagement-panel-section-list-renderer,
.scrollable-content.ytmusic-engagement-panel-section-list-renderer,
/* Xóa nền thừa */
ytmusic-settings-page,
ytmusic-dialog .content,
ytmusic-dialog #content,
ytmusic-unified-share-panel-renderer #contents,
ytmusic-add-to-playlist-renderer,
ytmusic-add-to-playlist-renderer .top-bar,
ytmusic-add-to-playlist-renderer #actions,
ytmusic-playlist-form,
ytmusic-playlist-form .content,
ytmusic-playlist-form #general-pane,
ytmusic-playlist-form #collaborate-pane,
ytmusic-playlist-form tp-yt-iron-pages,
tp-yt-paper-listbox ytmusic-dropdown-item-renderer,
tp-yt-paper-listbox tp-yt-paper-item,
tp-yt-paper-listbox tp-yt-paper-item.menu-item,
yt-confirm-dialog-renderer,
ytmusic-dismissable-dialog-renderer,
ytmusic-dismissable-dialog-renderer #metadata,
ytmusic-dismissable-dialog-renderer .top-bar,
ytmusic-multi-select-menu-renderer #container,
ytmusic-multi-select-menu-renderer #items,
ytmusic-multi-select-menu-renderer ytmusic-menu-title-renderer,
ytmusic-background-promo-renderer,
ytmusic-offline-item-section-renderer,
ytmusic-item-section-renderer #items.ytmusic-item-section-renderer,
/* Nếu bạn muốn áp dụng riêng cho phần hộp thoại bên trong */
.ytmusicMultiPageMenuRendererHost,
ytmusic-search-box #suggestion-list ytmusic-search-suggestions-section,
/* Fix xóa nền xám mặc định của YouTube Music */
.background-gradient {
  background: transparent !important;
  background-color: transparent !important;
}

/* ============================================== */
/* 3. NỀN GIAO DIỆN & HIỆU ỨNG KÍNH (BLUR & BG)   */
/* ============================================== */
/* BACKGROUND ĐỘNG TRANG CHỦ & TÌM KIẾM */
#browse-page::before,
#search-page::before {
  content: "";
  position: fixed;
  inset: 0;
  height: 120vh;
  background: var(--blyrics-background-img);
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  transform: scale(1.2);
  z-index: -50;
  /* Thông số mặc định: blur 60px, bão hòa 1.5, độ sáng 0.7 */
  filter: blur(60px) saturate(1.5) brightness(0.7);
  transition: background 0.4s ease-in-out 0.3s;
  will-change: background;
}
ytmusic-fullbleed-thumbnail-renderer[is-background] .image {
  mask-image: linear-gradient(transparent);
}

/* Bật Blur mặc định cho TẤT CẢ trường hợp --- */
ytmusic-player-bar,
#player-bar-background {
  backdrop-filter: blur(var(--blyrics-blur-amount)) !important;
  background: transparent !important; /* Đảm bảo nền trong suốt để thấy blur */
}

/* Tắt Blur KHI VÀ CHỈ KHI Player đang mở --- */
/* Dùng #layout trực tiếp thay cho body:has(): tương đương vì player bar nằm trong
   #layout (xem rule ngay bên dưới), và tránh :has() neo ở body — Blink phải kiểm
   tra lại subject đó mỗi khi có bất kỳ thay đổi DOM nào trong trang. */
#layout[player-ui-state="PLAYER_PAGE_OPEN"] ytmusic-player-bar,
#layout[player-ui-state="PLAYER_PAGE_OPEN"] #player-bar-background {
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
}

#layout[player-ui-state="PLAYER_PAGE_OPEN"] #mini-guide-background,
#layout[player-ui-state="PLAYER_PAGE_OPEN"] #nav-bar-background,
#layout[player-ui-state="PLAYER_PAGE_OPEN"] #guide-wrapper {
  backdrop-filter: none !important; 
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
}

/* ============================================== */
/* 4. THANH ĐIỀU HƯỚNG & TÌM KIẾM (NAV & SEARCH)  */
/* ============================================== */
/* THANH ĐIỀU HƯỚNG & TITLE BAR - HIỆU ỨNG KÍNH NỐI LIỀN */
body #nav-bar-background.ytmusic-app-layout {
  top: 0 !important;
  height: calc(var(--ytmusic-nav-bar-height) + var(--menu-bar-height, 0px)) !important;
  opacity: 1;
  backdrop-filter: blur(20px) !important;
  -webkit-backdrop-filter: blur(20px) !important;
  mask-image: linear-gradient(to bottom, black 70%, transparent 100%) !important;
  -webkit-mask-image: linear-gradient(to bottom, black 70%, transparent 100%) !important;
  background: transparent !important;
  border-bottom: transparent !important;
  border-top: 0 !important;
}

ytmusic-app-layout.content-scrolled #nav-bar-divider {
  opacity: 1;
  backdrop-filter: blur(20px) !important;
  -webkit-backdrop-filter: blur(20px) !important;
  background: transparent !important;
  border-bottom: transparent !important;
  border-top: 0 !important;
}

/* THANH ĐIỀU HƯỚNG BÊN TRÁI (SIDEBAR / GUIDE DRAWER) */
#guide-wrapper {
  background: transparent !important;
  background-color: transparent !important;
  border-color: transparent !important;
  box-shadow: none !important;
}

tp-yt-app-drawer#guide #scrim {
  background: transparent !important;
}

ytmusic-app-layout.content-scrolled #mini-guide-background.ytmusic-app-layout,
ytmusic-app-layout[player-page-open] #mini-guide-background.ytmusic-app-layout,
ytmusic-app-layout[is-bauhaus-sidenav-enabled].content-scrolled #mini-guide-background.ytmusic-app-layout,
ytmusic-app-layout[is-bauhaus-sidenav-enabled][player-page-open] #mini-guide-background.ytmusic-app-layout {
  opacity: 0 !important;
}

tp-yt-paper-item.ytmusic-guide-entry-renderer:hover {
  background: rgba(255, 255, 255, 0.1) !important;
}

tp-yt-paper-item.ytmusic-guide-entry-renderer[aria-current="true"],
ytmusic-guide-entry-renderer[active] tp-yt-paper-item {
  background: rgba(255, 255, 255, 0.15) !important;
}

#divider {
  border: 0 !important;
  border-color: transparent !important;
  background-color: transparent !important;
}

tp-yt-app-drawer#guide #guide-spacer {
  height: 25px !important; /* Thay đổi chiều cao theo nhu cầu */
  display: block !important;
}

ytmusic-guide-section-renderer[is-collapsed][is-primary] {
  padding-top: 25px !important;
  box-sizing: border-box !important;
}

/* THANH TÌM KIẾM (SEARCH BOX) MỚI */
ytmusic-search-box .search-box {
  border-radius: 12px !important;
  background: rgba(255, 255, 255, 0.1) !important;
  border: transparent !important;
}
ytmusic-search-box .search-box .yt-icon-shape {
  color: white;
}
input.ytmusic-search-box {
  color: rgba(255, 255, 255, 0.7);
}
ytmusic-search-box[has-query] input.ytmusic-search-box,
ytmusic-search-box[opened] input.ytmusic-search-box {
  color: white;
}
ytmusic-search-box[has-query] input.ytmusic-search-box::placeholder,
ytmusic-search-box[opened] input.ytmusic-search-box::placeholder {
  color: white;
}
.search-container.ytmusic-search-box {
  border-radius: 12px;
}
ytmusic-search-box[has-query] .search-container.ytmusic-search-box,
ytmusic-search-box[opened] .search-container.ytmusic-search-box {
  border-radius: 12px;
  background: transparent !important;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
}

/* Hiệu ứng kính cho Danh sách gợi ý tìm kiếm */
/* Danh sách gợi ý tìm kiếm (Bây giờ chỉ là nền trong suốt) */
ytmusic-search-box #suggestion-list {
  top: 0;
  opacity: 0;
  visibility: hidden;
  display: initial !important;
  border-radius: 12px !important;
  
  /* Xoá nền, viền và bóng đi để lớp Ảo gánh */
  background: transparent !important; 
  border: none !important;
  box-shadow: none !important;
  
  /* GÁN MỎ NEO CHO NÓ VỚI TÊN RIÊNG */
  anchor-name: --nankill-search-dropdown; 
  
  transition: opacity 0.3s ease, top 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), visibility 0.3s;
}
/* ============================================== */
/* HIỆU ỨNG KÍNH MỜ CHO KHUNG SEARCH (Huge Thanks to WolfTheE for this idea) */
/* ============================================== */

/* Cố định lớp z-index cho thanh điều hướng để không bị đè */
ytmusic-app-layout:not([player-ui-state="PLAYER_PAGE_OPEN"]) #nav-bar-background {
  z-index: 4 !important;
}

/* Lớp ảo ::after này sẽ tạo ra khối kính mờ */
ytmusic-app-layout::after {
  z-index: 4 !important;
  content: "";
  position: fixed;  
  
  /* Bám sát 100% theo toạ độ của mỏ neo */
  position-anchor: --nankill-search-dropdown;      
  top: anchor(top) !important;              
  left: anchor(left) !important;           
  width: anchor-size(width) !important;    
  height: anchor-size(height) !important;
  
  /* Bơm Blur vào đây thì chắc chắn 100% ăn */
  backdrop-filter: blur(20px) saturate(150%);
  -webkit-backdrop-filter: blur(20px) saturate(150%);
  
  /* Lấy màu chủ đạo của bài hát làm nền kính */
  background: rgba(var(--ytmusic-album-color-dark), 0.6);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  box-shadow: none !important;

  transition: opacity 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), visibility 0.3s;
  opacity: 0; 
  visibility: hidden;
  
  /* Cho phép chuột click xuyên qua cái kính này để bấm được vào text ở dưới */
  pointer-events: none; 
}

/* Khi người dùng click vào search box thì hiện lớp kính ảo lên */
ytmusic-app-layout:has(ytmusic-search-box:focus-within)::after,
ytmusic-app-layout:has(ytmusic-search-box[opened])::after {
  opacity: 1;
  visibility: visible;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.7) !important;
}
ytmusic-search-box[opened] #suggestion-list {
  top: calc(var(--ytmusic-search-box-height) + 16px) !important;
  opacity: 1;
  visibility: visible;
}
/* Tạo khoảng cách padding/margin để các item floating bên trong box */
ytmusic-search-box #suggestion-list ytmusic-search-suggestions-section {
  padding: 8px 0 !important; /* Thêm khoảng trống ở đỉnh và đáy của danh sách */
}

ytmusic-search-box #suggestion-list ytmusic-search-suggestion,
ytmusic-search-box #suggestion-list ytmusic-responsive-list-item-renderer {
  margin: 2px 12px !important; /* Thụt vào 12px ở 2 bên trái/phải, cách nhau 2px trên/dưới */
  width: auto !important; /* Trả lại auto để margin không làm tràn khung */
  border-radius: 8px !important; /* Bo góc cho khớp với highlight */
  background: transparent !important;
  color: white;
  transition: background 0.2s ease, color 0.2s ease;
}
/* Phủ một lớp kính trắng 15% lên trên màu Album 40% để ép sáng */
ytmusic-search-box #suggestion-list ytmusic-search-suggestion:hover,
ytmusic-search-box #suggestion-list ytmusic-responsive-list-item-renderer:hover {
  background: linear-gradient(rgba(255, 255, 255, 0.15), rgba(255, 255, 255, 0.15)), rgba(var(--ytmusic-album-color), 0.4) !important; 
  border-radius: 8px !important;
  color: white !important;
}

/* Đảm bảo text bên trong kết quả bài hát cũng đổi màu sáng rõ */
ytmusic-search-box #suggestion-list ytmusic-responsive-list-item-renderer:hover * {
  color: white !important;
}
#suggestions .ytmusic-search-suggestions-section {
  border-radius: 8px;
}

/* ============================================== */
/* MENU TÀI KHOẢN & MULTI-PAGE MENU (GLASSY)      */
/* ============================================== */
/* Khung bọc ngoài cùng của popup menu để không bị cắt viền */
tp-yt-iron-dropdown:has(.ytmusicMultiPageMenuRendererHost) {
  border-radius: 12px !important;
  border: 1px solid rgba(255, 255, 255, 0.15) !important;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.3) !important;
  overflow: hidden !important;
}

ytmusic-multi-page-menu-renderer.ytmusicMultiPageMenuRendererHost {
  border-radius: 12px !important;
  border: none !important;
  box-shadow: none !important;
  color: white !important;
  overflow: hidden !important;
  box-sizing: border-box !important;
}

/* Thêm khoảng cách ở các list item */
ytmusic-multi-page-menu-renderer.ytmusicMultiPageMenuRendererHost #sections {
  padding: 8px 0 !important;
}

/* Bo góc và khoảng cách 2 bên cho từng list item */
ytmusic-multi-page-menu-renderer.ytmusicMultiPageMenuRendererHost ytd-compact-link-renderer {
  margin: 2px 12px !important;
  width: auto !important;
  border-radius: 8px !important;
  background: transparent !important;
  transition: background 0.2s ease, color 0.2s ease !important;
}

/* Hiệu ứng kính trắng khi hover (đã làm trong suốt hơn theo yêu cầu) */
ytmusic-multi-page-menu-renderer.ytmusicMultiPageMenuRendererHost ytd-compact-link-renderer:hover,
ytmusic-multi-page-menu-renderer.ytmusicMultiPageMenuRendererHost tp-yt-paper-item:hover {
  background: linear-gradient(rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.08)), rgba(var(--ytmusic-album-color, 100, 100, 100), 0.2) !important; 
  border-radius: 8px !important;
  color: white !important;
}

ytmusic-multi-page-menu-renderer.ytmusicMultiPageMenuRendererHost ytd-compact-link-renderer:hover * {
  color: white !important;
}

/* ============================================== */
/* MENU CÀI ĐẶT (SETTINGS CATEGORY MENU)          */
/* ============================================== */
tp-yt-paper-listbox.category-menu.ytmusic-settings-page {
  /* Đẩy khung menu rời khỏi viền của Settings cha để tạo hiệu ứng đảo nổi */
  margin: 16px !important;
  height: calc(100% - 32px) !important;
  
  border-radius: 12px !important;
  border: 1px solid rgba(255, 255, 255, 0.15) !important;
  /* Giữ lại shadow đẹp, khắc phục lỗi tràn bằng cách clip thẻ cha */
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.3) !important;
  overflow: hidden !important;
  box-sizing: border-box !important;
  padding: 8px 0 !important;
}

/* Sửa lỗi bóng râm của menu con bị tràn ra làm mất bo tròn (vuông góc) của khung Settings cha */
tp-yt-paper-dialog, ytmusic-settings-page {
  overflow: hidden !important;
  border-radius: 12px !important;
}

/* Xoá đường viền đen chia 2 bảng cài đặt */
ytmusic-setting-category-collection-renderer.ytmusic-settings-page {
  border-left: none !important;
  border-right: none !important;
}

/* Các item trong menu settings */
tp-yt-paper-item.category-menu-item.ytmusic-settings-page {
  margin: 2px 12px !important;
  width: auto !important;
  border-radius: 8px !important;
  background: transparent !important;
  transition: background 0.2s ease, color 0.2s ease !important;
  color: white !important;
}

/* Đổi màu chữ sang trắng để nổi trên nền kính */
tp-yt-paper-item.category-menu-item.ytmusic-settings-page yt-formatted-string,
tp-yt-paper-item.category-menu-item.ytmusic-settings-page yt-icon {
  color: white !important;
}

/* Hiệu ứng kính trắng khi hover hoặc đang được chọn (iron-selected) */
tp-yt-paper-item.category-menu-item.ytmusic-settings-page:hover,
tp-yt-paper-item.category-menu-item.ytmusic-settings-page.iron-selected {
  background: linear-gradient(rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.08)), rgba(var(--ytmusic-album-color, 100, 100, 100), 0.2) !important; 
  border-radius: 8px !important;
}

tp-yt-paper-item.category-menu-item.ytmusic-settings-page:hover *,
tp-yt-paper-item.category-menu-item.ytmusic-settings-page.iron-selected * {
  color: white !important;
}

/* Xoá nền trắng/xám mặc định của item */
ytmusic-multi-page-menu-renderer.ytmusicMultiPageMenuRendererHost tp-yt-paper-item {
  background: transparent !important;
}

/* Đổi màu chữ sang trắng để dễ đọc trên nền tối/kính */
ytmusic-multi-page-menu-renderer.ytmusicMultiPageMenuRendererHost yt-formatted-string,
ytmusic-multi-page-menu-renderer.ytmusicMultiPageMenuRendererHost yt-icon,
ytmusic-multi-page-menu-renderer.ytmusicMultiPageMenuRendererHost #account-name,
ytmusic-multi-page-menu-renderer.ytmusicMultiPageMenuRendererHost #channel-handle {
  color: white !important;
}

/* Làm mờ các đường kẻ phân cách */
ytmusic-multi-page-menu-renderer.ytmusicMultiPageMenuRendererHost yt-multi-page-menu-section-renderer {
  border-bottom: 1px solid rgba(255, 255, 255, 0.1) !important;
}
ytmusic-multi-page-menu-renderer.ytmusicMultiPageMenuRendererHost yt-multi-page-menu-section-renderer:last-child {
  border-bottom: none !important;
}

/* ============================================== */
/* MENU MUSIC TOGETHER (GLASSY THEME)             */
/* ============================================== */
/* Popup Outer Container */
.music-together-popup {
  z-index: 10000 !important;
  filter: drop-shadow(0 16px 36px rgba(0, 0, 0, 0.5));
}

/* Glassy Listbox Container */
.music-together-popup-container,
tp-yt-paper-listbox.music-together-popup-container {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.02)), rgba(var(--ytmusic-album-color-dark, 20, 20, 25), 0.75) !important;
  backdrop-filter: blur(28px) saturate(180%) !important;
  -webkit-backdrop-filter: blur(28px) saturate(180%) !important;
  border-radius: 16px !important;
  border: 1px solid rgba(255, 255, 255, 0.16) !important;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.15) !important;
  padding: 8px !important;
  color: #ffffff !important;
  overflow: hidden !important;
  min-width: 260px;
}

/* Status Card Glass Panel */
.music-together-status {
  background: rgba(255, 255, 255, 0.05) !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
  border-radius: 12px !important;
  padding: 14px !important;
  margin-bottom: 6px !important;
}

/* Status Container Flex Alignment */
.music-together-status-container {
  display: flex !important;
  align-items: center !important;
  gap: 12px !important;
}

/* User Avatar / Profile Image */
.music-together-profile {
  border-radius: 50% !important;
  border: 2px solid rgba(255, 255, 255, 0.25) !important;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3), 0 0 10px rgba(255, 255, 255, 0.1) !important;
  transition: transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1) !important;
  object-fit: cover !important;
}

.music-together-profile:hover {
  transform: scale(1.08) !important;
  border-color: rgba(255, 255, 255, 0.5) !important;
}

/* Status Text Items */
.music-together-status-item {
  display: flex !important;
  flex-direction: column !important;
  align-items: flex-start !important;
  gap: 3px !important;
  font-size: 13px !important;
  color: #ffffff !important;
}

/* Plugin Title Text */
.music-together-status-item pear-trans[key="plugins.music-together.name"] {
  font-weight: 700 !important;
  font-size: 14px !important;
  letter-spacing: 0.3px !important;
  color: #ffffff !important;
}

/* Disconnected / Status Badge */
#music-together-status-label {
  display: inline-block !important;
  padding: 2px 8px !important;
  border-radius: 10px !important;
  font-size: 11px !important;
  font-weight: 600 !important;
  background: rgba(255, 255, 255, 0.1) !important;
  color: rgba(255, 255, 255, 0.75) !important;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
  margin-top: 2px !important;
}

/* Permission Label Marquee */
#music-together-permission-label {
  margin-top: 4px !important;
  font-size: 11px !important;
  opacity: 0.85 !important;
}

#music-together-permission-label pear-trans {
  color: rgba(255, 255, 255, 0.75) !important;
}

/* Connected Users Block */
.music-together-user-container {
  padding-top: 8px !important;
  display: flex !important;
  align-items: center !important;
  gap: 8px !important;
}

.music-together-empty {
  width: 100% !important;
  font-size: 12px !important;
  color: rgba(255, 255, 255, 0.45) !important;
  font-style: italic !important;
  text-align: center !important;
  padding: 6px 10px !important;
  background: rgba(255, 255, 255, 0.03) !important;
  border-radius: 8px !important;
  border: 1px dashed rgba(255, 255, 255, 0.1) !important;
}

/* Glass Dividers */
.music-together-divider,
.music-together-divider.horizontal {
  height: 1px !important;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.15), transparent) !important;
  margin: 6px 0 !important;
  border: none !important;
}

/* Action Item Rows */
.music-together-item {
  display: flex !important;
  align-items: center !important;
  height: 42px !important;
  margin: 3px 0 !important;
  padding: 0 12px !important;
  border-radius: 10px !important;
  background: transparent !important;
  transition: background 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease !important;
  cursor: pointer !important;
  color: #ffffff !important;
}

/* Hover Glass Highlight */
.music-together-item:hover {
  background: linear-gradient(rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.12)), rgba(var(--ytmusic-album-color, 100, 100, 100), 0.25) !important;
  border-radius: 10px !important;
  transform: translateX(3px) !important;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2) !important;
}

/* Text inside action item */
.music-together-item .text,
.music-together-item .text.ytmusic-menu-service-item-renderer {
  font-size: 13.5px !important;
  font-weight: 500 !important;
  color: rgba(255, 255, 255, 0.9) !important;
  transition: color 0.2s ease !important;
}

.music-together-item:hover .text {
  color: #ffffff !important;
}

/* Icons inside action item */
.music-together-item .icon,
.music-together-item .icon.ytmusic-menu-service-item-renderer,
.music-together-item svg {
  margin-right: 10px !important;
  fill: rgba(255, 255, 255, 0.8) !important;
  color: rgba(255, 255, 255, 0.8) !important;
  transition: fill 0.2s ease, transform 0.2s ease !important;
}

.music-together-item:hover .icon svg,
.music-together-item:hover svg {
  fill: #ffffff !important;
  color: #ffffff !important;
  transform: scale(1.1) !important;
}

/* Topbar Button & Indicators */
.music-together-button {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  padding: 6px !important;
  border-radius: 50% !important;
  transition: background 0.2s ease, transform 0.2s ease !important;
}

.music-together-button:hover {
  background: rgba(255, 255, 255, 0.12) !important;
  transform: scale(1.05) !important;
}

.music-together-button svg {
  fill: rgba(255, 255, 255, 0.75) !important;
  transition: fill 0.2s ease !important;
}

.music-together-button:hover svg {
  fill: #ffffff !important;
}

.music-together-owner {
  border-radius: 50% !important;
  border: 1px solid rgba(255, 255, 255, 0.3) !important;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3) !important;
}

.music-together-name {
  color: rgba(255, 255, 255, 0.9) !important;
  font-size: 13px !important;
  font-weight: 500 !important;
}

/* ============================================== */
/* 5. KHUNG PLAYER & HIỆU ỨNG (PLAYER & EFFECTS)  */
/* ============================================== */
/* Xóa hiệu ứng fade đen */
#song-media-window,
.song-media-controls,
.ytp-gradient-top, 
.ytp-gradient-bottom {
    background: none !important;       
    background-image: none !important; 
    box-shadow: none !important;       
}

ytmusic-queue-header-renderer,
ytmusic-player-queue-item,
ytmusic-responsive-list-item-renderer,
ytmusic-carousel-shelf-renderer {
    padding-inline: 20px; /* Áp dụng 20px cho cả left và right */
}

/* Divider */
ytmusic-responsive-list-item-renderer.ytmusic-shelf-renderer,
.ytmusic-playlist-shelf-renderer {
  border-bottom: 0 !important;
}

/* Album Cover & Video Size & Rounding in Player Page */
ytmusic-player-page:not([player-fullscreened]):not([blyrics-dfs]):not([player-ui-state="MINIPLAYER"]) #player.ytmusic-player-page,
ytmusic-player[player-ui-state=FULLSCREEN],
ytmusic-player-page:not([player-fullscreened]) ytmusic-player {
  border-radius: var(--blyrics-border-radius, 2rem) !important;
  box-shadow: var(--blyrics-box-shadow) !important;
  overflow: hidden !important; 
  margin: 0 auto !important; 
  background: transparent !important;
}

/* Fix oversize cover — CHỈ áp dụng khi đang Fullscreen, không đụng tới chế độ cửa sổ hẹp */
ytmusic-player-page[player-fullscreened]:not([blyrics-video-mode]):not([video-mode]):not([blyrics-dfs])
#player.ytmusic-player-page {
  max-width: var(--blyrics-img-max-width, 576px) !important;
}

ytmusic-player-page {
  --yt-img-border-radius: 2rem;
}

/* Bo tròn khung Player khi chưa Fullscreen (Chỉ áp dụng trên container cha ytmusic-player để tránh lỗi đen video) */
ytmusic-player-page:not([player-fullscreened]) ytmusic-player {
  border-radius: 2rem !important;
  outline: 1px solid rgb(175 175 175 / 15%);
  overflow: hidden !important;
}

ytmusic-player-page ytmusic-player[is-music-web-player-page-layout-fixes-enabled]:not([is-mweb-modernization-enabled])[player-page-open] {
  border-radius: 2rem !important;
}

ytmusic-player-page img.yt-img-shadow:not(#song-image img) {
  border: 1px solid rgb(175 175 175 / 15%);
  box-sizing: border-box;
}

ytmusic-player-page yt-img-shadow[object-fit=CONTAIN] img.yt-img-shadow[width="56"] {
  --yt-img-border-radius: 1rem;
  border: 1px solid rgb(175 175 175 / 10%);
}

ytmusic-player-page yt-img-shadow[object-fit=CONTAIN] img.yt-img-shadow[width="32"] {
  --yt-img-border-radius: 0.5rem;
}

/* Fix nút chuyển Song/Video */
ytmusic-av-toggle,
.song-video-switching-controller {
  z-index: 9999 !important; 
  position: absolute !important;
  overflow: visible !important;
}

/* Fix Song/Video - misaligned to the right */
ytmusic-player-page:not([is-mweb-modernization-enabled])[player-fullscreened]:not([blyrics-dfs]) .av.ytmusic-player-page {
  position: relative !important; 
  width: fit-content !important;
  left: 0% !important;
  transform: translateX(-0%) translateY(150%)!important;
  padding: 15px !important;
}

#player.ytmusic-player-page .song-video-switching-controller {
    display: flex !important;
    visibility: visible !important;
}

/* STYLE: NÚT SONG/VIDEO (FIX RỚT DÒNG + FULLSCREEN) */
/* Khung chứa (Cái rãnh nền) */
.av-toggle.ytmusic-av-toggle {
    background-color: rgba(0, 0, 0, 0.4) !important; 
    border: 1px solid rgba(255, 255, 255, 0.1) !important;
    backdrop-filter: none !important; 
    border-radius: 999px !important;
    
    /* FIX LAYOUT: Cho phép rãnh co giãn thoải mái */
    width: auto !important; 
    max-width: none !important; /* Gỡ bỏ giới hạn chiều rộng nếu có */
    display: inline-flex !important; /* Đảm bảo nội dung nằm ngang */
}

/* Thiết lập chung cho nút bấm */
.av-toggle.ytmusic-av-toggle button {
    transition: all 0.2s ease-in-out !important;
    border-radius: 999px !important; 
    box-shadow: none !important;
    
    /* --- [QUAN TRỌNG] CHỐNG RỚT DÒNG --- */
    white-space: nowrap !important;  /* Ép chữ luôn nằm trên 1 dòng bất kể màn hình */
    word-break: keep-all !important; /* Không cho ngắt từ (Bài-hát) */
    flex-shrink: 0 !important;       /* Cấm nút bị co lại khi thiếu chỗ */
    
    /* Tinh chỉnh kích thước */
    padding: 0 16px !important; /* Thêm khoảng cách 2 bên chữ cho thoáng */
    min-width: auto !important; /* Bỏ giới hạn chiều rộng tối thiểu */
    width: auto !important;     /* Cho phép nút tự to ra theo độ dài chữ */
}

/* Trạng thái ĐANG CHỌN (Sáng đèn) */
.av-toggle.ytmusic-av-toggle button[aria-pressed="true"] {
    background-color: rgba(255, 255, 255, 0.2) !important; 
    color: #ffffff !important; 
    font-weight: 700 !important;
}

/* Trạng thái KHÔNG CHỌN (Chìm đi) */
.av-toggle.ytmusic-av-toggle button[aria-pressed="false"] {
    background-color: transparent !important; 
    color: rgba(255, 255, 255, 0.5) !important; 
}

/* Hiệu ứng Blur (Kính mờ) CHỈ ÁP DỤNG KHI FULLSCREEN */
ytmusic-player-page[player-fullscreened] .av-toggle.ytmusic-av-toggle {
    backdrop-filter: blur(12px) !important;
    -webkit-backdrop-filter: blur(12px) !important; /* Hỗ trợ thêm cho các trình duyệt lõi Chromium */
    background-color: rgba(0, 0, 0, 0.2) !important; /* Tùy chọn: Làm nền trong suốt hơn một chút để thấy rõ hiệu ứng blur */
}

ytmusic-player-expanding-menu,
#expanding-menu {
    /* Màu nền bán trong suốt (đen mờ 60%) */
    background: rgba(0, 0, 0, 0.6) !important;
    
    /* Bo góc và thêm viền mỏng cho nổi bật */
    border-radius: 8px !important;
    border: 1px solid rgba(255, 255, 255, 0.1) !important;
    
    /* Đổ bóng để tách biệt khỏi nền */
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5) !important;
}

/* HIỆU ỨNG MỞ/ĐÓNG PLAYER PAGE & MINIPLAYER */
/* Ép các lớp nền Blur (đang bị position: fixed) mờ đi cùng lúc */
ytmusic-app-layout:not([player-page-open]) ytmusic-player-page::before,
ytmusic-app-layout:not([player-page-open]) ytmusic-player-page[is-mweb-modernization-enabled] #main-panel::before {
  opacity: 0 !important;
}

ytmusic-app-layout:not([player-page-open]) [id*="-backdrop-"] {
  transform: translateY(6vh) !important;
}

/* 3. TRƯỢT CANVAS: Đây là linh hồn của hiệu ứng. Chỉ phần hình ảnh bị kéo xuống! */
ytmusic-app-layout:not([player-page-open]) [id^="better-lyrics-kawarp-"]:not([id*="-backdrop-"]) canvas {
  transform: translateY(4vh) !important;
  transition: transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1) !important;
}

ytmusic-player-page {
  transition: transform 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) !important;
}

.toggle-player-page-button {
  transition: transform 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) !important;
}

/* ============================================== */
/* PHẦN 6: SMOOTH TRANSITIONS & ANIMATIONS        */
/* ============================================== */

/* KEYFRAMES */
@keyframes mp-grow {
  0% {
    transform: translateY(40px) scale(0.3);
    opacity: 0;
  }
  100% {
    transform: translateY(0) scale(1);
    opacity: 1;
  }
}

@keyframes mp-shrink {
  0% {
    transform: scale(1.5); 
    opacity: 0.5;
  }
  100% {
    transform: translate3d(0, 0, 0) scale(1); 
    opacity: 1; 
  }
}

@keyframes blyrics-fullscreen-artwork {
  from {
    transform: scale(0.7);
    opacity: 0.85;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}

ytmusic-player[player-ui-state="FULLSCREEN"],
ytmusic-player-page[player-fullscreened] #player.ytmusic-player-page {
    animation: blyrics-fullscreen-artwork 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) 0.2s both !important;
    transform-origin: center center;
    will-change: transform, opacity;
}

ytmusic-player-page:not([is-mweb-modernization-enabled])[player-fullscreened]:not([blyrics-video-mode]):not([video-mode]) ytmusic-player:not([video-mode]) {
  border-radius: 2rem !important;
  --yt-img-border-radius: 2rem !important;
}

ytmusic-player-page:not([is-mweb-modernization-enabled])[player-fullscreened]:not([blyrics-dfs]) #player.ytmusic-player-page {
  box-shadow: rgba(0, 0, 0, 0.1) 0px 54px 55px, rgba(0, 0, 0, 0.06) 0px -12px 30px, rgba(0, 0, 0, 0.06) 0px 4px 6px, rgba(0, 0, 0, 0.09) 0px 12px 13px, rgba(0, 0, 0, 0.04) 0px -3px 5px !important;
}

@keyframes blyrics-song-info-slide {
  from {
    transform: translateY(0);
    opacity: 0;
  }
  to {
    transform: translateY(-64px);
    opacity: 1;
  }
}

ytmusic-player-page:not([is-mweb-modernization-enabled])[player-fullscreened]:not([blyrics-dfs]) #blyrics-song-info {
  text-align: left;
  width: 100%;
  max-width: var(--blyrics-img-max-width, 576px);
  padding: 2rem;
  margin-bottom: 8rem;
  outline: 1px dashed rgb(255 255 255 / 15%);
  border-radius: 2rem !important;
  z-index: -1;
  background: rgba(var(--ytmusic-album-color-dark, 20, 20, 20), 0.5) !important;
  box-sizing: border-box;
  box-shadow: rgba(0, 0, 0, 0.1) 0px 20px 20px 0px;
  animation: blyrics-song-info-slide 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) 0.1s both;
}

ytmusic-player-page:not([is-mweb-modernization-enabled])[player-fullscreened][video-mode]:not([blyrics-dfs]) #blyrics-song-info {
  max-width: unset;
}

#blyrics-song-info > p#blyrics-title {
  font-size: 2.5rem;
  color: color(display-p3 1 1 1);
}

#blyrics-song-info > p#blyrics-artist {
  color: color(display-p3 1 1 1 / 0.5);
  opacity: 1;
}

ytmusic-player-page[player-fullscreened]:not([blyrics-video-mode]):not([blyrics-dfs]):has(.blyrics-container[data-no-lyrics="true"]) #blyrics-song-info {
  max-width: 500px !important;
}

/* TRẠNG THÁI MỞ PLAYER BÌNH THƯỜNG */
ytmusic-player-page[player-page-open]:not([player-fullscreened]) #player.ytmusic-player-page {
    animation: mp-grow 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) !important;
    transition: none !important; 
    will-change: transform, opacity;
}

/* TRẠNG THÁI THU NHỎ XUỐNG MINIPLAYER */
/* Đã thêm :not([player-fullscreened]) để chặn đứng hiệu ứng này khi bấm Fullscreen */
ytmusic-player-page[mini-player-enabled]:not([player-page-open]):not([player-fullscreened]) #player.ytmusic-player-page {
    animation: mp-shrink 0.5s cubic-bezier(0.4, 0, 0.2, 1) !important;
    transition: none !important; 
    will-change: transform, opacity;
}

/* ============================================== */
/* 6. STYLE PHẦN LYRIC (LYRICS & SIDE PANEL)      */
/* ============================================== */
/* Side Panel - Khung Lyric Kính */
#side-panel {
  background-color: var(--blyrics-bg-color) !important;
  border-radius: var(--blyrics-border-radius) !important;
  box-shadow: var(--blyrics-box-shadow) !important;
  min-width: var(--side-panel-width) !important;
  z-index: 1; 
  
  margin-bottom: var(--blyrics-bottom-spacing) !important;
  height: auto !important;
  max-height: calc(100vh - 120px) !important; 
}

/* STYLE LYRIC */
.blyrics-container {
  padding-left: 20px;
  padding-right: 20px;
  position: relative;
  z-index: 2;
  text-align: left;
  overflow-y: auto; 
  overflow-x: hidden;
}

.blyrics-container > div {
  opacity: 0.2;
  margin-bottom: 20px;
  transition: opacity 0.7s ease-out, 
              filter 0.7s ease-out,
              transform 1.3s ease-out;
  white-space: pre-wrap; 
  word-break: break-word; 
  overflow-wrap: break-word;
  max-width: 100%;
}

/* downwards blurring */
/* credit to Apple Music theme by tposejank, but some custom has been made for this to work properly */

/* 1 line below */
.blyrics-container:not(.blyrics-user-scrolling)>.blyrics--active+.blyrics--line:not(.blyrics--animating) {
  filter: blur(2px) !important;
}

/* 2 lines below */
.blyrics-container:not(.blyrics-user-scrolling)>.blyrics--active+.blyrics--line+.blyrics--line:not(.blyrics--animating) {
  filter: blur(3.5px) !important;
}

/* 3 line below */
.blyrics-container:not(.blyrics-user-scrolling)>.blyrics--active+.blyrics--line+.blyrics--line+.blyrics--line:not(.blyrics--animating) {
  filter: blur(5px) !important;
}

/* 4 lines below */
.blyrics-container:not(.blyrics-user-scrolling)>.blyrics--active+.blyrics--line+.blyrics--line+.blyrics--line+.blyrics--line:not(.blyrics--animating) {
  filter: blur(6.5px) !important;
}

/* 5 lines below */
.blyrics-container:not(.blyrics-user-scrolling)>.blyrics--active+.blyrics--line+.blyrics--line+.blyrics--line+.blyrics--line+.blyrics--line:not(.blyrics--animating) {
  filter: blur(8px) !important;
}

/* 6 lines below */
.blyrics-container:not(.blyrics-user-scrolling)>.blyrics--active+.blyrics--line+.blyrics--line+.blyrics--line+.blyrics--line+.blyrics--line+.blyrics--line:not(.blyrics--animating) {
  filter: blur(9.5px) !important;
}

/* past lines: .blyrics--gf-behind thay cho :has(~ .blyrics--active).
   Class được stamp bởi PAST-LINE MARKER ở cuối file, đúng tập hợp mà :has()
   cũ chọn và đúng thời điểm .blyrics--active đổi. Lý do đổi: xem comment ở
   setupPastLineMarker() — :has() có argument khớp .blyrics--active đo được
   amplification 474-1060x mỗi lần dòng active nhảy.

   Các transition shorthand ở những rule này đã bị bỏ: chúng viết
   var((--blyrics-anim-delay, 0s) - 0.3s), mà "var((" là syntax sai →
   Blink drop cả declaration. Chúng chưa từng có tác dụng; transition thật
   của dòng past đến từ rule base. */

/* past lines (non-fullscreen): chỉ blur nhẹ, không biến mất */
.blyrics-container:not(.blyrics-user-scrolling)>.blyrics--line.blyrics--gf-behind:not(.blyrics--animating) {
  filter: blur(6px);
}

/* past lines (fullscreen): ẩn ngay khi dòng đã hát xong.
   Một rule duy nhất trên .blyrics--gf-behind. Trước đây ở đây có 3 rule: một
   rule giữ opacity 1 cho .blyrics--gf-behind:not(.blyrics--gf-past), một rule
   ẩn theo .blyrics--gf-past, và một rule fallback theo :not(.blyrics--gf-managed).
   gf-past do glassyflow stamp theo đợt scroll nên tới TRỄ hơn gf-behind, và
   khoảng trễ đó chính là lúc dòng vừa hát xong còn sáng nguyên. gf-behind
   stamp ngay khi .blyrics--active đổi và có mặt dù engine scroll nào đang chạy
   hay không, nên nó phủ đúng cả 3 trường hợp. */
ytmusic-player-page[player-fullscreened] .blyrics-container:not(.blyrics-user-scrolling)>.blyrics--line.blyrics--gf-behind:not(.blyrics--animating) {
  opacity: 0;
  filter: blur(5px);
}

/* ===== NO-SYNC MODE: Tắt blur khi lyrics tĩnh/không có sync ===== */
.blyrics-container.blyrics--no-sync > div {
  opacity: 1 !important;
  filter: blur(0px) !important;
  transform: none !important;
  transition: opacity 0.5s ease-out, filter 0.5s ease-out !important;
}

/* Animation chuyển từ no-sync (rõ) sang sync (blur) mượt mà */
@keyframes blyricsBlurIn {
  from {
    opacity: 1;
    filter: blur(0px);
  }
  to {
    opacity: 0.2;
    filter: blur(6px);
  }
}

.blyrics-container.blyrics--entering-sync > div:not(.blyrics--animating) {
  animation: blyricsBlurIn 0.7s ease-out forwards !important;
}

.blyrics-container > div > span {
  display: inline;
  filter: drop-shadow(0 0 5px rgba(255, 255, 255, 0.5));
}

/* Active Lyric Animation */
.blyrics-container > div.blyrics--animating:not(:empty):not(.blyrics--translated):not(.blyrics--romanized) {
  opacity: 1;
  filter: blur(0px) !important;
  transform: scale(1.02);
  
  transition: opacity 0.7s ease calc(var(--blyrics-anim-delay, 0s) - 0.3s), 
              filter 0.7s ease calc(var(--blyrics-anim-delay, 0s) - 0.3s),
              transform 1.3s ease calc(var(--blyrics-anim-delay, 0s) - 0.3s);
}

/* Translated & Romanized */
.blyrics-container > div > span.blyrics--translated,
.blyrics-container > div > span.blyrics--romanized {
  display: block;
  margin-top: 10px;
  color: #ddd;
}

.blyrics-container > div > span.blyrics--translated {
  font-size: 1.8rem;
  font-weight: 400;
}

.blyrics-container > div > span.blyrics--romanized {
  font-size: 1.5rem;
  font-style: italic;
  opacity: 0.8;
}

/* FULLSCREEN MODE FIXES */
/* Xóa bỏ hiệu ứng kính và mở rộng tối đa không gian của side-panel */
ytmusic-player-page[player-fullscreened] #side-panel {
  background: transparent !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
  border: none !important;
  
  /* Bổ sung: Xóa khoảng trống bên ngoài và giới hạn chiều cao */
  max-height: none !important; 
  height: 100% !important;
  padding-top: 65px !important;
}

/* RESPONSIVE */
.blyrics-user-scrolling > div:not(.blyrics--animating) {
  opacity: 1 !important;
  filter: blur(0px) !important; 
  transition: opacity 0.4s ease, filter 0.4s ease;
}

@media (max-width: 1000px) {
  :root {
    --blyrics-font-size: 3.5rem;
    --side-panel-width: 45%;
  }
}

@media (max-width: 615px) {
  .blyrics-container {
    font-size: 2rem;
  }
  .blyrics-container > div > span.blyrics--translated {
    font-size: 1.5rem;
  }
}

/* ============================================== */
/* 7. NÚT BẤM, TABS & DANH SÁCH (UI COMPONENTS)   */
/* ============================================== */
/* NÚT BẤM VÀ CÁC THÀNH PHẦN NỔI BẬT KHÁC */
/* Nút Tạo Playlist mới */
.yt-spec-button-shape-next--mono.yt-spec-button-shape-next--tonal {
  background: rgba(255, 255, 255, 0.1);
  border: transparent;
  color: white;
  border-radius: 16px;
}
.yt-spec-button-shape-next--mono.yt-spec-button-shape-next--tonal:hover {
  background: rgba(255, 255, 255, 0.2);
}
.yt-spec-button-shape-next--mono.yt-spec-button-shape-next--tonal .yt-icon-shape {
  color: white;
}

/* Nút trượt danh sách (Carousel Buttons) */
yt-icon-button.ytmusic-carousel-shelf-renderer,
.yt-spec-button-shape-next--mono.yt-spec-button-shape-next--outline {
  background: rgba(255, 255, 255, 0.1);
  border: transparent;
  color: white;
  border-radius: 16px;
}
yt-icon-button.ytmusic-carousel-shelf-renderer:hover,
.yt-spec-button-shape-next--mono.yt-spec-button-shape-next--outline:hover {
  background: rgba(255, 255, 255, 0.2);
}

/* Nút Play to trên bìa Album ở Trang chủ */
ytmusic-play-button-renderer[size="MUSIC_PLAY_BUTTON_SIZE_HUGE"] {
  --ytmusic-play-button-size: 40px;
  --ytmusic-play-button-icon-size: 24px;
}
ytmusic-play-button-renderer[size="MUSIC_PLAY_BUTTON_SIZE_HUGE"] .content-wrapper {
  background: rgba(0,0,0,0.6);
  opacity: 0;
}
ytmusic-item-thumbnail-overlay-renderer:hover ytmusic-play-button-renderer[size="MUSIC_PLAY_BUTTON_SIZE_HUGE"] .content-wrapper {
  opacity: 1;
}
ytmusic-play-button-renderer[size="MUSIC_PLAY_BUTTON_SIZE_HUGE"] .content-wrapper:hover {
  background: black;
}
ytmusic-play-button-renderer[size="MUSIC_PLAY_BUTTON_SIZE_HUGE"]:is([state="paused"], [state="playing"]) .content-wrapper {
  opacity: 1;
}

.thumbnail-overlay.ytmusic-two-row-item-renderer[content-position="MUSIC_ITEM_THUMBNAIL_OVERLAY_CONTENT_POSITION_CENTERED"] #content {
  align-items: end;
  justify-content: right;
  bottom: 12px;
  right: 12px;
}

yt-img-shadow[object-fit="CONTAIN"] img,
.thumbnail-overlay {
  border-radius: 8px;
  object-fit: cover !important;
  overflow: hidden;
}

/* Bo góc cho toàn bộ khung ảnh Album/Playlist ở Trang chủ */
ytmusic-two-row-item-renderer .image-wrapper,
ytmusic-responsive-list-item-renderer[play-button-state] {
  border-radius: 16px; /* Bạn có thể đổi thành 8px hoặc 12px tùy sở thích */
  overflow: hidden;
}

/* Trả lại hiệu ứng fade mượt cho toàn bộ overlay mặc định của YouTube */
ytmusic-item-thumbnail-overlay-renderer {
  transition: opacity 0.3s ease !important;
}

/* Logic gốc: Ép tàng hình nền đen của bài ĐANG PHÁT (khi không di chuột) */
ytmusic-item-thumbnail-overlay-renderer:not([play-button-state="default"]) #background.ytmusic-item-thumbnail-overlay-renderer {
  opacity: 0 !important;
}

/* Logic gốc: Hiện lại nền đen của bài ĐANG PHÁT khi di chuột vào */
ytmusic-item-thumbnail-overlay-renderer:not([play-button-state="default"]):hover #background.ytmusic-item-thumbnail-overlay-renderer {
  opacity: 1 !important;
}

/* Logic gốc: Lớp nền đen bo tròn bao quanh cái nút Play bự ở Trang chủ */
ytmusic-play-button-renderer[size="MUSIC_PLAY_BUTTON_SIZE_HUGE"] .content-wrapper {
  background: rgba(0, 0, 0, 0.6);
  opacity: 0;
  transition: opacity 0.3s ease, background 0.3s ease;
}

ytmusic-item-thumbnail-overlay-renderer #background.ytmusic-item-thumbnail-overlay-renderer {
  transition: opacity 0.3s ease !important;
}

ytmusic-item-thumbnail-overlay-renderer:hover ytmusic-play-button-renderer[size="MUSIC_PLAY_BUTTON_SIZE_HUGE"] .content-wrapper {
  opacity: 1;
}
ytmusic-play-button-renderer[size="MUSIC_PLAY_BUTTON_SIZE_HUGE"] .content-wrapper:hover {
  background: black;
}
ytmusic-play-button-renderer[size="MUSIC_PLAY_BUTTON_SIZE_HUGE"]:is([state="paused"], [state="playing"]) .content-wrapper {
  opacity: 1;
}

/* Thêm hiệu ứng mượt và phóng to nhẹ cho chính nút Play */
ytmusic-play-button-renderer[size="MUSIC_PLAY_BUTTON_SIZE_HUGE"] .content-wrapper,
#play-button .content-wrapper.ytmusic-play-button-renderer {
  transition: opacity 0.3s ease, background 0.3s ease, transform 0.3s ease;
}

/* Hiệu ứng phóng to nút Play lên 1 chút khi hover giống hệt bản gốc */
#play-button .content-wrapper.ytmusic-play-button-renderer:hover {
  transform: scale(1.2);
}

ytmusic-tabs#tabs {
    /* Thu gọn và căn giữa (Giữ nguyên của bạn) */
    width: 50% !important;  
    margin: 10px auto 0 auto !important;      
    top: calc(var(--menu-bar-height, 0px) + 100px) !important;

    /* Bo tròn và padding (Giữ nguyên) */
    border-radius: 16px !important; 
    padding-left: 30px;
    padding-top: 10px;
    padding-bottom: 10px;

    /* --- PHẦN ĐỒNG BỘ MÀU (SYNC COLOR) --- */

    /* 1. Đổi nền đen thành màu tối của bài hát (giảm độ đậm xuống 0.5 hoặc 0.6 cho trong trẻo) */
    background-color: rgba(var(--ytmusic-album-color-dark), 0.5) !important; 

    /* 2. Giữ nguyên hiệu ứng mờ */
    backdrop-filter: blur(12px) !important; 
    -webkit-backdrop-filter: blur(12px) !important; 

    /* 3. Bóng đổ bốc lên màu bài hát (tăng độ nhòe từ 16px lên 24px để glow đẹp hơn) */
    box-shadow: 0 8px 24px rgba(var(--ytmusic-album-color-dark), 0.6) !important; 

    /* 4. (Khuyên dùng) Thêm một đường viền kính siêu mỏng để thanh tab trông sắc sảo hơn */
    border: 1px solid rgba(255, 255, 255, 0.1) !important; 
}

/* Xóa nốt viền xám ở container bên trong (nếu có) */
ytmusic-tabs#tabs .tab-container {
    border-bottom: none !important; 
}

ytmusic-tabs#tabs .tab-container {
    display: flex !important;           /* Đảm bảo hộp con sử dụng bố cục linh hoạt Flexbox */
    justify-content: center !important; /* Đẩy tất cả các phần tử bên trong ra chính giữa */
    width: 100% !important;             /* Bắt buộc hộp con giãn nạp đầy 70% chiều rộng của thanh tab tổng */
}

/* Tắt thanh gạch chân chạy qua chạy lại mặc định của YouTube Music */
ytmusic-tabs#tabs tp-yt-paper-tabs-selection-bar,
ytmusic-tabs#tabs .selection-bar {
    display: none !important; 
}

/* Style cho Tab ĐANG ĐƯỢC CHỌN (Nổi bật) */
ytmusic-tabs#tabs .tab.selected,
ytmusic-tabs#tabs .tab[aria-selected="true"] {
    border-bottom: none !important; /* Đảm bảo xóa sạch gạch chân */
    background-color: rgba(255, 255, 255, 0.15) !important; /* Nền trắng hơi mờ nhẹ */
    border-radius: 10px !important; /* Bo tròn các góc của tab */
    color: #ffffff !important; /* Chữ trắng sáng */
    font-weight: 700 !important; /* In đậm chữ */
    text-shadow: 0 0 10px rgba(255, 255, 255, 0.4) !important; /* Chữ phát sáng nhẹ */
    padding: 8px 20px !important; /* Tăng khoảng trống trong nút cho cân đối */
    margin: 0 4px !important; /* Cách nhẹ hai tab ra với nhau */
    transition: all 0.3s ease !important; /* Hiệu ứng chuyển đổi mượt mà */
}

/* Style cho Tab BÌNH THƯỜNG (Chưa được chọn) */
ytmusic-tabs#tabs .tab:not(.selected) {
    color: rgba(255, 255, 255, 0.5) !important; /* Chữ mờ đi để nhường sân khấu cho tab đang chọn */
    font-weight: 500 !important;
    padding: 8px 20px !important;
    margin: 0 4px !important;
    transition: all 0.3s ease !important;
}

/* Hiệu ứng khi lướt chuột qua Tab bình thường */
ytmusic-tabs#tabs .tab:not(.selected):hover {
    background-color: rgba(255, 255, 255, 0.08) !important; /* Sáng nhẹ lên khi di chuột */
    border-radius: 10px !important;
    color: #ffffff !important;
}

/* CĂN CHỈNH CHO THANH TAB BÊN TRONG SIDE-PANEL (UP NEXT, LYRICS, RELATED) */
ytmusic-player-page tp-yt-paper-tabs.tab-header-container {
    background-color: rgba(0, 0, 0, 0.2) !important;
    border-radius: 12px !important;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3) !important; /* Đã trả lại box-shadow mềm mại để có cảm giác nổi */
    margin: 12px 20px !important;
  padding: 0 6px !important;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
    border: 1px solid rgba(255, 255, 255, 0.1) !important;
    min-height: 48px !important;
    display: flex !important;
    align-items: center !important;
    position: relative !important;
    container-type: inline-size !important;
}

/* Tắt thanh gạch ngang dưới chữ */
ytmusic-player-page tp-yt-paper-tabs.tab-header-container #selectionBar {
    display: none !important;
}

/* Canh giữa khối tab theo trục dọc để không bị lệch lên */
ytmusic-player-page tp-yt-paper-tabs.tab-header-container #tabsContainer,
ytmusic-player-page tp-yt-paper-tabs.tab-header-container #tabsContent {
  height: 100% !important;
  display: flex !important;
  align-items: center !important;
}

/* Giữ cụm tab dồn về trái, chừa chỗ cho footer nằm bên phải */
ytmusic-player-page tp-yt-paper-tabs.tab-header-container #tabsContent {
  justify-content: flex-start !important;
}

/* Giới hạn lại kích cỡ và khoảng cách của từng tab nhỏ */
ytmusic-player-page tp-yt-paper-tabs.tab-header-container tp-yt-paper-tab.tab-header {
    flex: 0 0 auto !important;
    margin: 0 4px !important;
    padding: 0 16px !important;
    height: 36px !important;
    display: flex !important; /* Thêm Flex để kéo text... */
    align-items: center !important; /* ...và canh giữa theo chiều dọc */
    justify-content: center !important; /* Canh đều theo chiều ngang */
  position: relative !important;
  top: 1px !important;
}

/* Canh giữa chính phần chữ trong từng tab */
ytmusic-player-page tp-yt-paper-tabs.tab-header-container tp-yt-paper-tab.tab-header .tab-content {
  height: 100% !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  line-height: 1 !important;
  padding: 0 !important;
}

/* Style cho Tab đang chọn (Up Next, Lyrics, Related) */
ytmusic-player-page tp-yt-paper-tabs.tab-header-container tp-yt-paper-tab.tab-header.iron-selected {
    background-color: rgba(255, 255, 255, 0.15) !important;
    border-radius: 8px !important;
    color: #ffffff !important;
    font-weight: 700 !important;
    text-shadow: 0 0 10px rgba(255, 255, 255, 0.4) !important;
    transform: scale(1.02) !important;
    transition: all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) !important;
}

/* Style cho Tab bình thường */
ytmusic-player-page tp-yt-paper-tabs.tab-header-container tp-yt-paper-tab.tab-header:not(.iron-selected) {
    color: rgba(255, 255, 255, 0.6) !important;
    font-weight: 500 !important;
    border-radius: 8px !important;
    transition: all 0.3s ease !important;
}

/* Hover cho Tab bình thường */
ytmusic-player-page tp-yt-paper-tabs.tab-header-container tp-yt-paper-tab.tab-header:not(.iron-selected):hover {
    background-color: rgba(255, 255, 255, 0.05) !important;
    color: #ffffff !important;
}

/* Dock footer Better Lyrics lên thanh tab và neo sang phải */
ytmusic-player-page tp-yt-paper-tabs.tab-header-container .nankill-blyrics-footer-in-tabs,
ytmusic-player-page tp-yt-paper-tabs.tab-header-container .blyrics-footer__container {
  position: absolute !important;
  right: 8px !important;
  top: 50% !important;
  transform: translateY(-50%) !important;
  margin-left: 0 !important;
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 8px !important;
  height: 32px !important;
  padding: 0 14px !important;
  border-radius: 8px !important;
  background: rgba(255, 255, 255, 0.08) !important;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
  font-size: 13px !important;
  font-weight: 600 !important;
  line-height: 1.1 !important;
  color: rgba(255, 255, 255, 0.78) !important;
  white-space: nowrap !important;
  width: fit-content !important;
  min-width: 180px !important;
  max-width: 360px !important;
  overflow: hidden !important;
  opacity: 0.9;
  z-index: 3 !important;
  will-change: width, padding;
  transition: width 0.3s cubic-bezier(0.25, 0.8, 0.25, 1), 
              padding 0.3s cubic-bezier(0.25, 0.8, 0.25, 1),
              background-color 0.3s ease,
              box-shadow 0.3s ease !important;
}

ytmusic-player-page tp-yt-paper-tabs.tab-header-container .nankill-blyrics-footer-in-tabs a,
ytmusic-player-page tp-yt-paper-tabs.tab-header-container .blyrics-footer__container a {
  color: rgba(255, 255, 255, 0.9) !important;
  text-decoration: none !important;
  font-size: inherit !important;
  line-height: 1.1 !important;
  overflow: hidden;
  text-overflow: ellipsis;
}

ytmusic-player-page tp-yt-paper-tabs.tab-header-container .nankill-blyrics-footer-in-tabs img,
ytmusic-player-page tp-yt-paper-tabs.tab-header-container .blyrics-footer__container img {
  width: 18px !important;
  height: 18px !important;
  border-radius: 4px;
  flex-shrink: 0;
}

.thumbnail-image-wrapper {
  /* Bo tròn các góc */
  border-radius: 12px; /* Bạn có thể tăng giảm số này, hoặc dùng 50% nếu muốn hình tròn hoàn toàn */
  /* Đảm bảo ảnh bên trong không bị tràn ra ngoài phần góc đã bo */
  overflow: hidden; 
  /* Đổ bóng để tạo cảm giác nổi lên */
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2); 
}

ytmusic-comments.ytmusicCommentsComponentHost {
    padding-inline: 24px; /* Thay đổi thông số này theo thiết kế của bạn */
}
/* ============================================== */
/* 8. MENU & HỘP THOẠI (POPUPS, MENUS, DIALOGS)   */
/* ============================================== */
/* KEYFRAMES */
@keyframes menuFadeIn {
  0% {
    opacity: 0;
    margin-top: -10px; /* Trượt nhẹ từ trên xuống */
  }
  100% {
    opacity: 1;
    margin-top: 0;
  }
}

/* Divider */
ytmusic-responsive-list-item-renderer.ytmusic-shelf-renderer,
.ytmusic-playlist-shelf-renderer {
  border-bottom: 0 !important;
}

ytmusic-message-renderer {
  .text.ytmusic-message-renderer {
    color: white !important;
  }
  .yt-icon-shape {
    color: white !important;
  }
}

/* Container của Menu 3 chấm */
tp-yt-iron-dropdown.ytmusic-popup-container {
  background-color: rgba(var(--ytmusic-album-color-dark), 0.3) !important;
  backdrop-filter: blur(15px);
  border-radius: 24px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  border: transparent;
  overflow: hidden;
  
  /* THÊM DÒNG NÀY: Kích hoạt hiệu ứng xuất hiện trong 0.2 giây */
  animation: menuFadeIn 0.4s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
}

/* Ép nền bên trong menu trong suốt để thấy được hiệu ứng kính bên ngoài */
tp-yt-paper-listbox.ytmusic-menu-popup-renderer {
  background: transparent;
  border: 0;
}

/* Gộp cả 6 loại bảng vào chung một thuộc tính */
tp-yt-paper-dialog:has(ytmusic-add-to-playlist-renderer),
tp-yt-paper-dialog:has(ytmusic-unified-share-panel-renderer),
ytmusic-dialog,
ytmusic-engagement-panel-section-list-renderer,
tp-yt-paper-dialog:has(yt-confirm-dialog-renderer),
tp-yt-paper-dialog:has(ytmusic-dismissable-dialog-renderer) {
  /* Nền đen trong suốt & hiệu ứng mờ */
  background-color: rgba(var(--ytmusic-album-color-dark), 0.3) !important;
  backdrop-filter: blur(15px) !important;
  -webkit-backdrop-filter: blur(15px) !important;
  
  /* Viền và khối 3D */
  border: 1px solid rgba(var(--ytmusic-album-color), 0.2) !important;
  border-radius: 16px !important;
  box-shadow: 0 15px 40px rgba(var(--ytmusic-album-color-dark), 0.5) !important;
  
  /* Ép bảng luôn nằm giữa màn hình (ghi đè inline CSS của YouTube) */
  position: fixed !important;
  top: 50% !important;
  left: 50% !important;
  margin: 0 !important; /* Xóa margin thừa nếu có */

  /* Gọi animation xuất hiện */
  animation: popupXuatHien 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) forwards !important;
}

ytmusic-add-to-playlist-renderer #actions {
  border-top: none !important; 
}

/* Remove background share popup*/
#bar.yt-copy-link-renderer {
  background: rgba(255, 255, 255, 0.1);
  border: transparent;
}
#checkbox.tp-yt-paper-checkbox {
  border-color: rgba(255, 255, 255, 0.1) !important;
  background: rgba(255, 255, 255, 0.1) !important;
  --paper-checkbox-checked-color: rgba(255, 255, 255, 0.1) !important;
}
#checkmark.tp-yt-paper-checkbox {
  border-color: white !important;
}
ytmusic-engagement-panel-title-header-renderer #header {
  border-bottom: 1px solid rgba(255, 255, 255, 0.1) !important; /* Tạo đường kẻ mờ ngăn cách header */
  background: transparent !important;
}
.yt-spec-button-shape-next--call-to-action.yt-spec-button-shape-next--filled {
color: white;
background: rgba(255, 255, 255, 0.1);
border-radius: 16px;
hover background: rgba(255, 255, 255, 0.2);
}
.scroll-button.yt-third-party-share-target-section-renderer {
background: rgba(255, 255, 255, 0.1);
backdrop-filter: blur(10px);
box-shadow: none;
}
.scroll-button.yt-third-party-share-target-section-renderer .yt-icon-shape{
color: white;
}
yt-formatted-string.yt-start-at-renderer{
color: rgba(255, 255, 255, 0.7);
}

/* Animation xuất hiện */
@keyframes popupXuatHien {
  0% {
    opacity: 0;
    transform: translate(-50%, -45%) scale(0.95);
  }
  100% {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
}

/* Sửa nền của mục đang được chọn bên menu trái */
tp-yt-paper-item.category-menu-item.iron-selected {
  background-color: rgba(255, 255, 255, 0.15) !important; /* Trắng mờ 15% */
}

/* (Tùy chọn) Chỉnh luôn hiệu ứng khi di chuột qua các mục khác cho đồng bộ */
tp-yt-paper-item.category-menu-item:hover {
  background-color: rgba(255, 255, 255, 0.08) !important; 
}

/* Áp dụng nền kính mờ cho các hộp thoại thả xuống (Quyền riêng tư, Chất lượng âm thanh, Ngôn ngữ...) */
tp-yt-iron-dropdown .dropdown-content {
  background-color: rgba(15, 15, 15, 0.6) !important;
  backdrop-filter: blur(15px) !important;
  -webkit-backdrop-filter: blur(15px) !important;
  
  /* Thêm viền mỏng và shadow */
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
  border-radius: 12px !important; /* Bo góc 12px cho menu nhỏ nhắn hơn */
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5) !important;
  color: rgba(255, 255, 255, 0.9) !important;
  
  /* Animation nhẹ khi mở thẻ */
  animation: menuFadeIn 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) forwards !important;
}

/* Đảm bảo paper-listbox bên trong trong suốt để không đè lên hiệu ứng kính mờ của khung ngoài */
tp-yt-iron-dropdown tp-yt-paper-listbox.dropdown-content {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
}

/* Đảm bảo màu chữ trong các dropdown của Settings luôn trắng (nhất là thẻ span bên trong) */
tp-yt-iron-dropdown tp-yt-paper-listbox tp-yt-paper-item,
tp-yt-iron-dropdown tp-yt-paper-listbox tp-yt-paper-item span.ytmusic-setting-single-option-menu-renderer {
  color: #fff !important;
  font-family: 'Inter', 'Roboto', sans-serif !important;
}

/* Hiệu ứng sáng lên khi di chuột qua (Hover) */
tp-yt-paper-listbox ytmusic-dropdown-item-renderer:hover,
tp-yt-paper-listbox tp-yt-paper-item.menu-item:hover {
  background-color: rgba(255, 255, 255, 0.1) !important;
  transition: background-color 0.2s ease !important;
  border-radius: 8px !important; /* Bo tròn xíu cho các item được hover */
}

/* Hiệu ứng sáng hơn một chút cho mục đang được chọn (Selected) */
tp-yt-paper-listbox ytmusic-dropdown-item-renderer.iron-selected,
tp-yt-paper-listbox tp-yt-paper-item.menu-item.iron-selected {
  background-color: rgba(255, 255, 255, 0.15) !important;
  border-radius: 8px !important;
  font-weight: 600 !important;
}

/* Bỏ viền outline xấu xí khi click vào mục menu */
tp-yt-paper-listbox tp-yt-paper-item:focus {
  outline: none !important;
}

tp-yt-paper-item:focus:before {
  border-radius: 8px !important;
}

/* Hiệu ứng khi di chuột qua các mục chọn (Highlight) */
ytmusic-multi-select-menu-item-renderer:hover {
  background-color: rgba(255, 255, 255, 0.08) !important;
}

/* ============================================== */
/* 9. TRANG ĐẶC BIỆT (ARTIST, PODCAST PAGES)      */
/* ============================================== */
/* ========================== ARTIST PAGE ========================== */

ytmusic-immersive-header-renderer {
  background: var(--ytmusic-app); /* Biến mặc định của YT Music, giữ nguyên để không lỗi giao diện web */
}

/* Kéo toàn bộ thẻ bao ngoài lên trên để lấp khoảng trống do --menu-bar-height tạo ra */
ytmusic-immersive-header-renderer,
ytmusic-visual-header-renderer {
    margin-top: calc(var(--menu-bar-height, 0px) * -1) !important;
}

ytmusic-immersive-header-renderer .image {
  margin-left: 0 !important;
  opacity: 0.8;
  filter: brightness(0.95);
}

.description.ytmusic-immersive-header-renderer {
  color: white;
}

ytmusic-toggle-button-renderer yt-formatted-string.ytmusic-toggle-button-renderer {
  color: white;
}

ytmusic-immersive-header-renderer[is-description-expanded] .image {
  filter: brightness(0.55);
}

/* Artist Header */
.image.ytmusic-immersive-header-renderer {
  mask-image: linear-gradient(to bottom, black 60%, transparent 100%);
  mask-repeat: no-repeat;
  mask-size: 100%;
}

/* Sub Button */
ytmusic-subscribe-button-renderer {
  --ytmusic-subscribe-button-outline-color: transparent;
  --ytmusic-subscribe-button-color: white;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 16px;
  backdrop-filter: blur(10px);
  border: transparent;
}

ytmusic-subscribe-button-renderer:hover {
  background: rgba(255, 255, 255, 0.4);
}

ytmusic-subscribe-button-renderer[is-subscribed] {
  --ytmusic-subscribe-button-outline-color: transparent;
  --ytmusic-subscribe-button-color: white;
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  border: transparent;
}

ytmusic-subscribe-button-renderer[is-subscribed]:hover {
  background: rgba(255, 255, 255, 0.2);
}

/* Unsub Confirm */
yt-confirm-dialog-renderer[dialog][dialog][dialog] {
  --ytd-user-comment-color: white;
  background: transparent;
}

ytmusic-popup-container tp-yt-paper-dialog.ytmusic-popup-container[role=dialog] {
  outline: none !important;
}

/* Shuffle and Radio Button */
.yt-spec-button-shape-next--mono.yt-spec-button-shape-next--filled {
  color: white;
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  border: transparent;
  border-radius: 16px;
}

.yt-spec-button-shape-next--mono.yt-spec-button-shape-next--filled:hover {
  background: rgba(255, 255, 255, 0.2);
  border: transparent;
}

.yt-spec-button-shape-next--mono.yt-spec-button-shape-next--filled .yt-icon-shape {
  color: white;
}

/* User Page */
ytmusic-subscribe-button-renderer.ytmusic-visual-header-renderer {
  background: none;
}

/* ========================== PODCAST ========================== */

ytmusic-player-page[player-fullscreened] ytmusic-description-shelf-renderer {
  display: none;
}

ytmusic-multi-row-list-item-renderer[is-detailed-view] {
  --ytmusic-list-item-height: 182px;
  --ytmusic-multi-row-list-item-thumbnail-size: 80px;
}

.image.ytmusic-visual-header-renderer {
  mask-image: linear-gradient(to bottom, black 40%, transparent 100%);
  mask-repeat: no-repeat;
  mask-size: 100%;
}

/* Podcast Hover */
.thumbnail-wrapper.ytmusic-multi-row-list-item-renderer {
  position: relative;
  /* Radius art mặc định: 8px */
  border-radius: 8px;
}

ytmusic-multi-row-list-item-renderer.ytmusic-shelf-renderer .thumbnail-overlay {
  aspect-ratio: 16 / 9;
  top: auto;
  bottom: auto;
  height: auto;
}

ytmusic-responsive-header-renderer ytmusic-toggle-button-renderer.ytmusic-responsive-header-renderer {
  /* Button color: rgba(255, 255, 255, 0.1) */
  background: rgba(255, 255, 255, 0.1) !important;
  border: transparent !important;
}

/* Podcast Focused */
ytmusic-multi-row-list-item-renderer[play-button-state] {
  /* Radius highlight big: 12px */
  border-radius: 12px;
}

ytmusic-multi-row-list-item-renderer.ytmusic-shelf-renderer {
  border-bottom: 0 !important;
}

/* Progress Bar */
.foreground-bar.ytmusic-playback-progress-renderer {
  /* Accent color: white */
  background: white;
}

.subtitle.ytmusic-multi-row-list-item-renderer {
  /* Text color 2: rgba(white, 0.7) */
  color: rgba(255, 255, 255, 0.7);
}

/* ============================================== */
/* 10. FADE IN/OUT/SLIDE THÔNG TIN BÀI HÁT CHUYỂN BÀI */
/* ============================================== */
.middle-controls.ytmusic-player-bar {
  position: relative;
}

/* Transition cho các phần tử con (KHÔNG áp dụng cho overlay JS) */
.middle-controls.ytmusic-player-bar > .thumbnail-image-wrapper,
.middle-controls.ytmusic-player-bar > .content-info-wrapper,
.middle-controls.ytmusic-player-bar > .middle-controls-buttons {
  transition: opacity 0.4s cubic-bezier(0.2, 0.8, 0.2, 1),
              transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1) !important;
  will-change: opacity, transform;
}

/* Khi đang chuyển bài → ẩn nội dung gốc (overlay JS sẽ fade out thay) */
.middle-controls.ytmusic-player-bar:has(.title[is-empty]) > .thumbnail-image-wrapper,
.middle-controls.ytmusic-player-bar:has(.title[is-empty]) > .content-info-wrapper,
.middle-controls.ytmusic-player-bar:has(.title[is-empty]) > .middle-controls-buttons {
  opacity: 0 !important;
  transform: translateY(5px) !important;
  pointer-events: none !important;
}

/* Thêm padding trái cho nút no-lyrics/LYRIC_FOOTER khi KHÔNG fullscreen */
ytmusic-player-page:not([player-fullscreened]) .blyrics-no-lyrics-button-container {
  padding-left: 18px;
}

/* Thêm padding trái cho dải phân loại (chips) ở up-next khi KHÔNG fullscreen */
ytmusic-player-page:not([player-fullscreened]) ytmusic-chip-cloud-renderer#steering-chips {
  padding-left: 18px;
}

/* =========================================================
   GlassyUI - Side Panel Playlist Queue Design
   ========================================================= */

/* 1. Container: Bóp vào trong bằng margin để không chạm viền */
#contents.ytmusic-player-queue {
  display: flex !important;
  flex-direction: column !important;
  padding: 8px 6px !important;
  border-radius: 20px !important;
  overflow-y: overlay !important;
}

/* 2. Trạng thái mặc định của Item */
ytmusic-player-queue-item {
  display: flex !important;
  align-items: center !important;
  padding: 8px 12px !important;
  border-radius: 12px !important;
  background: transparent !important;
  transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1) !important;
  cursor: pointer !important;
  border: 1px solid transparent !important;
  margin: 4px 20px !important; /* Đảm bảo an toàn 2 bên ở mọi mục */
  box-sizing: border-box !important;
  position: relative !important;
  z-index: 1 !important;
}

/* 3. Hover Item: NỔI LÊN (Scale & Shadow) thay vì lướt ngang */
ytmusic-player-queue-item:hover {
  background: rgba(255, 255, 255, 0.12) !important;
  backdrop-filter: saturate(110%) !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
  transform: translateY(-2px) scale(1.02) !important; /* Scale và bay lên */
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.25) !important;
  z-index: 5 !important;
}

/* 4. Trạng thái đang phát (Playing/Selected): Khối nổi 3D, Gradient & Glow */
ytmusic-player-queue-item[selected=""] {
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.2), rgba(255, 255, 255, 0.1)) !important;
  backdrop-filter: saturate(120%) !important;
  border: 1px solid rgba(255, 255, 255, 0.15) !important;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4), inset 0 1px 1px rgba(255, 255, 255, 0.2) !important;
  transform: scale(1.02) !important;
  margin-top: 6px !important;
  margin-bottom: 10px !important;
  z-index: 4 !important;
}

ytmusic-player-queue-item[selected=""]:hover {
  transform: translateY(-2px) scale(1.03) !important;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.15), rgba(255, 255, 255, 0.05)) !important;
}

/* 5. Typography (Song Info) */
ytmusic-player-queue-item .song-info {
  display: flex !important;
  flex-direction: column !important;
  justify-content: center !important;
  flex-grow: 1 !important;
  overflow: hidden !important;
}

ytmusic-player-queue-item .song-title {
  color: rgba(255, 255, 255, 0.9) !important;
  letter-spacing: 0.3px !important;
  margin-bottom: 2px !important;
  transition: color 0.3s, text-shadow 0.3s !important;
}

ytmusic-player-queue-item .byline {
  color: rgba(255, 255, 255, 0.45) !important;
  transition: color 0.3s !important;
}
ytmusic-player-queue-item:hover .byline {
  color: rgba(255, 255, 255, 0.7) !important;
}
ytmusic-player-queue-item[selected=""] .byline {
  color: rgba(255, 255, 255, 0.85) !important;
}

/* =========================================================
   GlassyUI - Queue Header & Autoplay Footer Design
   ========================================================= */

/* Queue Header ("Playing from") */
ytmusic-queue-header-renderer {
  margin: 12px 14px 12px 14px !important;
  padding: 16px 20px !important;
  background: rgba(20, 20, 20, 0.2) !important;
  backdrop-filter: saturate(180%) !important;
  border-radius: 20px !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.3) !important;
}

ytmusic-queue-header-renderer .container-name.ytmusic-queue-header-renderer {
  gap: 4px !important;
  display: flex !important;
  flex-direction: column !important;
}

ytmusic-queue-header-renderer .title.ytmusic-queue-header-renderer {
  color: rgba(255, 255, 255, 0.5) !important;
  letter-spacing: 0.5px !important;
  text-transform: uppercase !important;
}

ytmusic-queue-header-renderer .subtitle.ytmusic-queue-header-renderer {
  color: rgba(255, 255, 255, 0.95) !important;
  letter-spacing: 0.3px !important;
  text-shadow: 0 2px 10px rgba(255, 255, 255, 0.2) !important;
}

/* Save Button inside Header */
ytmusic-queue-header-renderer ytmusic-chip-cloud-chip-renderer {
  background: transparent !important;
  border: none !important;
  transition: transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) !important;
}

ytmusic-queue-header-renderer ytmusic-chip-cloud-chip-renderer:hover {
  transform: scale(1.05) !important;
}

ytmusic-queue-header-renderer .gradient-box.ytmusic-chip-cloud-chip-renderer {
  background: rgba(255, 255, 255, 0.08) !important;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
  border-radius: 12px !important;
  padding: 0 14px !important;
  height: 32px !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
}

ytmusic-queue-header-renderer .gradient-box.ytmusic-chip-cloud-chip-renderer:hover {
  background: rgba(255, 255, 255, 0.15) !important;
}

ytmusic-queue-header-renderer a.yt-simple-endpoint.ytmusic-chip-cloud-chip-renderer {
  background: transparent !important;
  display: flex !important;
  align-items: center !important;
  gap: 6px !important;
  text-decoration: none !important;
}

ytmusic-queue-header-renderer yt-icon.ytmusic-chip-cloud-chip-renderer {
  color: rgba(255, 255, 255, 0.9) !important;
  width: 18px !important;
  height: 18px !important;
  margin: 0 !important;
}

ytmusic-queue-header-renderer .text.ytmusic-chip-cloud-chip-renderer {
  color: rgba(255, 255, 255, 0.9) !important;
}

/* Autoplay Footer */
.autoplay.ytmusic-tab-renderer {
  margin: 12px 14px 12px 14px !important;
  padding: 16px 20px !important;
  background: rgba(20, 20, 20, 0.2) !important;
  backdrop-filter: saturate(180%) !important;
  border-radius: 20px !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.3) !important;
}

.autoplay.ytmusic-tab-renderer:not([hidden]) {
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
}

.autoplay.ytmusic-tab-renderer[hidden],
.autoplay.ytmusic-tab-renderer[style*="display: none"] {
  display: none !important;
}

.autoplay.ytmusic-tab-renderer .title.ytmusic-tab-renderer {
  color: rgba(255, 255, 255, 0.9) !important;
  letter-spacing: 0.3px !important;
}

.autoplay.ytmusic-tab-renderer .subtitle.ytmusic-tab-renderer {
  color: rgba(255, 255, 255, 0.5) !important;
  margin-top: 4px !important;
}

/* Autoplay Toggle Switch Styling */
.autoplay.ytmusic-tab-renderer tp-yt-paper-toggle-button {
  --paper-toggle-button-checked-bar-color: rgba(255, 255, 255, 0.4) !important;
  --paper-toggle-button-checked-button-color: #fff !important;
  --paper-toggle-button-checked-ink-color: rgba(255, 255, 255, 0.2) !important;
  --paper-toggle-button-unchecked-bar-color: rgba(255, 255, 255, 0.1) !important;
  --paper-toggle-button-unchecked-button-color: rgba(255, 255, 255, 0.4) !important;
}
/* Autoplay Indicator inside Queue List */
div.autoplay.ytmusic-player-queue {
  padding-left: 12px !important;
}

/* Toggle Buttons */
.toggle-bar.tp-yt-paper-toggle-button {
  background: rgba(255, 255, 255, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.1);
  opacity: 0.5;
}

.toggle-button.tp-yt-paper-toggle-button {
  background: rgb(180, 180, 180);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

tp-yt-paper-toggle-button[checked]:not([disabled]) {
  .toggle-bar.tp-yt-paper-toggle-button,
  .toggle-button.tp-yt-paper-toggle-button {
    background: white;
    border: 1px solid rgba(255, 255, 255, 0.1);
  }
}

/* =========================================================
   GlassyUI - Toast Notifications
   ========================================================= */
tp-yt-paper-toast {
  /* Ép sử dụng màu Album do plugin tạo ra nhưng kèm vùng alpha để nhìn xuyên qua kính */
  background-color: rgba(var(--ytmusic-album-color-dark, 30, 30, 30), 0.6) !important;
  backdrop-filter: blur(20px) saturate(150%) !important;
  -webkit-backdrop-filter: blur(20px) saturate(150%) !important;
  border-radius: 14px !important;
  border: 1px solid rgba(255, 255, 255, 0.15) !important;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 2px rgba(255, 255, 255, 0.2) !important;
}

/* Fix chữ bên trong để luôn dễ đọc trên nền glass */
tp-yt-paper-toast #label.style-scope.tp-yt-paper-toast,
tp-yt-paper-toast yt-formatted-string,
tp-yt-paper-toast .style-scope.yt-formatted-string {
  font-weight: 500 !important;
  color: rgba(255, 255, 255, 0.95) !important;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.4) !important;
}

/* Nút Action "Thay đổi", "Hoàn tác"... */
tp-yt-paper-toast yt-button-renderer button {
  background: rgba(255, 255, 255, 0.15) !important;
  border-radius: 10px !important;
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
  transition: all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) !important;
  box-shadow: none !important;
}

tp-yt-paper-toast yt-button-renderer button:hover {
  background: rgba(255, 255, 255, 0.25) !important;
  transform: translateY(-1px) !important;
}

tp-yt-paper-toast yt-button-renderer button .yt-spec-button-shape-next__button-text-content,
tp-yt-paper-toast yt-button-renderer button .ytSpecButtonShapeNextButtonTextContent,
tp-yt-paper-toast yt-button-renderer button span {
  color: #fff !important;
  font-weight: 600 !important;
  letter-spacing: 0.3px !important;
}

/* Nút Đóng (Close) */
tp-yt-paper-toast yt-icon-button#close-button button {
  background: rgba(255, 255, 255, 0.1) !important;
  border-radius: 50% !important;
  transition: all 0.2s ease !important;
}

tp-yt-paper-toast yt-icon-button#close-button button:hover {
  background: rgba(255, 255, 255, 0.25) !important;
}

tp-yt-paper-toast yt-icon-button#close-button yt-icon {
  fill: #fff !important;
  color: #fff !important;
}

/* ========================== TEXT & ICONS ========================== */
yt-formatted-string.title {
  color: white !important;
  --yt-endpoint-color: white !important;
  --yt-endpoint-hover-color: white !important;
  --yt-endpoint-visited-color: white !important;
}

yt-icon {
  color: white;
}

yt-icon.ytmusic-inline-badge-renderer {
  color: white;
}

/* Icons in explore top songs  */
.icon-column.ytmusic-custom-index-column-renderer .yt-icon-shape {
  color: white;
}

/* CTA Text */
a.yt-simple-endpoint.yt-formatted-string {
  --yt-spec-call-to-action: white;
  --yt-endpoint-hover-color: white;
  &:hover {
    text-decoration: underline;
  }
}

/* Like Dislike 3 Dots */
.yt-spec-button-shape-next--mono.yt-spec-button-shape-next--text {
  color: white;
}

.index.ytmusic-responsive-list-item-renderer {
  color: rgba(255, 255, 255, 0.7);
}

/* Like buttons pressed */
.yt-spec-button-shape-next[aria-pressed="true"] {
  color: white;
}

tp-yt-paper-ripple.tp-yt-paper-tab {
  color: transparent;
}

.stroke.yt-interaction,
.fill.yt-interaction {
  border: 0;
  background: transparent;
}

/* Smooth Progress Bar */
#primaryProgress.tp-yt-paper-progress,
#secondaryProgress.tp-yt-paper-progress {
  transition: transform 1s linear;
}
ytmusic-app-layout[is-mweb-modernization-enabled][player-ui-state="PLAYER_PAGE_OPEN"] .slider-knob.tp-yt-paper-slider,
ytmusic-app-layout:not([is-mweb-modernization-enabled]) .slider-knob.tp-yt-paper-slider:not(.dragging) {
  transition: left 1s linear;
}

/* 1. Baseline Collapsed State (only showing icon) */
ytmusic-player-page tp-yt-paper-tabs.tab-header-container.blyrics-dock-collapsed .nankill-blyrics-footer-in-tabs,
ytmusic-player-page tp-yt-paper-tabs.tab-header-container.blyrics-dock-collapsed .blyrics-footer__container {
  width: 34px !important;
  min-width: 34px !important;
  padding: 0 !important;              /* Zero padding to center the icon perfectly */
  justify-content: center !important;  /* Center the icon inside flex container */
  gap: 0 !important;                  /* Remove flex gaps to prevent overflow spacing */
  overflow: hidden !important;
  font-size: 0 !important;             /* Hides the raw text node */
  transition: 
    width 0.3s cubic-bezier(0.25, 0.8, 0.25, 1), 
    padding 0.3s cubic-bezier(0.25, 0.8, 0.25, 1),
    font-size 0.3s ease,
    background-color 0.3s ease,
    box-shadow 0.3s ease !important;
}

/* Hide the text link by default with transitions */
ytmusic-player-page tp-yt-paper-tabs.tab-header-container.blyrics-dock-collapsed .nankill-blyrics-footer-in-tabs a,
ytmusic-player-page tp-yt-paper-tabs.tab-header-container.blyrics-dock-collapsed .blyrics-footer__container a {
  display: none !important;           /* Hide block layout completely when collapsed */
  opacity: 0;
  width: 0;
  white-space: nowrap;
  transition: opacity 0.2s ease, width 0.2s ease !important;
  pointer-events: none;
}

/* Center the icon inside the collapsed container */
ytmusic-player-page tp-yt-paper-tabs.tab-header-container.blyrics-dock-collapsed .nankill-blyrics-footer-in-tabs img,
ytmusic-player-page tp-yt-paper-tabs.tab-header-container.blyrics-dock-collapsed .blyrics-footer__container img {
  margin-right: 0 !important;
  margin-left: 0 !important;
  transition: margin-right 0.3s cubic-bezier(0.25, 0.8, 0.25, 1) !important;
}

/* 2. Interactive Hover Expanded State (overlaying tabs) */
ytmusic-player-page tp-yt-paper-tabs.tab-header-container.blyrics-dock-collapsed .nankill-blyrics-footer-in-tabs:hover,
ytmusic-player-page tp-yt-paper-tabs.tab-header-container.blyrics-dock-collapsed .blyrics-footer__container:hover {
  width: 230px !important;             /* Expanded width to comfortably fit text */
  padding: 0 14px !important;          /* Restore padding */
  gap: 8px !important;                /* Restore flex gap */
  justify-content: center !important;  /* Center content horizontally */
  z-index: 100 !important;             /* Floats above any tab headers */
  font-size: 13px !important;          /* Restores font size for text node */
  
  /* Glassmorphism highlighting to isolate it from the underlying tabs */
  background: rgba(20, 20, 20, 0.8) !important; /* More opaque background */
  backdrop-filter: blur(25px) saturate(1.8) !important; /* Blurs out the tabs behind it */
  border-color: rgba(255, 255, 255, 0.25) !important;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.2) !important;
}

/* Fade-in text on hover */
ytmusic-player-page tp-yt-paper-tabs.tab-header-container.blyrics-dock-collapsed .nankill-blyrics-footer-in-tabs:hover a,
ytmusic-player-page tp-yt-paper-tabs.tab-header-container.blyrics-dock-collapsed .blyrics-footer__container:hover a {
  display: inline !important;          /* Show the text link */
  opacity: 1;
  width: auto;
  pointer-events: auto;
}

/* Push text away from icon on hover */
ytmusic-player-page tp-yt-paper-tabs.tab-header-container.blyrics-dock-collapsed .nankill-blyrics-footer-in-tabs:hover img,
ytmusic-player-page tp-yt-paper-tabs.tab-header-container.blyrics-dock-collapsed .blyrics-footer__container:hover img {
  margin-right: 8px !important;
}

/* unison menu */
/* Nâng cao unison dock khi ở chế độ toàn màn hình (fullscreen) cho data-position="bottom-center" (bottom-middle) */
ytmusic-player-page[player-fullscreened] .blyrics-dock[data-position="bottom-center"] {
  top: calc(100% - 75px - var(--menu-bar-height, 0px)) !important;
}

/* ========================================================================== */
/* TOP-ROW PLAYER BUTTONS - UNIFIED GLASS PILL BAR                            */
/* ========================================================================== */

/* 1. Container Bar - Thanh capsule kính mờ bảo vệ icon trên artwork sáng */
.top-row-buttons.ytmusic-player {
  position: absolute !important;
  top: 10px !important;
  right: 10px !important;
  left: auto !important;
  bottom: auto !important;
  width: auto !important;
  min-width: unset !important;
  max-width: calc(100% - 16px) !important;
  box-sizing: border-box !important;
  margin: 0 !important;
  
  display: inline-flex !important;
  flex-direction: row !important;
  align-items: center !important;
  justify-content: center !important;
  gap: 3px !important;
  padding: 4px 6px !important;
  transform-origin: top right !important;
  
  /* Nền kính tối mờ chống lóa trên artwork trắng/sáng */
  background: rgba(0, 0, 0, 0.45) !important;
  /* Bo góc dạng viên thuốc (Pill/Capsule Bar) */
  border-radius: 9999px !important;
  
  /* Viền khúc xạ sáng nhẹ & đổ bóng chiều sâu */
  border: 1px solid rgba(255, 255, 255, 0.14) !important;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35),
              inset 0 1px 1px rgba(255, 255, 255, 0.15) !important;
  
  z-index: 10 !important;
  transition: all 0.25s cubic-bezier(0.2, 0.8, 0.2, 1) !important;
}

/* Hover nhẹ lên cả thanh bar */
.top-row-buttons.ytmusic-player:hover {
  background: rgba(0, 0, 0, 0.55) !important;
  border-color: rgba(255, 255, 255, 0.22) !important;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45),
              inset 0 1px 1px rgba(255, 255, 255, 0.2) !important;
}

/* Xử lý wrapper div (như player-quality-button nằm trong thẻ div) */
.top-row-buttons.ytmusic-player > div {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
}

/* 2. Từng nút bấm icon bên trong thanh Bar */
.top-row-buttons.ytmusic-player yt-icon-button {
  align-items: center !important;
  justify-content: center !important;
  width: 36px !important;
  height: 36px !important;
  padding: 0 !important;
  margin: 0 !important;
  border-radius: 50% !important;
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  cursor: pointer !important;
  color: rgba(255, 255, 255, 0.88) !important;
  transition: all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1) !important;
}

/* Hiệu ứng hover cho từng icon: Nổi sáng tròn nhẹ */
.top-row-buttons.ytmusic-player yt-icon-button:hover {
  background: rgba(255, 255, 255, 0.15) !important;
  color: #ffffff !important;
  transform: scale(1.06) !important;
}

.top-row-buttons.ytmusic-player yt-icon-button:active {
  transform: scale(0.92) !important;
  background: rgba(255, 255, 255, 0.25) !important;
}

/* 3. Reset các thẻ button bên trong yt-icon-button */
.top-row-buttons.ytmusic-player yt-icon-button button,
.top-row-buttons.ytmusic-player button#button {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: 100% !important;
  height: 100% !important;
  padding: 0 !important;
  margin: 0 !important;
  border: none !important;
  background: transparent !important;
  color: inherit !important;
}

/* 4. Tinh chỉnh Icon SVG: Kích thước chuẩn & độ tương phản cao */
.top-row-buttons.ytmusic-player yt-icon,
.top-row-buttons.ytmusic-player .yt-icon-shape,
.top-row-buttons.ytmusic-player svg {
  display: block !important;
  width: 22px !important;
  height: 22px !important;
  fill: currentColor !important;
  color: inherit !important;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.35)) !important;
}

/* Tắt lớp hiệu ứng ripple mặc định gây lệch hoặc đục */
.top-row-buttons.ytmusic-player yt-interaction {
  display: none !important;
}

/* 5. Tối ưu kích thước trong Trình phát thu nhỏ (Miniplayer) & Responsive */
ytmusic-player[player-ui-state="MINIPLAYER"] .top-row-buttons,
ytmusic-player[player-ui-state="INACTIVE"] .top-row-buttons,
ytmusic-app-layout[player-ui-state="MINI_PLAYER"] .top-row-buttons,
ytmusic-app-layout:not([player-page-open]) .top-row-buttons,
ytmusic-player-page:not([player-page-open]) .top-row-buttons,
#player:not([player-page-open]) .top-row-buttons,
#player[player-ui-state="MINIPLAYER"] .top-row-buttons {
  top: 8px !important;
  right: 8px !important;
  padding: 3px 5px !important;
  gap: 2px !important;
  max-width: calc(100% - 16px) !important;
  transform: none !important; /* Giữ nguyên kích thước icon to rõ, không bị thu bé */
}

/* Khi cửa sổ ứng dụng bị thu nhỏ màn hình */
@media (max-width: 768px), (max-height: 600px) {
  .top-row-buttons.ytmusic-player {
    top: 8px !important;
    right: 8px !important;
    transform: none !important;
    max-width: calc(100% - 16px) !important;
  }
}

/* ẨN HOÀN TOÀN CÁC NÚT KHI Ở CHẾ ĐỘ FULLSCREEN */
ytmusic-player-page[player-fullscreened] .top-row-buttons,
ytmusic-player-page[player-fullscreened] ytmusic-player .top-row-buttons,
[player-fullscreened] .top-row-buttons,
ytmusic-player[player-ui-state="FULLSCREEN"] .top-row-buttons,
:fullscreen .top-row-buttons,
:-webkit-full-screen .top-row-buttons {
  display: none !important;
  opacity: 0 !important;
  visibility: hidden !important;
  pointer-events: none !important;
}

`;

function injectStyles() {
  const existingStyle = document.getElementById('force-nankill-skibidi-theme');
  if (existingStyle) {
    if (existingStyle.textContent !== MY_CUSTOM_CSS) {
      existingStyle.textContent = MY_CUSTOM_CSS;
    }
    return;
  }

  console.info('[GlassyUI] Booting Merged Theme...');

  // Tạo thẻ <style>
  const style = document.createElement('style');
  style.id = 'force-nankill-skibidi-theme';
  style.type = 'text/css';

  // Thêm CSS vào
  if (style.styleSheet) {
    style.styleSheet.cssText = MY_CUSTOM_CSS;
  } else {
    style.appendChild(document.createTextNode(MY_CUSTOM_CSS));
  }

  // Chèn vào đầu trang (hoặc cuối body để ghi đè mạnh hơn)
  (document.head || document.documentElement).appendChild(style);
}

const NANKILL_BLYRICS_SOURCE_LINK_ID = 'betterLyricsFooterLink';

function getSourceLinkInContainer(container) {
  return container.querySelector(`a#${NANKILL_BLYRICS_SOURCE_LINK_ID}, a[data-nankill-source-link]`);
}

function getBetterLyricsSourceContainers() {
  return Array.from(document.querySelectorAll('.blyrics-footer__container')).filter((container) => {
    return Boolean(getSourceLinkInContainer(container));
  });
}

function pickPrimarySourceContainer(containers) {
  return (
    containers.find((container) => container.classList.contains('nankill-blyrics-footer-in-tabs')) ||
    containers.find((container) => {
      const link = getSourceLinkInContainer(container);
      if (!link) {
        return false;
      }
      return Boolean(link.getAttribute('href')) || link.textContent.trim().length > 0;
    }) ||
    containers[0]
  );
}

function sanitizeSourceContainers({ containers, primary, tabsHost }) {
  for (const container of containers) {
    const sourceLink = getSourceLinkInContainer(container);
    if (!sourceLink) {
      continue;
    }

    if (container === primary) {
      sourceLink.id = NANKILL_BLYRICS_SOURCE_LINK_ID;
      sourceLink.dataset.nankillSourceLink = 'primary';
      container.dataset.nankillSourceClone = '0';
      container.style.removeProperty('display');
      continue;
    }

    const isInTabsHost = tabsHost && tabsHost.contains(container);
    if (isInTabsHost) {
      continue;
    }

    // Better Lyrics có thể tạo lại một source footer mới sau khi đổi bài.
    // Ẩn bản clone và gỡ id để không cướp luồng cập nhật từ bản đang dock trên tab.
    sourceLink.removeAttribute('id');
    sourceLink.dataset.nankillSourceLink = 'clone';
    container.dataset.nankillSourceClone = '1';
    container.style.setProperty('display', 'none', 'important');
  }
}

function dockBetterLyricsFooterToTabs() {
  const sourceContainers = getBetterLyricsSourceContainers();
  const tabsHost = document.querySelector('ytmusic-page tp-yt-paper-tabs.tab-header-container, ytmusic-player-page tp-yt-paper-tabs.tab-header-container');

  if (!sourceContainers.length || !tabsHost) {
    return;
  }

  const footer = pickPrimarySourceContainer(sourceContainers);
  if (!footer) {
    return;
  }

  // Chỉ chuyển node khi cần, tránh thao tác DOM lặp vô ích.
  if (footer.parentElement !== tabsHost) {
    console.info('[GlassyUI] Successfully docked lyrics footer to tabs.');
    footer.classList.add('nankill-blyrics-footer-in-tabs');
    tabsHost.appendChild(footer);
  }

  sanitizeSourceContainers({
    containers: sourceContainers,
    primary: footer,
    tabsHost,
  });

  // Calculate dynamic collapse based on actual tab widths
  const tabs = Array.from(tabsHost.querySelectorAll('tp-yt-paper-tab.tab-header'));
  if (tabs.length > 0) {
    const tabsHostWidth = tabsHost.getBoundingClientRect().width;
    if (tabsHostWidth > 0) {
      const tabsWidth = tabs.reduce((sum, tab) => sum + tab.getBoundingClientRect().width + 8, 0);
      const remainingSpace = tabsHostWidth - tabsWidth - 24; // 24px extra margin for safety
      const shouldCollapse = remainingSpace < 230; // Expanded width is 230px
      tabsHost.classList.toggle('blyrics-dock-collapsed', shouldCollapse);
    }
  }
}

let nankillFooterDockObserver;
function setupFooterDockingObserver() {
  let rafPending = false;
  const scheduleDock = () => {
    if (rafPending) {
      return;
    }
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      dockBetterLyricsFooterToTabs();
    });
  };

  dockBetterLyricsFooterToTabs();

  if (!nankillFooterDockObserver) {
    console.info('[GlassyUI] Starting DOM observer for lyrics footer docking...');
    nankillFooterDockObserver = new MutationObserver(scheduleDock);
    nankillFooterDockObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  window.addEventListener('resize', scheduleDock);
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  NO-SYNC DETECTION — Phát hiện lyrics tĩnh/không sync
 *
 *  BetterLyrics luôn đặt `data-time` và `data-duration` trên mỗi dòng:
 *    - Synced: data-duration có giá trị thực ("5.3", "2.1", ...)
 *    - Static: data-duration = "0" cho TẤT CẢ các dòng
 *
 *  Logic: Check xem có .blyrics--line nào có data-duration != "0" không.
 *    - Có → synced → giữ blur.
 *    - Không có → static → bỏ blur.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
let noSyncContainer = null;
let noSyncObserver = null;
let isNoSyncMode = false;

let noSyncTransitionTimer = null;

function setNoSyncMode(container, enabled) {
  if (isNoSyncMode === enabled) return;
  const wasNoSync = isNoSyncMode;
  isNoSyncMode = enabled;

  // Cleanup transition timer nếu đang chạy
  if (noSyncTransitionTimer) {
    clearTimeout(noSyncTransitionTimer);
    noSyncTransitionTimer = null;
    container.classList.remove('blyrics--entering-sync');
  }

  if (enabled) {
    // Chuyển sang no-sync: hiện rõ tất cả lyrics
    container.classList.add('blyrics--no-sync');
    console.info('[GlassyUI] 🔇 No-sync detected (all lines data-duration=0) — blur disabled.');
  } else {
    // Chuyển sang sync: blur lại
    container.classList.remove('blyrics--no-sync');

    // Nếu trước đó đang là no-sync → thêm animation mượt
    if (wasNoSync) {
      container.classList.add('blyrics--entering-sync');
      noSyncTransitionTimer = setTimeout(() => {
        container.classList.remove('blyrics--entering-sync');
        noSyncTransitionTimer = null;
      }, 750); // hơi dư so với animation 0.7s
    }

    console.info('[GlassyUI] 🎵 Synced lyrics detected (data-duration > 0 found) — blur enabled.');
  }
}

function checkSyncState(container) {
  if (!container || !container.isConnected) return;
  // Synced: ít nhất 1 dòng có data-duration khác "0"
  // Static: TẤT CẢ dòng đều có data-duration="0"
  const hasSyncedLine = container.querySelector('.blyrics--line[data-duration]:not([data-duration="0"])');
  setNoSyncMode(container, !hasSyncedLine);
}

function startNoSyncDetection(container) {
  // Cleanup cũ
  if (noSyncObserver) {
    noSyncObserver.disconnect();
    noSyncObserver = null;
  }
  if (noSyncContainer && noSyncContainer !== container) {
    noSyncContainer.classList.remove('blyrics--no-sync');
  }
  noSyncContainer = container;
  isNoSyncMode = false;

  // Check ngay lập tức
  checkSyncState(container);

  // Observer theo dõi khi nội dung thay đổi (lines được thêm/xóa khi đổi bài)
  noSyncObserver = new MutationObserver(() => {
    if (!container.isConnected) return;
    checkSyncState(container);
  });

  noSyncObserver.observe(container, {
    childList: true,
    subtree: true,
  });
}

let noSyncDomObserver = null;
function setupNoSyncDomObserver() {
  if (noSyncDomObserver) return;

  console.info('[GlassyUI] Starting no-sync detection observer...');

  let lastContainer = null;
  let domCheckQueued = false;

  noSyncDomObserver = new MutationObserver(() => {
    if (domCheckQueued) return;
    domCheckQueued = true;
    queueMicrotask(() => {
      domCheckQueued = false;
      const container = document.querySelector('.blyrics-container');
      if (container && container !== lastContainer) {
        lastContainer = container;
        startNoSyncDetection(container);
      }
    });
  });

  noSyncDomObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Check ngay nếu container đã tồn tại
  const existing = document.querySelector('.blyrics-container');
  if (existing) {
    lastContainer = existing;
    startNoSyncDetection(existing);
  }
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  FULLSCREEN CURSOR HIDING — Gate rule `*` theo state fullscreen
 *
 *  Rule ẩn con trỏ buộc phải dùng subject `*`: `cursor` là inherited
 *  property, nhưng element nào tự khai `cursor` sẽ luôn thắng giá trị
 *  inherit — kể cả khi cha khai `!important`. Extension khai `cursor` ở
 *  ~20 chỗ, nên đặt `cursor: none` riêng trên #layout là KHÔNG đủ.
 *
 *  Vấn đề: subject `*` không có bucket key (id/class/tag/attribute), nên
 *  Blink phải thử lại rule này với MỌI element trong MỌI lần recalc
 *  style — kể cả khi không hề fullscreen. Trong profile: ~9.5k lượt thử
 *  mỗi lần recalc, 0 match.
 *
 *  Cách xử lý: giữ nguyên rule y hệt, nhưng chỉ cho nó CÓ MẶT trong
 *  stylesheet khi #layout[player-fullscreened]. Ngoài fullscreen rule
 *  không tồn tại → chi phí 0; trong fullscreen → hành vi giống hệt cũ.
 *
 *  Chọn [player-fullscreened] làm gate vì nó chỉ đổi khi vào/ra
 *  fullscreen. KHÔNG gate theo [cursor-hidden]: settings.ts bật/tắt
 *  attribute đó theo mousemove + timer 3s, gate theo nó sẽ thêm/xoá
 *  stylesheet liên tục, mà mỗi lần thêm/xoá sheet = 1 full recalc.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const NANKILL_FS_CURSOR_STYLE_ID = 'nankill-fullscreen-cursor';
const NANKILL_FS_CURSOR_CSS = `
#layout[player-fullscreened]:not([blyrics-dfs])[cursor-hidden]:not([show-fullscreen-controls]) * {
  cursor: none !important;
}
`;

let nankillFsCursorObserver = null;

function syncFullscreenCursorStyle() {
  const layout = document.getElementById('layout');
  const wanted = Boolean(layout && layout.hasAttribute('player-fullscreened'));
  const existing = document.getElementById(NANKILL_FS_CURSOR_STYLE_ID);

  if (wanted === Boolean(existing)) {
    return;
  }

  if (!wanted) {
    existing.remove();
    return;
  }

  const style = document.createElement('style');
  style.id = NANKILL_FS_CURSOR_STYLE_ID;
  style.type = 'text/css';
  style.textContent = NANKILL_FS_CURSOR_CSS;
  (document.head || document.documentElement).appendChild(style);
}

function setupFullscreenCursorObserver() {
  syncFullscreenCursorStyle();

  if (nankillFsCursorObserver) {
    return;
  }

  console.info('[GlassyUI] Gating fullscreen cursor rule on [player-fullscreened]...');

  // attributeFilter làm observer này gần như miễn phí: Blink chỉ notify khi
  // đúng attribute đó đổi, chứ không phải mọi mutation trong subtree.
  nankillFsCursorObserver = new MutationObserver(syncFullscreenCursorStyle);
  nankillFsCursorObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['player-fullscreened'],
    subtree: true,
  });
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *  PAST-LINE MARKER — stamp .blyrics--gf-behind thay cho :has(~ .blyrics--active)
 *
 *  Ba rule blur dòng đã hát trước đây dùng
 *      .blyrics--line:has(~ .blyrics--active)
 *  Đo được: mỗi lần .blyrics--active nhảy sang dòng mới, một :has() có
 *  argument khớp class đó buộc Blink invalidate cả dải sibling thay vì 1
 *  element — amplification 474-1060x. Positive control: tắt hết stylesheet
 *  của app rồi inject đúng 1 rule :has() đó, không đổi gì khác trong trang
 *  → chi phí một lần .blyrics--active đổi chỗ nhảy từ 0.00ms lên 0.80ms.
 *
 *  Lưu ý: dạng ancestor :has(.x) > y đo được CÒN TỆ HƠN dạng sibling
 *  (1.00ms vs 0.80ms), nên viết lại thành :has(.x) sẽ không giải quyết gì.
 *  Class phải rời khỏi argument của :has() hoàn toàn — nên phải stamp bằng JS.
 *
 *  Đây là class past-line DUY NHẤT. .blyrics--gf-past cũ (glassyflow stamp
 *  theo đợt scroll, cố tình trễ để dòng past còn sáng qua animation) đã bị bỏ
 *  cùng với tầng rule thứ hai ở fullscreen.
 *
 *  Đặt ở mergetheme.js chứ không phải glassyflow.js vì rule phải hoạt động cả
 *  khi GlassyFlow KHÔNG quản lý container (no-sync, resize, lyrics tĩnh) —
 *  lúc đó glassyflow không stamp gì cả.
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
const NANKILL_BEHIND_CLASS = 'blyrics--gf-behind';

let nankillBehindHostObserver = null;
let nankillBehindLineObserver = null;
let nankillBehindContainer = null;
let nankillBehindLastActive = -1;
let nankillBehindLineCount = -1;

/* Chỉ ghi khi state thực sự khác. Nhờ vậy khi observer bị gọi lại vì chính
 * write của hàm này, nó ra về sau đúng 1 vòng quét ngược và 0 attribute
 * write — không cần cờ chống tái nhập (cờ đó cũng không dùng được, vì
 * callback của MutationObserver chạy sau khi code đồng bộ đã xong).       */
function syncBehindClasses(force) {
  const container = nankillBehindContainer;
  if (!container || !container.isConnected) return;

  const children = container.children;

  // :has(~ .blyrics--active) khớp mọi dòng đứng TRƯỚC dòng active xa nhất về
  // phía sau. Nhiều dòng có thể mang .blyrics--active cùng lúc do overlap
  // timing, nên phải quét từ cuối lên — giống markPastLines trong glassyflow.
  let lastActive = -1;
  for (let i = children.length - 1; i >= 0; i--) {
    if (children[i].classList.contains('blyrics--active')) {
      lastActive = i;
      break;
    }
  }

  if (!force && lastActive === nankillBehindLastActive && children.length === nankillBehindLineCount) {
    return;
  }
  nankillBehindLastActive = lastActive;
  nankillBehindLineCount = children.length;

  for (let i = 0; i < children.length; i++) {
    const line = children[i];
    if (!line.classList.contains('blyrics--line')) continue;
    // lastActive < 0 → không dòng nào active → :has() cũ không khớp gì → xoá hết
    const want = lastActive >= 0 && i < lastActive;
    if (line.classList.contains(NANKILL_BEHIND_CLASS) !== want) {
      line.classList.toggle(NANKILL_BEHIND_CLASS, want);
    }
  }
}

function attachBehindObserver(container) {
  if (nankillBehindContainer === container && nankillBehindLineObserver) return;

  if (nankillBehindLineObserver) {
    nankillBehindLineObserver.disconnect();
  }
  nankillBehindContainer = container;
  nankillBehindLastActive = -1;
  nankillBehindLineCount = -1;

  // attributeFilter ['class'] + lọc theo con trực tiếp: .blyrics--active chỉ
  // nằm trên con trực tiếp của container, nên class đổi ở word level (hàng
  // trăm lần mỗi 10s trong census) không kéo theo việc quét lại.
  nankillBehindLineObserver = new MutationObserver((records) => {
    let relevant = false;
    let structural = false;
    for (const r of records) {
      if (r.type === 'childList') {
        structural = true;
        relevant = true;
      } else if (r.target.parentElement === container) {
        relevant = true;
      }
    }
    // childList → lyrics vừa render lại, index cũ vô nghĩa → bắt buộc stamp lại
    if (relevant) {
      syncBehindClasses(structural);
    }
  });

  nankillBehindLineObserver.observe(container, {
    attributes: true,
    attributeFilter: ['class'],
    childList: true,
    subtree: true,
  });

  syncBehindClasses(true);
}

function setupPastLineMarker() {
  const existing = document.querySelector('.blyrics-container');
  if (existing) {
    attachBehindObserver(existing);
  }

  // document.body có thể chưa tồn tại ở lần gọi ngay lập tức; các lần gọi
  // sau (DOMContentLoaded / load) sẽ dựng observer.
  if (nankillBehindHostObserver || !document.body) {
    return;
  }

  console.info('[GlassyUI] Stamping .blyrics--gf-behind in place of :has(~ .blyrics--active)...');

  let queued = false;
  nankillBehindHostObserver = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      const container = document.querySelector('.blyrics-container');
      if (container) {
        attachBehindObserver(container);
      }
    });
  });

  nankillBehindHostObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

// Chèn ngay lập tức
injectStyles();
dockBetterLyricsFooterToTabs();
setupFooterDockingObserver();
setupNoSyncDomObserver();
setupFullscreenCursorObserver();
setupPastLineMarker();

// Chèn lại lần nữa khi trang load xong (đề phòng bị extension ghi đè)
window.addEventListener('DOMContentLoaded', () => {
  injectStyles();
  dockBetterLyricsFooterToTabs();
  setupFooterDockingObserver();
  setupNoSyncDomObserver();
  setupFullscreenCursorObserver();
  setupPastLineMarker();
});

window.addEventListener('load', () => {
  injectStyles();
  dockBetterLyricsFooterToTabs();
  setupFooterDockingObserver();
  setupNoSyncDomObserver();
  setupFullscreenCursorObserver();
  setupPastLineMarker();
});
