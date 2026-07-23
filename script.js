/* ============================================
   Flow & Anchor - 核心逻辑
   ============================================ */

// ============ 数据层 ============
let tasks = JSON.parse(localStorage.getItem('fa_tasks')) || [];
let habits = JSON.parse(localStorage.getItem('fa_habits')) || [];
let northStars = JSON.parse(localStorage.getItem('fa_northstars')) || [];
let appData = JSON.parse(localStorage.getItem('fa_app')) || { lastOpenDate: null, todayNorthStar: null };

let currentPage = 'daily';
let nextId = parseInt(localStorage.getItem('fa_nextId')) || 1;

// DOM 元素
const menuBtn = document.getElementById('menuBtn');
const inboxBtn = document.getElementById('inboxBtn');
const inboxBadge = document.getElementById('inboxBadge');
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebarOverlay');
const headerTitle = document.getElementById('headerTitle');
const content = document.getElementById('content');
const inputBar = document.getElementById('inputBar');
const quickInput = document.getElementById('quickInput');
const sendBtn = document.getElementById('sendBtn');
const actionSheetOverlay = document.getElementById('actionSheetOverlay');
const actionSheet = document.getElementById('actionSheet');
const effortSheetOverlay = document.getElementById('effortSheetOverlay');
const effortSheet = document.getElementById('effortSheet');

let currentTaskId = null; // 当前操作的任务 ID
let effortTaskId = null;  // 设置精力时保存的任务 ID
let backPressTime = 0;    // 记录返回键按下时间，用于双击退出

// ============ 初始化 ============
function init() {
    performDailyReset();
    renderPage();
    bindEvents();
    setupBackButton();
}

// 跨日重置逻辑
function performDailyReset() {
    const today = getToday();
    if (appData.lastOpenDate !== today) {
        // 唤醒到期的休眠任务
        tasks.forEach(t => {
            if (t.status === 'tickler' && t.wakeDate && t.wakeDate <= today) {
                t.status = 'pool';
                t.isJustWoken = true;
                t.wasFromTickler = true; // 永久标记：曾从休眠舱唤醒
            }
        });
        // 清除昨天的日程
        tasks.forEach(t => {
            if (t.scheduledDate && t.scheduledDate < today) {
                t.scheduledDate = null;
            }
        });
        // 随机选一条灯塔语录
        if (northStars.length > 0) {
            appData.todayNorthStar = northStars[Math.floor(Math.random() * northStars.length)];
        }
        appData.lastOpenDate = today;
        saveAll();
    }
}

// ============ 事件绑定 ============
function bindEvents() {
    // 侧边栏
    menuBtn.addEventListener('click', () => toggleSidebar(true));
    sidebarOverlay.addEventListener('click', () => toggleSidebar(false));
    
    document.querySelectorAll('.sidebar-item').forEach(item => {
        item.addEventListener('click', () => {
            currentPage = item.dataset.page;
            document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            toggleSidebar(false);
            renderPage();
        });
    });
    
    // 收件箱按钮 -> 直接进入分拣
    inboxBtn.addEventListener('click', () => {
        currentPage = 'router';
        // 分拣引擎不在侧边栏中，取消所有侧边栏高亮
        document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
        renderPage();
    });
    
    // 底部输入栏
    sendBtn.addEventListener('click', submitQuickInput);
    quickInput.addEventListener('keypress', e => {
        if (e.key === 'Enter') submitQuickInput();
    });
    
    // Action Sheet 事件
    actionSheetOverlay.addEventListener('click', e => {
        if (e.target === actionSheetOverlay) closeActionSheet();
    });
    
    actionSheet.querySelectorAll('[data-action]').forEach(item => {
        item.addEventListener('click', () => handleAction(item.dataset.action));
    });
    
    effortSheetOverlay.addEventListener('click', e => {
        if (e.target === effortSheetOverlay) closeEffortSheet();
    });
    
    effortSheet.querySelectorAll('[data-effort]').forEach(item => {
        item.addEventListener('click', () => {
            setTaskEffort(item.dataset.effort);
            closeEffortSheet();
        });
    });
    
    effortSheet.querySelector('[data-action="cancel"]').addEventListener('click', closeEffortSheet);
}

function toggleSidebar(show) {
    sidebar.classList.toggle('show', show);
    sidebarOverlay.classList.toggle('show', show);
}

function submitQuickInput() {
    const text = quickInput.value.trim();
    if (!text) return;
    
    tasks.push({
        id: nextId++,
        content: text,
        status: 'inbox',
        effort: null,
        wakeDate: null,
        scheduledDate: null,
        isJustWoken: false,
        notes: null,
        createdAt: new Date().toISOString()
    });
    saveAll();
    quickInput.value = '';
    updateInboxBadge();
    showToast('✓ 已发送到收件箱');
}

function updateInboxBadge() {
    const count = tasks.filter(t => t.status === 'inbox').length;
    inboxBadge.textContent = count;
    inboxBadge.classList.toggle('hidden', count === 0);
}

function updateInputBarVisibility() {
    // 在分拣引擎和设置页面隐藏输入栏
    inputBar.classList.toggle('hidden', currentPage === 'router' || currentPage === 'settings');
}

