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
    chrome.storage.local.get(['task_interval', 'show_quick_button', 'search_delay', 'search_target_links'], (res) => {
        const intervalInput = document.getElementById('taskInterval');
        const showBtnCheck = document.getElementById('showQuickBtn');
        const searchDelayInput = document.getElementById('searchDelayInput');
        const targetLinkCountInput = document.getElementById('targetLinkCount');
        if (intervalInput) intervalInput.value = res.task_interval ?? 5;
        if (showBtnCheck) showBtnCheck.checked = res.show_quick_button !== false;
        if (searchDelayInput) searchDelayInput.value = res.search_delay ?? 5;
        if (targetLinkCountInput) targetLinkCountInput.value = res.search_target_links ?? 20;
    });

    // 保存配置
    document.getElementById('taskInterval')?.addEventListener('change', (e) => {
        const val = parseInt(e.target.value) || 5;
        chrome.storage.local.set({ task_interval: Math.max(0, Math.min(60, val)) });
    });
    document.getElementById('showQuickBtn')?.addEventListener('change', (e) => {
        chrome.storage.local.set({ show_quick_button: e.target.checked });
    });
    document.getElementById('searchDelayInput')?.addEventListener('change', (e) => {
        chrome.storage.local.set({ search_delay: parseFloat(e.target.value) || 5 });
    });
    document.getElementById('targetLinkCount')?.addEventListener('change', (e) => {
        chrome.storage.local.set({ search_target_links: parseInt(e.target.value) || 20 });
    });

    // ====== 搜索页批量下载相关 ======
    const pageTypeLabel = document.getElementById('pageTypeLabel');
    const searchControls = document.getElementById('searchControls');
    const scrapeLinksBtn = document.getElementById('scrapeLinksBtn');
    const startSearchCrawlBtn = document.getElementById('startSearchCrawlBtn');
    const stopSearchCrawlBtn = document.getElementById('stopSearchCrawlBtn');
    const searchLinkCount = document.getElementById('searchLinkCount');
    const statusBox = document.getElementById('statusBox');

    let currentTabId = null;
    let collectedLinks = [];

    // 检测当前页面是否为搜索页
    async function checkPageType() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab || !tab.id) {
                pageTypeLabel.textContent = '无法访问';
                pageTypeLabel.className = 'page-type-label unknown';
                return;
            }
            currentTabId = tab.id;

            // Try content script ping
            const resp = await sendMsgToTab(tab.id, { type: 'POPUP_CHECK_SEARCH' });
            if (resp && resp.isSearch) {
                pageTypeLabel.textContent = '🔍 搜索页';
                pageTypeLabel.className = 'page-type-label search';
                searchControls.classList.remove('hidden');
                return;
            }

            // Also check URL directly
            if (/^https?:\/\/search\.bilibili\.com\//.test(tab.url || '')) {
                pageTypeLabel.textContent = '🔍 搜索页';
                pageTypeLabel.className = 'page-type-label search';
                searchControls.classList.remove('hidden');
                return;
            }

            pageTypeLabel.textContent = '普通B站页面';
            pageTypeLabel.className = 'page-type-label normal';
            searchControls.classList.add('hidden');
        } catch (e) {
            pageTypeLabel.textContent = '非B站页面';
            pageTypeLabel.className = 'page-type-label unknown';
            searchControls.classList.add('hidden');
        }
    }

    function sendMsgToTab(tabId, msg) {
        return new Promise((resolve) => {
            chrome.tabs.sendMessage(tabId, msg, (r) => {
                resolve(chrome.runtime.lastError ? null : r);
            });
        });
    }

    function setStatus(msg, type = 'info') {
        const div = document.createElement('div');
        div.className = type;
        div.textContent = msg;
        statusBox.appendChild(div);
        statusBox.scrollTop = statusBox.scrollHeight;
    }

    // 获取搜索页链接
    scrapeLinksBtn.addEventListener('click', async () => {
        if (!currentTabId) return;
        scrapeLinksBtn.disabled = true;
        scrapeLinksBtn.textContent = '⏳ 获取中...';
        setStatus('正在收集视频链接...', 'info');

        try {
            const resp = await sendMsgToTab(currentTabId, { type: 'POPUP_SCRAPE_SEARCH' });
            if (resp && resp.links && resp.links.length > 0) {
                collectedLinks = resp.links;
                searchLinkCount.textContent = collectedLinks.length;
                setStatus(`✅ 找到 ${collectedLinks.length} 个视频链接`, 'success');
                startSearchCrawlBtn.disabled = false;
            } else {
                setStatus('未找到视频链接，请确认页面已加载', 'warn');
            }
        } catch (err) {
            setStatus('获取链接失败: ' + (err.message || '未知错误'), 'error');
        } finally {
            scrapeLinksBtn.disabled = false;
            scrapeLinksBtn.textContent = '🔗 获取链接';
        }
    });

    // 开始批量下载
    startSearchCrawlBtn.addEventListener('click', () => {
        if (collectedLinks.length === 0) {
            setStatus('请先获取视频链接', 'warn');
            return;
        }
        const delay = Math.max(1000, parseFloat(document.getElementById('searchDelayInput').value) * 1000);
        startSearchCrawlBtn.disabled = true;
        scrapeLinksBtn.disabled = true;
        setStatus(`▶️ 开始批量下载 ${collectedLinks.length} 个视频音频`, 'info');

        chrome.runtime.sendMessage({
            type: 'SEARCH_CRAWL_START',
            links: collectedLinks,
            delay: delay,
            searchTabId: currentTabId
        }).catch(() => {});
    });

    // 停止批量下载
    stopSearchCrawlBtn.addEventListener('click', () => {
        setStatus('⏹️ 正在停止...', 'warn');
        chrome.runtime.sendMessage({ type: 'SEARCH_CRAWL_STOP' }).catch(() => {});
    });

    // 监听来自background的状态消息
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.type === 'SEARCH_CRAWL_STATUS') {
            switch (msg.status) {
                case 'opening':
                    setStatus(`📂 打开 (${msg.current}/${msg.total}): ${msg.title || msg.url}`, 'info');
                    break;
                case 'downloading':
                    setStatus(`⬇️ 正在下载音频...`, 'info');
                    break;
                case 'waiting':
                    setStatus(`⏳ 等待间隔... (剩余${msg.remaining})`, 'info');
                    break;
                case 'done':
                    setStatus(`✅ ${msg.url || ''} 完成`, 'success');
                    startSearchCrawlBtn.disabled = false;
                    scrapeLinksBtn.disabled = false;
                    break;
                case 'stopped':
                    setStatus(`⏹️ 已停止 (已完成 ${msg.completed}/${msg.total})`, 'warn');
                    startSearchCrawlBtn.disabled = false;
                    scrapeLinksBtn.disabled = false;
                    break;
                case 'error':
                    setStatus(`❌ ${msg.error || '发生错误'}`, 'error');
                    break;
                case 'finished':
                    setStatus(`🎉 全部完成！共处理 ${msg.completed} 个视频`, 'success');
                    startSearchCrawlBtn.disabled = false;
                    scrapeLinksBtn.disabled = false;
                    break;
            }
        }
    });

    // 初始化
    await checkPageType();

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