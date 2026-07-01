/**
 * @file content-script.js
 * @description 页面注入脚本 (Content Script Coordinator)
 * * 核心职责 (Core Responsibilities):
 * 1. 环境初始化 (Environment Initialization):
 * - 向页面 `<head>` 注入 `adapters/bilibili.js` 以获取 Page Context 权限。
 * - 实例化 `UIManager`，并在页面左下角渲染悬浮下载按钮 (FAB)。
 * * 2. 消息路由 (Message Routing):
 * - **Adapter Bridge**: 监听 `window.postMessage`，接收适配器嗅探到的 `metadata` 或 `UPDATE_WBI_KEYS` 消息。
 * - **Background Bridge**: 将 Wbi 密钥、批量下载任务 (`BATCH_DOWNLOAD`) 转发给 Service Worker。
 * * 3. 交互流程控制 (Interaction Flow):
 * - 响应 FAB 点击 -> 发送 `TRIGGER_SNIFF` -> 接收 Metadata -> 调用 `ui.showBatchModal`。
 * - 处理来自 Popup 的指令 (`POPUP_TRIGGER_BATCH`, `OPEN_SETTINGS`)。
 * * 通信链路 (Communication):
 * - Input: 用户交互 (Click), Window Message (Adapter), Runtime Message (Background/Popup).
 * - Output: `chrome.runtime.sendMessage` (提交任务/更新密钥), `window.postMessage` (触发嗅探).
 * * @author weiyunjun
 * @version v0.1.0
 */

const FAB_HOST_ID = 'saki-fab-container';
const SEARCH_HOST_ID = 'saki-search-collector';

// Helper to detect if we're on a search page
function isSearchPage() {
    return /^https?:\/\/search\.bilibili\.com\/all/.test(location.href) ||
           /^https?:\/\/search\.bilibili\.com\/video/.test(location.href) ||
           /^https?:\/\/search\.bilibili\.com\/pgc/.test(location.href) ||
           /^https?:\/\/search\.bilibili\.com\/bangumi/.test(location.href);
}

const injectAdapter = () => {
    const script = document.createElement('script');

    script.src = chrome.runtime.getURL('adapters/bilibili.js');
    script.type = 'module';

    script.onload = () => {
        script.remove();
    };

    (document.head || document.documentElement).appendChild(script);
};

injectAdapter();
const StyleLoader = {
    cache: {},
    async load(shadowRoot, filePaths) {
        const styleEl = document.createElement('style');
        const cssContents = await Promise.all(
            filePaths.map(async (path) => {
                if (this.cache[path]) return this.cache[path];

                try {
                    const url = chrome.runtime.getURL(path);
                    const response = await fetch(url);
                    const text = await response.text();
                    const fixedText = text.replace(/url\(['"]?([^'")]+)['"]?\)/g, (match, p1) => {
                        if (p1.startsWith('data:')) return match;

                        return `url("${chrome.runtime.getURL('ui/' + p1)}")`;
                    });

                    this.cache[path] = fixedText;

                    return fixedText;
                } catch (e) {
                    console.error('[SakiDown] Failed to load CSS:', path, e);

                    return '';
                }
            }),
        );

        styleEl.textContent = cssContents.join('\n');
        shadowRoot.appendChild(styleEl);
    },
};
const ui = new window.UIManager();
let activeTrigger = null;

async function initQuickButton() {
    try {
        const { show_quick_button: show_quick_button } = await chrome.storage.local.get(['show_quick_button']);

        if (show_quick_button === false) return;
    } catch (e) {
        console.warn('[SakiDown] Config load failed, using default', e);
    }

    if (document.getElementById(FAB_HOST_ID)) return;
    const isSupported = /\/video\/|\/bangumi\/play\/|\/list\/|\/cheese\/play\/|\/festival\//.test(location.pathname);

    if (!isSupported) return;
    const host = document.createElement('div');

    host.id = FAB_HOST_ID;
    host.style.position = 'fixed';
    host.style.bottom = '24px';
    host.style.left = '24px';
    host.style.zIndex = '100000';
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });

    await StyleLoader.load(shadow, ['ui/theme.css', 'ui/components.css']);
    const fabStyle = document.createElement('style');

    fabStyle.textContent = `\n        .ud-fab {\n            /* 基础重置：消除浏览器默认按钮样式 */\n            appearance: none;\n            border: none;\n            outline: none;\n            cursor: pointer;\n            box-sizing: border-box;\n            \n            /* 尺寸与形状 */\n            width: 48px;\n            height: 48px;\n            border-radius: 12px;\n            padding: 0;\n            margin: 0;\n            \n            /* 颜色体系：背景用主题色，图标用背景色(通常是白色) */\n            background-color: var(--primary);\n            color: var(--background); \n            \n            /* 布局：绝对居中 */\n            display: flex;\n            align-items: center;\n            justify-content: center;\n            \n            /* 阴影与动画 */\n            box-shadow: 0 4px 12px rgba(0,0,0,0.15);\n            transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);\n        }\n        \n        .ud-fab:hover {\n            transform: scale(1.08) translateY(-2px);\n            box-shadow: 0 8px 20px rgba(0,0,0,0.25);\n            filter: brightness(1.1); /* 简单的悬浮变亮 */\n        }\n        \n        .ud-fab:active {\n            transform: scale(0.95);\n            filter: brightness(0.9);\n        }\n        \n        /* 强制 SVG 尺寸与颜色填充 */\n        .ud-fab svg {\n            width: 24px;\n            height: 24px;\n            fill: currentColor;\n            display: block; /* 消除基线间隙 */\n        }\n    `;
    shadow.appendChild(fabStyle);

    const applyTheme = () => {
        chrome.storage.local.get(['user_theme', 'custom_themes_list'], (res) => {
            const themeKey = res.user_theme || 'default';
            const customList = res.custom_themes_list || [];

            if (window.Theme && window.Theme.getThemeColor) {
                const color = window.Theme.getThemeColor(themeKey, customList);

                if (color) {
                    host.style.setProperty('--primary', color);
                    host.style.setProperty('--ring', color);
                } else {
                    host.style.removeProperty('--primary');
                    host.style.removeProperty('--ring');
                }
            }
        });
    };

    applyTheme();
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && (changes.user_theme || changes.custom_themes_list)) {
            applyTheme();
        }
    });
    const btn = document.createElement('button');

    btn.className = 'ud-fab';
    btn.innerHTML = window.Icons.download;

    btn.onclick = () => {
        activeTrigger = 'autoDownload';
        window.postMessage({ source: 'SakiDown', type: 'TRIGGER_SNIFF' }, '*');
    };

    shadow.appendChild(btn);
}