// ============ 页面渲染 ============
function renderPage() {
    const titles = {
        daily: '🎯 今日看板',
        router: '📮 分拣引擎',
        pool: '📥 任务库',
        tickler: '⏰ 休眠舱',
        habits: '🔋 习惯追踪',
        northstar: '💡 灯塔区',
        inprogress: '🚀 正在进行',
        archive: '📦 归档',
        settings: '⚙️ 设置'
    };
    headerTitle.textContent = titles[currentPage] || '流与锚';
    
    updateInboxBadge();
    updateInputBarVisibility();
    
    switch(currentPage) {
        case 'daily': renderDaily(); break;
        case 'router': renderRouter(); break;
        case 'pool': renderPool(); break;
        case 'tickler': renderTickler(); break;
        case 'habits': renderHabits(); break;
        case 'northstar': renderNorthStar(); break;
        case 'inprogress': renderInProgress(); break;
        case 'archive': renderArchive(); break;
        case 'settings': renderSettings(); break;
    }
}

// ============ 今日看板 ============
let todayExpanded = false;

function renderDaily() {
    const today = getToday();
    // 按添加顺序排序（scheduledOrder）
    const allTodayTasks = tasks
        .filter(t => t.status === 'pool' && t.scheduledDate === today)
        .sort((a, b) => (a.scheduledOrder || 0) - (b.scheduledOrder || 0));
    
    const todayTasks = todayExpanded ? allTodayTasks : allTodayTasks.slice(0, 3);
    const totalCount = allTodayTasks.length;
    const todayHabits = habits;
    const doneCount = todayHabits.filter(h => h.completedDates && h.completedDates.includes(today)).length;
    
    content.innerHTML = `
        <div class="card">
            <div class="card-header">
                <span>💡 今日灯塔</span>
                <button class="task-btn" onclick="refreshNorthStar()">🔄</button>
            </div>
            <div class="card-body">
                ${appData.todayNorthStar 
                    ? `<p style="text-align:center;font-style:italic;color:var(--text-light);line-height:1.6;font-size:0.9rem">${appData.todayNorthStar}</p>`
                    : `<p class="empty-text">暂无灯塔语录，去添加一些吧！</p>`
                }
            </div>
        </div>
        
        <div class="card">
            <div class="card-header">
                <span>🔋 今日习惯</span>
                <span style="font-size:0.8rem;color:var(--text-muted)">${doneCount}/${todayHabits.length}</span>
            </div>
            <div class="card-body">
                ${todayHabits.length === 0 
                    ? `<p class="empty-text">暂无习惯，去习惯追踪添加吧</p>`
                    : todayHabits.map(h => {
                        const done = h.completedDates && h.completedDates.includes(today);
                        return `
                            <div class="habit-item ${done ? 'done' : ''}" onclick="toggleHabit(${h.id})">
                                <span class="habit-icon">${h.icon || '✨'}</span>
                                <span class="habit-name">${h.name}</span>
                                <span class="habit-check">${done ? '✅' : '⬜'}</span>
                            </div>
                        `;
                    }).join('')
                }
            </div>
        </div>
        
        <div class="card">
            <div class="card-header">
                <span>📋 今日任务</span>
                <div style="display:flex;align-items:center;gap:8px">
                    <span style="font-size:0.8rem;color:var(--text-muted)">${totalCount}项</span>
                    <button class="browse-btn-sm" onclick="goToPoolBrowse()">🃏 挑选</button>
                </div>
            </div>
            <div class="card-body">
                ${todayTasks.length === 0 
                    ? `<p class="empty-text">今天还没有安排任务</p>`
                    : `
                        <div id="todayTaskList" class="today-task-list">
                            ${todayTasks.map((t, i) => `
                                <div class="task-item draggable" data-id="${t.id}" draggable="true">
                                    <span class="drag-handle">☰</span>
                                    <span class="task-num">${i + 1}</span>
                                    ${t.wasFromTickler ? '<span class="tickler-badge">⏰</span>' : ''}
                                    <span class="task-text">${t.content}</span>
                                    ${t.effort ? `<span class="task-effort">${t.effort}</span>` : ''}
                                    <div class="task-actions">
                                        <button class="task-btn" onclick="completeTask(${t.id})">✓</button>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                        ${totalCount > 3 ? `
                            <div class="expand-btn" onclick="toggleTodayExpand()">
                                ${todayExpanded ? '收起 ▲' : `展开全部 (${totalCount}) ▼`}
                            </div>
                        ` : ''}
                    `
                }
            </div>
        </div>
    `;
    
    // 绑定拖拽事件
    if (todayTasks.length > 0) {
        setupTodayDragDrop();
    }
}

function toggleTodayExpand() {
    todayExpanded = !todayExpanded;
    renderDaily();
}

function setupTodayDragDrop() {
    const list = document.getElementById('todayTaskList');
    if (!list) return;
    
    let draggedItem = null;
    
    list.querySelectorAll('.draggable').forEach(item => {
        item.addEventListener('dragstart', e => {
            draggedItem = item;
            item.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });
        
        item.addEventListener('dragend', () => {
            item.classList.remove('dragging');
            draggedItem = null;
            saveTodayOrder();
        });
        
        item.addEventListener('dragover', e => {
            e.preventDefault();
            if (!draggedItem || draggedItem === item) return;
            
            const rect = item.getBoundingClientRect();
            const midY = rect.top + rect.height / 2;
            
            if (e.clientY < midY) {
                item.parentNode.insertBefore(draggedItem, item);
            } else {
                item.parentNode.insertBefore(draggedItem, item.nextSibling);
            }
        });
    });
}

function saveTodayOrder() {
    const list = document.getElementById('todayTaskList');
    if (!list) return;
    
    const items = list.querySelectorAll('.draggable');
    items.forEach((item, index) => {
        const id = parseInt(item.dataset.id);
        const task = tasks.find(t => t.id === id);
        if (task) {
            task.scheduledOrder = index;
        }
    });
    
    saveAll();
    renderDaily();
}

// ============ 分拣引擎 ============
let routerIndex = 0;
let routerTasks = [];

function renderRouter() {
    routerTasks = tasks.filter(t => t.status === 'inbox');
    routerIndex = 0;
    renderRouterCard();
}

function renderRouterCard() {
    if (routerTasks.length === 0 || routerIndex >= routerTasks.length) {
        content.innerHTML = `
            <div class="router-container">
                <div class="empty-state">
                    <div class="empty-icon">📭</div>
                    <div class="empty-text">收件箱已清空！</div>
                    <div class="empty-hint">点击右上角 ＋ 添加新任务</div>
                </div>
            </div>
        `;
        return;
    }
    
    const task = routerTasks[routerIndex];
    content.innerHTML = `
        <div class="router-container">
            <div class="router-card" id="routerCard">
                <div class="router-card-text">${task.content}</div>
                <div class="router-card-time">创建于 ${formatDate(task.createdAt)}</div>
                <div class="router-card-actions">
                    <button class="btn-ghost" onclick="editRouterTask()">✏️ 编辑</button>
                    <button class="btn-ghost" onclick="deleteRouterTask()">🗑️ 删除</button>
                </div>
            </div>
            
            <div class="router-buttons">
                <div class="router-btn left" onclick="routeTask('pool')">
                    <span>📥</span>
                    <small>先放着</small>
                </div>
                <div class="router-btn down" onclick="routeTask('tickler')">
                    <span>⏰</span>
                    <small>到点做</small>
                </div>
                <div class="router-btn right" onclick="routeTask('today')">
                    <span>🎯</span>
                    <small>今天做</small>
                </div>
            </div>
            
            <div class="router-hint">← 先放着 · ↓ 到点做 · → 今天做</div>
        </div>
    `;
    
    setupSwipeGesture();
}

function setupSwipeGesture() {
    const card = document.getElementById('routerCard');
    if (!card) return;
    
    let startX = 0, startY = 0, deltaX = 0, deltaY = 0;
    
    card.addEventListener('touchstart', e => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        card.classList.add('swiping');
    });
    
    card.addEventListener('touchmove', e => {
        deltaX = e.touches[0].clientX - startX;
        deltaY = e.touches[0].clientY - startY;
        const rotate = deltaX * 0.05;
        card.style.transform = `translate(${deltaX}px, ${deltaY}px) rotate(${rotate}deg)`;
    });
    
    card.addEventListener('touchend', () => {
        card.classList.remove('swiping');
        const threshold = 80;
        
        if (Math.abs(deltaX) > threshold && Math.abs(deltaX) > Math.abs(deltaY)) {
            if (deltaX > 0) routeTask('today');
            else routeTask('pool');
        } else if (deltaY > threshold) {
            routeTask('tickler');
        } else {
            card.style.transform = '';
        }
        deltaX = 0;
        deltaY = 0;
    });
}

function routeTask(target) {
    const task = routerTasks[routerIndex];
    if (!task) return;
    
    if (target === 'today') {
        task.status = 'pool';
        task.scheduledDate = getToday();
        showToast('✓ 已添加到今日任务');
    } else if (target === 'pool') {
        task.status = 'pool';
        showToast('✓ 已放入任务库');
    } else if (target === 'tickler') {
        const days = prompt('几天后唤醒？', '7');
        if (!days) {
            renderRouterCard();
            return;
        }
        const d = new Date();
        d.setDate(d.getDate() + parseInt(days));
        task.status = 'tickler';
        task.wakeDate = d.toISOString().split('T')[0];
        showToast(`✓ 将在 ${days} 天后唤醒`);
    }
    
    routerIndex++;
    saveAll();
    renderRouterCard();
}

function editRouterTask() {
    const task = routerTasks[routerIndex];
    const newText = prompt('编辑任务内容：', task.content);
    if (newText && newText.trim()) {
        task.content = newText.trim();
        saveAll();
        renderRouterCard();
    }
}

function deleteRouterTask() {
    if (!confirm('确定删除这个任务吗？')) return;
    const task = routerTasks[routerIndex];
    tasks = tasks.filter(t => t.id !== task.id);
    routerTasks = routerTasks.filter(t => t.id !== task.id);
    saveAll();
    renderRouterCard();
}

// ============ 任务库 ============
let poolBrowseMode = false;
let poolBrowseIndex = 0;
let poolBrowseTasks = [];
let poolBrowseSource = 'pool'; // 'pool' 或 'daily'，记录从哪里进入

function renderPool() {
    // wasFromTickler 是永久标记，用于分类显示
    const fromTickler = tasks.filter(t => t.status === 'pool' && t.wasFromTickler);
    const regular = tasks.filter(t => t.status === 'pool' && !t.wasFromTickler);
    const totalPoolTasks = fromTickler.length + regular.length;
    
    content.innerHTML = `
        <div class="pool-header">
            <span>共 ${totalPoolTasks} 项任务</span>
            ${totalPoolTasks > 0 ? `<button class="browse-btn" onclick="startPoolBrowse()">🃏 卡片浏览</button>` : ''}
        </div>
        
        ${fromTickler.length > 0 ? `
            <div class="section-title">
                <span>⏰ 定时任务</span>
                <span class="section-count">${fromTickler.length}</span>
            </div>
            ${fromTickler.map(t => renderPoolTask(t, true)).join('')}
        ` : ''}
        
        <div class="section-title">
            <span>📋 常规任务</span>
            <span class="section-count">${regular.length}</span>
        </div>
        ${regular.length === 0 
            ? `<div class="empty-state"><div class="empty-icon">📋</div><div class="empty-text">暂无任务</div></div>`
            : regular.map(t => renderPoolTask(t, false)).join('')
        }
    `;
}

// 从首页直接进入卡片浏览（只显示未添加到今日的任务）
function goToPoolBrowse() {
    poolBrowseSource = 'daily'; // 记录来源是首页
    const today = getToday();
    // 过滤掉已经在今日任务中的
    poolBrowseTasks = tasks.filter(t => t.status === 'pool' && t.scheduledDate !== today);
    poolBrowseIndex = 0;
    poolBrowseMode = true;
    
    if (poolBrowseTasks.length === 0) {
        showToast('任务库中没有可挑选的任务');
        return;
    }
    
    // 切换到任务库页面显示卡片浏览
    currentPage = 'pool';
    document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
    document.querySelector('[data-page="pool"]').classList.add('active');
    renderPoolBrowseCard();
}

function startPoolBrowse() {
    poolBrowseSource = 'pool'; // 记录来源是任务库
    poolBrowseTasks = tasks.filter(t => t.status === 'pool');
    poolBrowseIndex = 0;
    poolBrowseMode = true;
    renderPoolBrowseCard();
}

function renderPoolBrowseCard() {
    if (poolBrowseTasks.length === 0) {
        exitPoolBrowse();
        return;
    }
    
    const task = poolBrowseTasks[poolBrowseIndex];
    const isScheduledToday = task.scheduledDate === getToday();
    
    content.innerHTML = `
        <div class="browse-header">
            <button class="browse-close" onclick="exitPoolBrowse()">✕ 退出</button>
            <span class="browse-progress">${poolBrowseIndex + 1} / ${poolBrowseTasks.length}</span>
            <button class="browse-skip" onclick="skipPoolTask()">跳过 →</button>
        </div>
        
        <div class="pool-browse-card" id="poolBrowseCard">
            <div class="pool-card-content">
                ${task.wasFromTickler ? '<div class="pool-card-badge">⏰ 定时任务</div>' : ''}
                <div class="pool-card-text">${task.content}</div>
                ${task.effort ? `<div class="pool-card-effort">${task.effort}</div>` : ''}
                <div class="pool-card-time">创建于 ${formatDate(task.createdAt)}</div>
            </div>
        </div>
        
        <div class="pool-browse-actions">
            ${isScheduledToday 
                ? `<button class="pool-action-btn cancel" onclick="poolRemoveFromToday()">✗ 取消今日</button>`
                : `<button class="pool-action-btn today" onclick="poolAddToToday()">🎯 今天做</button>`
            }
            <button class="pool-action-btn sleep" onclick="poolSendToTickler()">⏰ 休眠</button>
            <button class="pool-action-btn done" onclick="poolCompleteTask()">✓ 完成</button>
        </div>
        
        <div class="pool-browse-hint">左右滑动跳过 · 点击按钮操作</div>
    `;
    
    setupPoolSwipe();
}

function setupPoolSwipe() {
    const card = document.getElementById('poolBrowseCard');
    if (!card) return;
    
    let startX = 0;
    let currentX = 0;
    
    card.addEventListener('touchstart', e => {
        startX = e.touches[0].clientX;
    });
    
    card.addEventListener('touchmove', e => {
        currentX = e.touches[0].clientX;
        const diff = currentX - startX;
        card.style.transform = `translateX(${diff * 0.5}px) rotate(${diff * 0.02}deg)`;
    });
    
    card.addEventListener('touchend', () => {
        const diff = currentX - startX;
        card.style.transform = '';
        if (Math.abs(diff) > 80) {
            skipPoolTask();
        }
    });
}

function skipPoolTask() {
    poolBrowseIndex++;
    if (poolBrowseIndex >= poolBrowseTasks.length) {
        // 浏览完所有任务，自动退出
        showToast('✓ 已浏览完所有任务');
        exitPoolBrowse();
        return;
    }
    renderPoolBrowseCard();
}

function poolAddToToday() {
    const task = poolBrowseTasks[poolBrowseIndex];
    task.scheduledDate = getToday();
    task.scheduledOrder = Date.now();
    saveAll();
    showToast('✓ 已添加到今日');
    poolBrowseTasks.splice(poolBrowseIndex, 1);
    if (poolBrowseIndex >= poolBrowseTasks.length) poolBrowseIndex = 0;
    renderPoolBrowseCard();
}

function poolRemoveFromToday() {
    const task = poolBrowseTasks[poolBrowseIndex];
    task.scheduledDate = null;
    saveAll();
    showToast('✓ 已取消今日安排');
    renderPoolBrowseCard();
}

function poolSendToTickler() {
    const days = prompt('几天后唤醒？', '7');
    if (!days) return;
    
    const task = poolBrowseTasks[poolBrowseIndex];
    const d = new Date();
    d.setDate(d.getDate() + parseInt(days));
    task.status = 'tickler';
    task.wakeDate = d.toISOString().split('T')[0];
    saveAll();
    showToast(`✓ 将在 ${days} 天后唤醒`);
    
    poolBrowseTasks.splice(poolBrowseIndex, 1);
    if (poolBrowseIndex >= poolBrowseTasks.length) poolBrowseIndex = 0;
    renderPoolBrowseCard();
}

function poolCompleteTask() {
    const task = poolBrowseTasks[poolBrowseIndex];
    task.status = 'completed';
    task.completedAt = new Date().toISOString();
    saveAll();
    showToast('✓ 任务完成！');
    
    poolBrowseTasks.splice(poolBrowseIndex, 1);
    if (poolBrowseIndex >= poolBrowseTasks.length) poolBrowseIndex = 0;
    renderPoolBrowseCard();
}

function exitPoolBrowse() {
    poolBrowseMode = false;
    
    // 根据来源返回不同页面
    if (poolBrowseSource === 'daily') {
        currentPage = 'daily';
        document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
        document.querySelector('[data-page="daily"]').classList.add('active');
        renderDaily();
    } else {
        renderPool();
    }
}

function renderPoolTask(t, isFromTickler) {
    const today = getToday();
    const isScheduledToday = t.scheduledDate === today;
    let classes = 'task-item';
    if (isFromTickler) classes += ' from-tickler';
    if (isScheduledToday) classes += ' scheduled-today';
    
    // 定时任务显示小闹钟图标（低调的永久标记）
    const ticklerBadge = t.wasFromTickler ? '<span class="tickler-badge">⏰</span>' : '';
    
    return `
        <div class="${classes}">
            ${ticklerBadge}
            <span class="task-text">${t.content}</span>
            ${t.effort ? `<span class="task-effort">${t.effort}</span>` : ''}
            <div class="task-actions">
                ${isScheduledToday 
                    ? `<button class="task-btn" onclick="removeFromToday(${t.id})" title="取消今日">✗</button>`
                    : `<button class="task-btn" onclick="addToToday(${t.id})" title="添加到今日">🎯</button>`
                }
                <button class="task-btn" onclick="sendToTickler(${t.id})" title="休眠">⏰</button>
                <button class="task-btn" onclick="completeTask(${t.id})" title="完成">✓</button>
                <button class="task-btn" onclick="showTaskMenu(${t.id})" title="更多">⋯</button>
            </div>
        </div>
    `;
}

// ============ 休眠舱 ============
function renderTickler() {
    const ticklerTasks = tasks.filter(t => t.status === 'tickler');
    const today = getToday();
    
    // 按唤醒日期分组
    const grouped = {};
    ticklerTasks.forEach(t => {
        const date = t.wakeDate || '未设置';
        if (!grouped[date]) grouped[date] = [];
        grouped[date].push(t);
    });
    
    const sortedDates = Object.keys(grouped).sort();
    
    content.innerHTML = `
        <div class="info-box">
            <p>💤 这里是正在休眠的任务</p>
            <p>到达唤醒日期后会自动进入任务库</p>
        </div>
        
        ${ticklerTasks.length === 0 
            ? `<div class="empty-state"><div class="empty-icon">😴</div><div class="empty-text">休眠舱是空的</div></div>`
            : sortedDates.map(date => {
                const isOverdue = date !== '未设置' && date <= today;
                return `
                    <div class="date-group">
                        <div class="date-label ${isOverdue ? 'overdue' : ''}">${date === today ? '📍 今天' : (isOverdue ? '⚠️ ' + date : '📅 ' + date)}</div>
                        ${grouped[date].map(t => `
                            <div class="task-item">
                                <span class="task-text">${t.content}</span>
                                <div class="task-actions">
                                    <button class="task-btn" onclick="wakeTask(${t.id})">🌅</button>
                                    <button class="task-btn" onclick="rescheduleTask(${t.id})">📅</button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `;
            }).join('')
        }
    `;
}

// ============ 习惯追踪 ============
function renderHabits() {
    const today = getToday();
    
    content.innerHTML = `
        <div class="info-box">
            <p>🌱 培养好习惯，一步一个脚印</p>
        </div>
        
        <button class="btn-primary" style="margin-bottom:20px" onclick="addHabit()">＋ 添加新习惯</button>
        
        ${habits.length === 0 
            ? `<div class="empty-state"><div class="empty-icon">🌱</div><div class="empty-text">还没有添加习惯</div></div>`
            : habits.map(h => {
                const done = h.completedDates && h.completedDates.includes(today);
                const streak = calcStreak(h.completedDates || []);
                const total = (h.completedDates || []).length;
                return `
                    <div class="card" style="margin-bottom:12px">
                        <div class="card-body" style="display:flex;align-items:center;gap:12px">
                            <span style="font-size:1.8rem">${h.icon || '✨'}</span>
                            <div style="flex:1">
                                <div style="font-weight:600">${h.name}</div>
                                <div style="font-size:0.8rem;color:var(--text-muted)">连续 ${streak} 天 · 累计 ${total} 次</div>
                            </div>
                            <button class="task-btn" onclick="toggleHabit(${h.id})">${done ? '✅' : '⬜'}</button>
                            <button class="task-btn" onclick="deleteHabit(${h.id})">🗑️</button>
                        </div>
                    </div>
                `;
            }).join('')
        }
    `;
}

function calcStreak(dates) {
    if (!dates || dates.length === 0) return 0;
    const sorted = [...dates].sort().reverse();
    const today = getToday();
    const yesterday = getYesterday();
    
    if (sorted[0] !== today && sorted[0] !== yesterday) return 0;
    
    let streak = 1;
    let current = new Date(sorted[0]);
    
    for (let i = 1; i < sorted.length; i++) {
        const prev = new Date(current);
        prev.setDate(prev.getDate() - 1);
        if (sorted[i] === prev.toISOString().split('T')[0]) {
            streak++;
            current = prev;
        } else {
            break;
        }
    }
    return streak;
}

// ============ 灯塔区 ============
function renderNorthStar() {
    content.innerHTML = `
        <div class="info-box">
            <p>✨ 收集那些能激励你的话语</p>
            <p>每天会随机选取一条显示在今日看板</p>
        </div>
        
        <button class="btn-primary" style="margin-bottom:20px" onclick="addNorthStar()">＋ 添加语录</button>
        
        ${northStars.length === 0 
            ? `<div class="empty-state"><div class="empty-icon">💭</div><div class="empty-text">还没有灯塔语录</div></div>`
            : northStars.map((text, i) => `
                <div class="northstar-item">
                    ${text}
                    <div class="northstar-actions">
                        <button class="task-btn" onclick="editNorthStar(${i})">✏️</button>
                        <button class="task-btn" onclick="deleteNorthStar(${i})">🗑️</button>
                    </div>
                </div>
            `).join('')
        }
    `;
}

// ============ 正在进行 ============
function renderInProgress() {
    const inProgressTasks = tasks.filter(t => t.status === 'inprogress');
    
    content.innerHTML = `
        <div class="info-box">
            <p>🎯 大型进行中的项目或任务</p>
            <p>需要持续关注但不是每日任务</p>
        </div>
        
        ${inProgressTasks.length === 0 
            ? `<div class="empty-state"><div class="empty-icon">🚀</div><div class="empty-text">暂无进行中的项目</div><div class="empty-hint">在任务库中将任务标记为"正在进行"</div></div>`
            : inProgressTasks.map(t => `
                <div class="task-item" style="border-left:3px solid var(--dusty-pink)">
                    <span class="task-text">${t.content}</span>
                    <div class="task-actions">
                        <button class="task-btn" onclick="moveToPool(${t.id})">📥</button>
                        <button class="task-btn" onclick="completeTask(${t.id})">✓</button>
                    </div>
                </div>
            `).join('')
        }
    `;
}

// ============ 归档 ============
function renderArchive() {
    const archivedTasks = tasks.filter(t => t.status === 'completed' || t.status === 'archived');
    archivedTasks.sort((a, b) => (b.completedAt || b.createdAt).localeCompare(a.completedAt || a.createdAt));
    
    content.innerHTML = `
        <div class="info-box">
            <p>📚 已完成或归档的任务</p>
        </div>
        
        ${archivedTasks.length === 0 
            ? `<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-text">归档是空的</div></div>`
            : archivedTasks.slice(0, 50).map(t => `
                <div class="task-item" style="opacity:0.7">
                    <span class="task-text" style="text-decoration:${t.status === 'completed' ? 'line-through' : 'none'}">${t.content}</span>
                    <div class="task-actions">
                        <button class="task-btn" onclick="restoreTask(${t.id})">↩️</button>
                        <button class="task-btn" onclick="permanentDelete(${t.id})">🗑️</button>
                    </div>
                </div>
            `).join('')
        }
    `;
}

// ============ 操作函数 ============
function completeTask(id) {
    const task = tasks.find(t => t.id === id);
    if (task) {
        task.status = 'completed';
        task.completedAt = new Date().toISOString();
        saveAll();
        showToast('✓ 任务完成！');
        renderPage();
    }
}

function addToToday(id) {
    const task = tasks.find(t => t.id === id);
    if (task) {
        task.scheduledDate = getToday();
        task.scheduledOrder = Date.now(); // 记录添加顺序
        saveAll();
        showToast('✓ 已添加到今日');
        renderPage();
    }
}

function sendToTickler(id) {
    const days = prompt('几天后唤醒？', '7');
    if (!days) return;
    
    const task = tasks.find(t => t.id === id);
    if (task) {
        const d = new Date();
        d.setDate(d.getDate() + parseInt(days));
        task.status = 'tickler';
        task.wakeDate = d.toISOString().split('T')[0];
        saveAll();
        showToast(`✓ 将在 ${days} 天后唤醒`);
        renderPage();
    }
}

function wakeTask(id) {
    const task = tasks.find(t => t.id === id);
    if (task) {
        task.status = 'pool';
        task.wakeDate = null;
        task.wasFromTickler = true; // 永久标记
        saveAll();
        showToast('✓ 任务已唤醒');
        renderPage();
    }
}

function rescheduleTask(id) {
    const days = prompt('几天后唤醒？', '7');
    if (!days) return;
    
    const task = tasks.find(t => t.id === id);
    if (task) {
        const d = new Date();
        d.setDate(d.getDate() + parseInt(days));
        task.wakeDate = d.toISOString().split('T')[0];
        saveAll();
        showToast('✓ 已重新设置唤醒日期');
        renderPage();
    }
}

function showTaskMenu(id) {
    currentTaskId = id;
    actionSheetOverlay.classList.add('show');
}

function closeActionSheet() {
    actionSheetOverlay.classList.remove('show');
    currentTaskId = null;
}

function closeEffortSheet() {
    effortSheetOverlay.classList.remove('show');
}

function handleAction(action) {
    // 先保存当前任务ID，因为 closeActionSheet 会清空它
    const taskId = currentTaskId;
    closeActionSheet();
    
    if (action === 'cancel') return;
    
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    
    switch(action) {
        case 'effort':
            effortTaskId = taskId; // 保存任务ID供 effort sheet 使用
            setTimeout(() => {
                effortSheetOverlay.classList.add('show');
            }, 100);
            break;
        case 'inprogress':
            task.status = 'inprogress';
            saveAll();
            showToast('✓ 已标记为正在进行');
            renderPage();
            break;
        case 'archive':
            task.status = 'archived';
            task.wasFromTickler = false; // 归档时清除定时标记
            saveAll();
            showToast('✓ 已归档');
            renderPage();
            break;
        case 'delete':
            if (confirm('确定删除这个任务吗？')) {
                tasks = tasks.filter(t => t.id !== taskId);
                saveAll();
                showToast('✓ 已删除');
                renderPage();
            }
            break;
        case 'cancel':
            break;
    }
}

function setTaskEffort(effort) {
    const task = tasks.find(t => t.id === effortTaskId);
    if (task) {
        task.effort = effort;
        saveAll();
        showToast('✓ 已设置精力等级');
        renderPage();
    }
    effortTaskId = null;
}

function removeFromToday(id) {
    const task = tasks.find(t => t.id === id);
    if (task) {
        task.scheduledDate = null;
        saveAll();
        showToast('✓ 已取消今日安排');
        renderPage();
    }
}

function moveToPool(id) {
    const task = tasks.find(t => t.id === id);
    if (task) {
        task.status = 'pool';
        saveAll();
        showToast('✓ 已移回任务库');
        renderPage();
    }
}

function restoreTask(id) {
    const task = tasks.find(t => t.id === id);
    if (task) {
        task.status = 'pool';
        task.completedAt = null;
        saveAll();
        showToast('✓ 已恢复');
        renderPage();
    }
}

function permanentDelete(id) {
    if (!confirm('确定永久删除？此操作不可恢复。')) return;
    tasks = tasks.filter(t => t.id !== id);
    saveAll();
    renderPage();
}

// 习惯相关
function addHabit() {
    const name = prompt('输入习惯名称：');
    if (!name || !name.trim()) return;
    
    const icon = prompt('选择图标 emoji：', '✨');
    
    habits.push({
        id: nextId++,
        name: name.trim(),
        icon: icon || '✨',
        completedDates: []
    });
    saveAll();
    renderPage();
}

function toggleHabit(id) {
    const habit = habits.find(h => h.id === id);
    if (!habit) return;
    
    const today = getToday();
    if (!habit.completedDates) habit.completedDates = [];
    
    if (habit.completedDates.includes(today)) {
        habit.completedDates = habit.completedDates.filter(d => d !== today);
    } else {
        habit.completedDates.push(today);
        showToast('✓ 习惯完成！');
    }
    saveAll();
    renderPage();
}

function deleteHabit(id) {
    if (!confirm('确定删除这个习惯？历史记录将一并删除。')) return;
    habits = habits.filter(h => h.id !== id);
    saveAll();
    renderPage();
}

// 灯塔相关
function addNorthStar() {
    const text = prompt('输入你的灯塔语录：');
    if (!text || !text.trim()) return;
    
    northStars.push(text.trim());
    saveAll();
    renderPage();
}

function editNorthStar(index) {
    const text = prompt('编辑语录：', northStars[index]);
    if (text && text.trim()) {
        northStars[index] = text.trim();
        saveAll();
        renderPage();
    }
}

function deleteNorthStar(index) {
    if (!confirm('确定删除这条语录？')) return;
    northStars.splice(index, 1);
    saveAll();
    renderPage();
}

function refreshNorthStar() {
    if (northStars.length === 0) {
        showToast('请先添加灯塔语录');
        return;
    }
    appData.todayNorthStar = northStars[Math.floor(Math.random() * northStars.length)];
    saveAll();
    renderPage();
}

// ============ 工具函数 ============
function getToday() {
    return new Date().toISOString().split('T')[0];
}

function getYesterday() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
}

function formatDate(isoStr) {
    const d = new Date(isoStr);
    return `${d.getMonth() + 1}/${d.getDate()}`;
}

function saveAll() {
    localStorage.setItem('fa_tasks', JSON.stringify(tasks));
    localStorage.setItem('fa_habits', JSON.stringify(habits));
    localStorage.setItem('fa_northstars', JSON.stringify(northStars));
    localStorage.setItem('fa_app', JSON.stringify(appData));
    localStorage.setItem('fa_nextId', nextId);
}

function showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    document.getElementById('toastContainer').appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// ============ 设置页面 ============
function renderSettings() {
    const isDark = document.body.classList.contains('dark');
    const taskCount = tasks.length;
    const habitCount = habits.length;
    const northStarCount = northStars.length;
    
    content.innerHTML = `
        <div class="settings-section">
            <div class="settings-title">🎨 外观</div>
            <div class="settings-item" onclick="toggleDarkMode()">
                <span>夜间模式</span>
                <span class="settings-toggle ${isDark ? 'on' : ''}">${isDark ? '🌙 开启' : '☀️ 关闭'}</span>
            </div>
        </div>
        
        <div class="settings-section">
            <div class="settings-title">💾 数据管理</div>
            <div class="settings-item" onclick="exportData()">
                <span>导出数据</span>
                <span class="settings-arrow">📤</span>
            </div>
            <div class="settings-item" onclick="importData()">
                <span>导入数据</span>
                <span class="settings-arrow">📥</span>
            </div>
            <div class="settings-item danger" onclick="clearAllData()">
                <span>清空所有数据</span>
                <span class="settings-arrow">🗑️</span>
            </div>
        </div>
        
        <div class="settings-section">
            <div class="settings-title">📊 统计信息</div>
            <div class="settings-info">
                <div class="info-row"><span>任务总数</span><span>${taskCount}</span></div>
                <div class="info-row"><span>习惯数量</span><span>${habitCount}</span></div>
                <div class="info-row"><span>灯塔语录</span><span>${northStarCount}</span></div>
            </div>
        </div>
        
        <div class="settings-section">
            <div class="settings-title">ℹ️ 关于</div>
            <div class="about-card">
                <div class="about-logo">⚓</div>
                <div class="about-name">流与锚 Flow & Anchor</div>
                <div class="about-version">版本 1.0.0</div>
                <div class="about-desc">
                    一款践行「反焦虑」设计理念的个人任务管理工具。
                    没有连续打卡压力，没有红色警告，
                    让未完成的事项优雅地流转，而非成为心理负担。
                </div>
                <div class="about-author">
                    <p>💡 设计理念：我的感觉就是尺</p>
                    <p>👤 作者：Jihan Xu</p>
                    <p>📧 联系：jihan.xu@tum.de</p>
                </div>
                <div class="about-footer">
                    Made with ❤️ for a calmer life
                </div>
            </div>
        </div>
    `;
}

// 夜间模式
function toggleDarkMode() {
    document.body.classList.toggle('dark');
    const isDark = document.body.classList.contains('dark');
    localStorage.setItem('fa_darkMode', isDark ? 'true' : 'false');
    showToast(isDark ? '🌙 已开启夜间模式' : '☀️ 已关闭夜间模式');
    renderSettings();
}

// 初始化时恢复夜间模式状态
function initDarkMode() {
    if (localStorage.getItem('fa_darkMode') === 'true') {
        document.body.classList.add('dark');
    }
}

// 导出数据
function exportData() {
    const data = {
        version: '1.0.0',
        exportDate: new Date().toISOString(),
        tasks: tasks,
        habits: habits,
        northStars: northStars,
        appData: appData,
        nextId: nextId
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `flow-anchor-backup-${getToday()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showToast('✓ 数据已导出');
}

// 导入数据
function importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = e => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = event => {
            try {
                const data = JSON.parse(event.target.result);
                
                // 验证数据格式
                if (!data.tasks || !Array.isArray(data.tasks)) {
                    throw new Error('无效的数据格式');
                }
                
                // 确认导入
                const taskCount = data.tasks.length;
                const habitCount = (data.habits || []).length;
                if (!confirm(`确定导入数据吗？\n\n将导入 ${taskCount} 个任务和 ${habitCount} 个习惯。\n\n⚠️ 当前数据将被覆盖！`)) {
                    return;
                }
                
                // 导入数据
                tasks = data.tasks || [];
                habits = data.habits || [];
                northStars = data.northStars || [];
                appData = data.appData || { lastOpenDate: null, todayNorthStar: null };
                nextId = data.nextId || 1;
                
                saveAll();
                showToast('✓ 数据导入成功');
                renderSettings();
                
            } catch (err) {
                showToast('❌ 导入失败：文件格式错误');
            }
        };
        reader.readAsText(file);
    };
    
    input.click();
}

// 清空所有数据
function clearAllData() {
    if (!confirm('⚠️ 确定要清空所有数据吗？\n\n这将删除所有任务、习惯和灯塔语录。\n此操作不可恢复！')) {
        return;
    }
    
    if (!confirm('⚠️ 再次确认：真的要清空吗？\n\n建议先导出备份！')) {
        return;
    }
    
    tasks = [];
    habits = [];
    northStars = [];
    appData = { lastOpenDate: null, todayNorthStar: null };
    nextId = 1;
    
    saveAll();
    showToast('✓ 所有数据已清空');
    renderSettings();
}

// ============ 返回键处理 ============
function setupBackButton() {
    // 使用 History API 实现返回键逻辑
    // 初始化时推入一个状态
    history.pushState({ page: 'daily' }, '');
    
    window.addEventListener('popstate', handleBackButton);
}

function handleBackButton(e) {
    // 如果侧边栏打开，先关闭侧边栏
    if (sidebar.classList.contains('show')) {
        toggleSidebar(false);
        history.pushState({ page: currentPage }, '');
        return;
    }
    
    // 如果 Action Sheet 打开，先关闭
    if (actionSheetOverlay.classList.contains('show')) {
        closeActionSheet();
        history.pushState({ page: currentPage }, '');
        return;
    }
    
    if (effortSheetOverlay.classList.contains('show')) {
        closeEffortSheet();
        history.pushState({ page: currentPage }, '');
        return;
    }
    
    // 如果在卡片浏览模式，退出卡片浏览
    if (poolBrowseMode) {
        exitPoolBrowse();
        history.pushState({ page: currentPage }, '');
        return;
    }
    
    // 如果不在首页，返回首页
    if (currentPage !== 'daily') {
        currentPage = 'daily';
        document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
        document.querySelector('[data-page="daily"]').classList.add('active');
        renderPage();
        history.pushState({ page: 'daily' }, '');
        return;
    }
    
    // 在首页，双击退出逻辑
    const now = Date.now();
    if (now - backPressTime < 2000) {
        // 2秒内再次按返回，退出应用
        window.close(); // PWA 可能不支持，但留着
        // 对于不支持 close 的情况，至少允许浏览器的默认行为
    } else {
        // 第一次按返回，显示提示
        backPressTime = now;
        showExitToast('再次返回以退出');
        history.pushState({ page: 'daily' }, '');
    }
}

function showExitToast(msg) {
    // 检查是否已有退出提示
    const existing = document.querySelector('.exit-toast');
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.className = 'exit-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    
    setTimeout(() => toast.remove(), 2000);
}

// ============ PWA Service Worker ============
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ============ 启动 ============
initDarkMode(); // 先恢复夜间模式
init();
