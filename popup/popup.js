/**
 * @file popup/popup.js
 * @description 扩展弹窗入口逻辑
 */

document.addEventListener('DOMContentLoaded', async () => {
    // 图标
    if (window.Icons) {
        const inject = (el, n) => { const c = el?.querySelector('.icon'); if (c) c.innerHTML = window.Icons[n] || ''; };
        inject(document.getElementById('btn-download'), 'download');
        inject(document.getElementById('btn-manager'), 'manager');
    }

    // 读取配置
    chrome.storage.local.get(['task_interval', 'show_quick_button', 'search_delay', 'search_target_links', 'search_max_files_per_link'], (res) => {
        const intervalInput = document.getElementById('taskInterval');
        const showBtnCheck = document.getElementById('showQuickBtn');
        const searchDelayInput = document.getElementById('searchDelayInput');
        const targetLinkCountInput = document.getElementById('targetLinkCount');
        const maxFilesInput = document.getElementById('maxFilesPerLink');
        if (intervalInput) intervalInput.value = res.task_interval ?? 5;
        if (showBtnCheck) showBtnCheck.checked = res.show_quick_button !== false;
        if (searchDelayInput) searchDelayInput.value = res.search_delay ?? 5;
        if (targetLinkCountInput) targetLinkCountInput.value = res.search_target_links ?? 20;
        if (maxFilesInput) maxFilesInput.value = res.search_max_files_per_link ?? 1;
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
    document.getElementById('maxFilesPerLink')?.addEventListener('change', (e) => {
        const val = parseInt(e.target.value) || 1;
        chrome.storage.local.set({ search_max_files_per_link: Math.max(1, Math.min(50, val)) });
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
                pageTypeLabel.className = 'page-type unknown';
                return;
            }
            currentTabId = tab.id;

            // Try content script ping
            const resp = await sendMsgToTab(tab.id, { type: 'POPUP_CHECK_SEARCH' });
            if (resp && resp.isSearch) {
                pageTypeLabel.textContent = '🔍 搜索页';
                pageTypeLabel.className = 'page-type search';
                searchControls.classList.remove('hidden');
                return;
            }

            // Also check URL directly
            if (/^https?:\/\/search\.bilibili\.com\//.test(tab.url || '')) {
                pageTypeLabel.textContent = '🔍 搜索页';
                pageTypeLabel.className = 'page-type search';
                searchControls.classList.remove('hidden');
                return;
            }

            pageTypeLabel.textContent = '普通B站页面';
            pageTypeLabel.className = 'page-type normal';
            searchControls.classList.add('hidden');
        } catch (e) {
            pageTypeLabel.textContent = '非B站页面';
            pageTypeLabel.className = 'page-type unknown';
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

    // 获取搜索页链接（自动翻页）
    scrapeLinksBtn.addEventListener('click', async () => {
        if (!currentTabId) return;
        scrapeLinksBtn.disabled = true;
        scrapeLinksBtn.textContent = '⏳ 收集中...';
        const targetCount = parseInt(document.getElementById('targetLinkCount').value) || 20;
        const scrollDelay = parseInt(document.getElementById('searchDelayInput').value) * 1000 || 2000;
        setStatus(`📄 正在自动翻页收集视频链接，目标 ${targetCount} 个...`, 'info');

        // 设置等待标志，PAGINATE_COLLECTED 可能会在页面跳转后通过 background 中转发过来
        window._waitingForPaginate = true;

        // 发送消息给 content script（可能因翻页跳转而断开）
        sendMsgToTab(currentTabId, {
            type: 'POPUP_SCRAPE_SEARCH_PAGINATE',
            targetCount: targetCount,
            scrollDelay: scrollDelay
        }).then((resp) => {
            if (resp && resp.links) {
                // 立即得到了响应（第一页就够了或没有下一页）
                window._waitingForPaginate = false;
                collectedLinks = resp.links;
                searchLinkCount.textContent = collectedLinks.length;
                if (collectedLinks.length > 0) {
                    setStatus(`✅ 收集到 ${collectedLinks.length} 个视频链接${collectedLinks.length < targetCount ? '（已无更多页）' : ''}`, 'success');
                    startSearchCrawlBtn.disabled = false;
                } else {
                    setStatus('未找到视频链接', 'warn');
                }
                scrapeLinksBtn.disabled = false;
                scrapeLinksBtn.textContent = '🔗 获取视频链接（自动翻页）';
            }
            // 如果 resp 为空（翻页跳转导致断开），等待 PAGINATE_COLLECTED 消息
        }).catch(() => {
            // 跳转导致的断开，忽略，等 PAGINATE_COLLECTED
        });

        // 30 秒超时保护
        setTimeout(() => {
            if (window._waitingForPaginate) {
                window._waitingForPaginate = false;
                setStatus('⏰ 收集超时，请重新尝试', 'warn');
                scrapeLinksBtn.disabled = false;
                scrapeLinksBtn.textContent = '🔗 获取视频链接（自动翻页）';
            }
        }, 60000);
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

    // 停止批量下载（也停止翻页收集）
    stopSearchCrawlBtn.addEventListener('click', () => {
        setStatus('⏹️ 正在停止...', 'warn');
        // 停止下载爬取
        chrome.runtime.sendMessage({ type: 'SEARCH_CRAWL_STOP' }).catch(() => {});
        // 停止翻页收集（清除 storage state，翻页后不会再继续）
        chrome.runtime.sendMessage({ type: 'SEARCH_PAGINATE_STOP' }).catch(() => {});
        // 恢复按钮状态
        scrapeLinksBtn.disabled = false;
        scrapeLinksBtn.textContent = '🔗 获取视频链接（自动翻页）';
        startSearchCrawlBtn.disabled = false;
    });

    // 监听来自background的状态消息和翻页收集结果
    chrome.runtime.onMessage.addListener((msg) => {
        // 翻页收集完成
        if (msg.type === 'PAGINATE_COLLECTED') {
            if (msg.links && msg.links.length > 0) {
                collectedLinks = msg.links;
                searchLinkCount.textContent = collectedLinks.length;
                setStatus(`✅ 收集到 ${collectedLinks.length} 个视频链接`, 'success');
                startSearchCrawlBtn.disabled = false;
            } else {
                setStatus('未找到视频链接', 'warn');
            }
            scrapeLinksBtn.disabled = false;
            scrapeLinksBtn.textContent = '🔗 获取视频链接（自动翻页）';
            return;
        }

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
                    setStatus(`✅ 完成`, 'success');
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

    // 下载当前视频
    document.getElementById('btn-download')?.addEventListener('click', async () => {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab?.id) await chrome.tabs.sendMessage(tab.id, { type: 'POPUP_TRIGGER_BATCH' });
        } catch (e) {}
        window.close();
    });

    // 任务管理
    document.getElementById('btn-manager')?.addEventListener('click', async () => {
        const { saki_counter_queue: q = 0 } = await chrome.storage.local.get('saki_counter_queue');
        chrome.tabs.create({ url: `manager/manager.html?tab=${q > 0 ? 'active' : 'completed'}&page=1` });
        window.close();
    });
});