setTimeout(initQuickButton, 0);
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.show_quick_button) {
        if (changes.show_quick_button.newValue === true) {
            initQuickButton();
        } else {
            const el = document.getElementById(FAB_HOST_ID);

            if (el) el.remove();
        }
    }
});
function _getMaxFilesPerLink() {
    if (window._saki_max_files_per_link !== undefined) {
        return window._saki_max_files_per_link;
    }
    return 1;
}

chrome.storage.local.get(['search_max_files_per_link'], (res) => {
    window._saki_max_files_per_link = res.search_max_files_per_link ?? 1;
});
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.search_max_files_per_link) {
        window._saki_max_files_per_link = changes.search_max_files_per_link.newValue ?? 1;
    }
});

function collectSearchLinks() {
    // 从搜索页的视频卡片中提取链接
    const items = document.querySelectorAll('.video-item, .bili-video-card, .search-list-item');
    const urls = [];
    
    items.forEach(item => {
        const link = item.querySelector('a[href*="/video/"]');
        if (link) {
            const href = link.getAttribute('href');
            // 补全完整URL
            const fullUrl = href.startsWith('//') ? 'https:' + href : 
                           href.startsWith('/') ? 'https://www.bilibili.com' + href : href;
            if (fullUrl.includes('/video/BV')) {
                urls.push(fullUrl);
            }
        }
    });
    
    return urls;
}

function findNextPageBtn() {
    const allNext = [...document.querySelectorAll('a, button, span')].filter(el =>
        el.textContent.trim() === '下一页' && !el.classList.contains('disabled') && !el.disabled
    );
    return allNext.length > 0 ? allNext[0] : null;
}

/**
 * 自动翻页收集链接（简单循环版）
 * 每页收集链接→等用户设置的时间→点下一页→继续
 * Set 自动去重
 */
async function continuePaginationCollection() {
    const state = await chrome.storage.local.get(['_saki_paginate_state']);
    const raw = state._saki_paginate_state;
    if (!raw || !raw.running) return;

    const collected = new Set();
    const pageWait = raw.pageWait || 4000; // 翻页等待间隔
    const maxRounds = 100;

    for (let round = 0; round < maxRounds; round++) {
        // 先收集当前页所有链接（Set 自动去重）
        const currentLinks = collectSearchLinks();
        for (const url of currentLinks) {
            collected.add(url);
        }

        // 检查是否停止
        const check = await chrome.storage.local.get(['_saki_paginate_state']);
        if (!check._saki_paginate_state || !check._saki_paginate_state.running) return;

        // 收够了就返回
        if (collected.size >= raw.targetCount) {
            const links = [...collected].slice(0, raw.targetCount);
            await chrome.storage.local.remove('_saki_paginate_state');
            try { await chrome.runtime.sendMessage({ type: 'PAGINATE_COLLECTED', links }); } catch (_) {}
            return;
        }

        // 找下一页
        const nextBtn = findNextPageBtn();
        if (!nextBtn) {
            // 没有下一页了
            const links = [...collected];
            await chrome.storage.local.remove('_saki_paginate_state');
            try { await chrome.runtime.sendMessage({ type: 'PAGINATE_COLLECTED', links }); } catch (_) {}
            return;
        }

        // 点下一页
        nextBtn.click();

        // 等用户设置的秒数（让新页面渲染）
        await new Promise(r => setTimeout(r, pageWait));
    }
}

