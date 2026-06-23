/**
 * @file popup/popup.js
 * @description 扩展弹窗入口逻辑
 */

document.addEventListener('DOMContentLoaded', async () => {
    // 主题
    chrome.storage.local.get(['user_theme', 'custom_themes_list'], (res) => {
        const theme = res.user_theme || 'default';
        const customList = res.custom_themes_list || [];
        let color = null;
        if (window.Theme?.getThemeColor) color = window.Theme.getThemeColor(theme, customList);
        if (color && theme !== 'default') {
            document.body.style.setProperty('--primary', color);
            document.body.style.setProperty('--ring', color);
        } else {
            document.body.style.removeProperty('--primary');
            document.body.style.removeProperty('--ring');
        }
    });

    // 图标
    if (window.Icons) {
        const inject = (el, n) => { const c = el?.querySelector('.ud-popup-icon'); if (c) c.innerHTML = window.Icons[n] || ''; };
        inject(document.getElementById('btn-download'), 'download');
        inject(document.getElementById('btn-manager'), 'manager');
    }

    // 读取配置
    chrome.storage.local.get(['task_interval', 'show_quick_button'], (res) => {
        const intervalInput = document.getElementById('taskInterval');
        const showBtnCheck = document.getElementById('showQuickBtn');
        if (intervalInput) intervalInput.value = res.task_interval ?? 5;
        if (showBtnCheck) showBtnCheck.checked = res.show_quick_button !== false;
    });

    // 保存配置
    document.getElementById('taskInterval')?.addEventListener('change', (e) => {
        const val = parseInt(e.target.value) || 5;
        chrome.storage.local.set({ task_interval: Math.max(0, Math.min(60, val)) });
    });
    document.getElementById('showQuickBtn')?.addEventListener('change', (e) => {
        chrome.storage.local.set({ show_quick_button: e.target.checked });
    });

    // 下载
    document.getElementById('btn-download')?.addEventListener('click', async () => {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: 'POPUP_TRIGGER_BATCH' });
        } catch (e) {}
        window.close();
    });

    // 管理
    document.getElementById('btn-manager')?.addEventListener('click', async () => {
        const { saki_counter_queue: q = 0 } = await chrome.storage.local.get('saki_counter_queue');
        chrome.tabs.create({ url: `manager/manager.html?tab=${q > 0 ? 'active' : 'completed'}&page=1` });
        window.close();
    });
});