window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.source !== 'SakiDown') return;
    const data = event.data;

    if (data.type === 'UPDATE_WBI_KEYS') {

        chrome.runtime.sendMessage({ type: 'UPDATE_WBI_KEYS', payload: data.payload });

        return;
    }

    if (data.type === 'SNIFF_ERROR') {
        ui.showToast(data.msg || '暂时不支持该页面', 5000);
        activeTrigger = null;

        return;
    }

    if (data.type === 'SNIFF_FAILURE') {
        ui.showToast(data.msg || '数据获取失败，请刷新重试', 5000);
        activeTrigger = null;

        return;
    }

    if (data.type === 'metadata') {
        const payload = data.payload;

        if (activeTrigger === 'batch') {
            ui.showBatchModal(payload);
        } else if (activeTrigger === 'autoDownload') {
            const audioOnlyConfig = {
                audio: true, video: false,
                quality: { primary: 'best', secondary: 'dolby' },
                codec: { primary: 'av1', secondary: 'hevc' },
                merge: false, cover: false, danmaku: false,
                name: '纯音频',
            };
            let tasks = (payload || []).map(item => ({
                ...item,
                preference: { ...item.preference, strategy_config: audioOnlyConfig },
            }));
            const maxFiles = _getMaxFilesPerLink();
            if (maxFiles > 0 && tasks.length > maxFiles) {
                tasks = tasks.slice(0, maxFiles);
            }
            if (tasks.length > 0) {
                chrome.runtime.sendMessage({ type: 'BATCH_DOWNLOAD', payload: { tasks } }, () => {
                    chrome.runtime.sendMessage({ type: 'AUTO_DOWNLOAD_QUEUED' }).catch(() => {});
                });
                ui.showToast(`已添加 ${tasks.length} 个音频下载任务`, 3000);
            } else {
                chrome.runtime.sendMessage({ type: 'AUTO_DOWNLOAD_QUEUED' }).catch(() => {});
            }
        }

        activeTrigger = null;
    }
});
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'POPUP_INIT_CHECK') {
        sendResponse({ hasData: true, hasPlaylist: true, isSupported: true });

        return;
    }

    if (msg.type === 'POPUP_TRIGGER_BATCH') {
        activeTrigger = 'autoDownload';
        window.postMessage({ source: 'SakiDown', type: 'TRIGGER_SNIFF' }, '*');
        sendResponse({ status: 'ok' });

        return;
    }

    if (msg.type === 'DOWNLOAD_PROGRESS') {
        const { status: status } = msg.payload;

        if (status === 'done') {
            ui.showToast('下载任务已完成', 5000);
            SoundPlayer.play('default.wav');
        }

        if (status === 'error') ui.showToast('下载出错', 5000);
    }

    if (msg.type === 'POPUP_SHOW_TOAST') ui.showToast(msg.msg, 5000);

    // Search page: check page type
    if (msg.type === 'POPUP_CHECK_SEARCH') {
        sendResponse({ isSearch: isSearchPage() });
        return;
    }

    // Search page: collect video links (simple, no pagination)
    if (msg.type === 'POPUP_SCRAPE_SEARCH') {
        const links = collectSearchLinks();
        sendResponse({ links });
        return;
    }

    // Search page: start pagination collection (SPA loop version)
    if (msg.type === 'POPUP_SCRAPE_SEARCH_PAGINATE') {
        const targetCount = msg.targetCount || 20;
        const pageWait = msg.scrollDelay || 4000; // 翻页等待时间（毫秒），来自UI的间隔设置

        // Set running flag in storage so stop works
        chrome.storage.local.set({
            _saki_paginate_state: { running: true, targetCount, collected: [], pageWait }
        }).then(() => {
            // Kick off the loop - it sends PAGINATE_COLLECTED when done
            continuePaginationCollection();
        });

        return true; // keep channel open (response via PAGINATE_COLLECTED)
    }
});

// Listen for pagination completion (which comes from this content script after page navigation)
chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'PAGINATE_COLLECTED') {
        // This is received by the popup
    }
});

ui.onBatchConfirm((selectedItems, strategy_config, fullStrategy) => {
    if (selectedItems.length === 0) return;

    if (fullStrategy && fullStrategy.name) {
        strategy_config.name = fullStrategy.name;
    } else {
        strategy_config.name = '未知策略';
    }

    let shellTasks = selectedItems;

    shellTasks.map((item) => {
        item.preference.strategy_config = strategy_config;
    });

    sendToBackgroundQueue(shellTasks, false);
});

function sendToBackgroundQueue(tasks, isSingleMode) {
    chrome.runtime.sendMessage({ type: 'BATCH_DOWNLOAD', payload: { tasks: tasks } }, (res) => {
        if (res && res.status === 'success') {
            if (ui.hideModal) ui.hideModal();
            ui.showToast(`已添加 ${tasks.length} 个任务，点击任务管理按钮可以查看详情`, {
                duration: 0,
                actions: [
                    { text: '关闭', type: 'normal', callback: () => {} },
                    {
                        text: '任务管理',
                        type: 'normal',
                        callback: () => {
                            chrome.runtime.sendMessage({ type: 'OPEN_MANAGER' });
                        },
                    },
                ],
            });
        }
    });
}