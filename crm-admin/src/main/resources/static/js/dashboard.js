/* ========== Дашборд ========== */

// Допустимый максимум коммуникаций на одного человека по каналу (для индикатора перегрева)
const MAX_COMM_PER_USER = 3;

function initDashboard() {
    if (!DASHBOARD_DATA || !Object.keys(DASHBOARD_DATA).length) return;
    loadOverallStats();
    renderDuplicatesChart();
    renderPerUserByChannel();
    renderOverheatIndicator();
    renderActiveAudience();
    renderChannelOverlap();
    renderUsersWithNoChannel();
    renderTopActiveSegments();
    renderTopWorstDeliverySegments();
    renderAvgCommPerUser();
    renderPctUsersOverN();
    renderTopOverloadedSegments();
    renderUnsubscribesAfterX();
}

function renderPerUserByChannel() {
    const data = DASHBOARD_DATA && DASHBOARD_DATA.perUserByChannel;
    if (!data) return;
    const root = document.getElementById('dashboard');
    if (!root) return;
    const channels = ['sms', 'push', 'email', 'cc'];
    channels.forEach(ch => {
        const card = root.querySelector(`.per-user-card .per-user-avg[data-channel="${ch}"]`)?.closest('.per-user-card');
        if (!card) return;
        const d = data[ch];
        if (!d) return;
        const avgEl = card.querySelector('.per-user-avg');
        const minEl = card.querySelector('.per-user-minmax .min');
        const maxEl = card.querySelector('.per-user-minmax .max');
        if (avgEl) avgEl.textContent = 'Среднее: ' + (Number(d.avg) === d.avg ? d.avg.toFixed(1) : d.avg);
        if (minEl) minEl.textContent = 'мин: ' + d.min;
        if (maxEl) maxEl.textContent = 'макс: ' + d.max;
    });
}

function renderOverheatIndicator() {
    const data = DASHBOARD_DATA && DASHBOARD_DATA.perUserByChannel;
    const limit = typeof MAX_COMM_PER_USER !== 'undefined' ? MAX_COMM_PER_USER : 3;
    if (!data) return;
    const channels = ['sms', 'push', 'email', 'cc'];
    channels.forEach(ch => {
        const statusEl = document.getElementById('overheat-' + ch);
        const detailEl = document.getElementById('overheat-detail-' + ch);
        if (!statusEl) return;
        const d = data[ch];
        if (!d) { statusEl.textContent = '—'; statusEl.className = 'overheat-status'; return; }
        const avg = Number(d.avg);
        const max = Number(d.max);
        let status, statusClass;
        if (max > limit || avg > limit) {
            status = 'Перегрев';
            statusClass = 'overheat-status overheat-bad';
        } else if (avg >= limit * 0.8) {
            // Среднее близко к лимиту (≥80%), но не превышает — внимание
            status = 'Внимание';
            statusClass = 'overheat-status overheat-warn';
        } else {
            // max и avg в пределах нормы (в т.ч. max === 3 при низком среднем)
            status = 'Норма';
            statusClass = 'overheat-status overheat-ok';
        }
        statusEl.textContent = status;
        statusEl.className = statusClass;
        if (detailEl) detailEl.textContent = `макс: ${max} из ${limit}`;
    });
}

function renderActiveAudience() {
    const data = DASHBOARD_DATA && DASHBOARD_DATA.activeAudienceByChannel;
    if (!data) return;
    const ids = { sms: 'audienceSms', push: 'audiencePush', email: 'audienceEmail', cc: 'audienceCc' };
    ['sms', 'push', 'email', 'cc'].forEach(ch => {
        const el = document.getElementById(ids[ch]);
        if (el && data[ch] != null) el.textContent = Number(data[ch]).toLocaleString();
    });
}

function renderChannelOverlap() {
    const val = DASHBOARD_DATA && DASHBOARD_DATA.channelOverlapSmsEmailPush;
    const el = document.getElementById('channelOverlapValue');
    if (el && val != null) el.textContent = (val).toLocaleString();
}

function renderUsersWithNoChannel() {
    const data = DASHBOARD_DATA && DASHBOARD_DATA.usersWithNoChannel;
    if (!data) return;
    const countEl = document.getElementById('noChannelCount');
    const shareEl = document.getElementById('noChannelShare');
    if (countEl && data.count != null) countEl.textContent = (data.count).toLocaleString();
    if (shareEl && data.sharePercent != null) shareEl.textContent = data.sharePercent + '%';
}

function renderTopActiveSegments() {
    const tbody = document.getElementById('topActiveSegmentsBody');
    const data = DASHBOARD_DATA && DASHBOARD_DATA.topActiveSegments;
    if (!tbody || !data || !data.length) return;
    tbody.innerHTML = data.map(s => `
        <tr><td>${s.name}</td><td>${(s.sent || 0).toLocaleString()}</td></tr>
    `).join('');
}

function renderTopWorstDeliverySegments() {
    const tbody = document.getElementById('topWorstDeliveryBody');
    const data = DASHBOARD_DATA && DASHBOARD_DATA.topWorstDeliverySegments;
    if (!tbody || !data || !data.length) return;
    tbody.innerHTML = data.map(s => `
        <tr>
            <td>${s.name}</td>
            <td>${(s.sent || 0).toLocaleString()}</td>
            <td>${(s.success || 0).toLocaleString()}</td>
            <td style="color: #ef4444;">${(s.rate || 0)}%</td>
        </tr>
    `).join('');
}

function renderAvgCommPerUser() {
    const data = DASHBOARD_DATA && DASHBOARD_DATA.avgCommPerUser;
    if (!data) return;
    const el7 = document.getElementById('avgComm7d');
    const el30 = document.getElementById('avgComm30d');
    if (el7 && data.days7 != null) el7.textContent = (data.days7).toFixed(1);
    if (el30 && data.days30 != null) el30.textContent = (data.days30).toFixed(1);
}

function renderPctUsersOverN() {
    const tbody = document.getElementById('pctUsersOverNBody');
    const data = DASHBOARD_DATA && DASHBOARD_DATA.pctUsersOverN;
    if (!tbody || !data || !data.length) return;
    tbody.innerHTML = data.map(r => `
        <tr><td>> ${r.n}</td><td>${r.pct}%</td></tr>
    `).join('');
}

function renderTopOverloadedSegments() {
    const tbody = document.getElementById('topOverloadedBody');
    const data = DASHBOARD_DATA && DASHBOARD_DATA.topOverloadedSegments;
    if (!tbody || !data || !data.length) return;
    tbody.innerHTML = data.map(s => `
        <tr>
            <td>${s.name}</td>
            <td>${(s.avgPerUser || 0).toFixed(1)}</td>
            <td>${(s.users || 0).toLocaleString()}</td>
        </tr>
    `).join('');
}

function renderUnsubscribesAfterX() {
    const tbody = document.getElementById('unsubscribesAfterXBody');
    const data = DASHBOARD_DATA && DASHBOARD_DATA.unsubscribesAfterX;
    if (!tbody || !data || !data.length) return;
    tbody.innerHTML = data.map(r => `
        <tr><td>${r.contacts}</td><td>${(r.count || 0).toLocaleString()}</td></tr>
    `).join('');
}

function renderWeekChart() {
    const chart = document.getElementById('weekChart');
    const weekData = DASHBOARD_DATA.weekData;
    if (!chart || !weekData || !weekData.length) return;
    const maxTotal = Math.max(...weekData.map(d => d.total));
    
    chart.innerHTML = weekData.map(d => {
        const height = (d.total / maxTotal * 100).toFixed(1);
        const successHeight = (d.success / d.total * 100).toFixed(1);
        return `
            <div class="bar" style="height: ${height}%; background: linear-gradient(to top, #22c55e ${successHeight}%, #ef4444 ${successHeight}%);" title="${d.day} ${d.date}: ${d.total.toLocaleString()} отправок">
                <span class="bar-value">${(d.total/1000).toFixed(1)}k</span>
                <span class="bar-label">${d.day}</span>
            </div>
        `;
    }).join('');
}

function renderDuplicatesChart() {
    const chart = document.getElementById('duplicatesChart');
    if (!chart) return;
    const data = (DASHBOARD_DATA && DASHBOARD_DATA.duplicatesByDate) || [];
    const maxCount = data.length ? Math.max(...data.map(d => d.count)) : 1;
    chart.innerHTML = data.map(d => {
        const height = maxCount > 0 ? (d.count / maxCount * 100).toFixed(1) : 0;
        return `
            <div class="bar" style="height: ${height}%; background: linear-gradient(to top, #f59e0b, #fbbf24);" title="${d.date} (${d.day}): ${d.count} дублей">
                <span class="bar-value">${d.count}</span>
                <span class="bar-label">${d.date}</span>
            </div>
        `;
    }).join('');
}

function renderTopTemplates() {
    const tbody = document.getElementById('topTemplatesBody');
    const data = DASHBOARD_DATA.topTemplates;
    if (!tbody || !data || !data.length) return;
    const channelLabels = { sms: 'SMS', push: 'Push', email: 'Email', cc: 'КЦ' };
    tbody.innerHTML = data.map(t => {
        const successRate = ((t.success / t.sent) * 100).toFixed(1);
        return `
            <tr>
                <td><span class="channel-badge channel-${t.channel}">${channelLabels[t.channel]}</span></td>
                <td><b>${t.code}</b></td>
                <td>${t.name}</td>
                <td>${t.sent.toLocaleString()}</td>
                <td style="color: var(--green);">${t.success.toLocaleString()}</td>
                <td style="color: #ef4444;">${t.error}</td>
                <td>
                    <div style="display: flex; align-items: center; gap: 5px;">
                        <div class="progress-bar" style="width: 60px; margin: 0;">
                            <div class="progress-fill success" style="width: ${successRate}%;"></div>
                        </div>
                        <span>${successRate}%</span>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function refreshDashboard() {
    // Имитация обновления данных с небольшой рандомизацией
    const mode = document.getElementById('dashboardMode').value;
    
    if (mode === 'template') {
        loadTemplateStats();
        return;
    }
    
    const variation = () => Math.floor(Math.random() * 200) - 100;
    
    const newToday = DASHBOARD_DATA.today.total + variation();
    const newSuccess = Math.floor(newToday * 0.94);
    const newError = newToday - newSuccess;
    
    document.getElementById('todaySends').textContent = newToday.toLocaleString();
    document.getElementById('successCount').textContent = newSuccess.toLocaleString();
    document.getElementById('errorCount').textContent = newError.toLocaleString();
    
    const diff = ((newToday - DASHBOARD_DATA.monthlyAvg) / DASHBOARD_DATA.monthlyAvg * 100).toFixed(1);
    const trendEl = document.getElementById('todayTrend');
    if (diff > 0) {
        trendEl.className = 'stat-trend up';
        trendEl.textContent = `↑ +${diff}% к среднему`;
    } else {
        trendEl.className = 'stat-trend down';
        trendEl.textContent = `↓ ${diff}% к среднему`;
    }
    
    document.getElementById('successRate').textContent = ((newSuccess/newToday)*100).toFixed(1) + '% от общего';
    document.getElementById('errorRate').textContent = ((newError/newToday)*100).toFixed(1) + '% от общего';
    
    const now = new Date();
    document.getElementById('lastUpdate').textContent = 
        `Последнее обновление: ${now.toLocaleTimeString('ru-RU')}`;
}

// Мок-данные для статистики по отдельным шаблонам
const TEMPLATE_STATS = {
    sms_1: {
        code: 'SMS_ABANDONED', name: 'Брошенная заявка', channel: 'sms',
        today: { sent: 1876, delivered: 1798, error: 78 },
        monthlyAvg: 1650,
        weekData: [
            { day: 'Пн', sent: 1523, delivered: 1467, error: 56 },
            { day: 'Вт', sent: 1687, delivered: 1621, error: 66 },
            { day: 'Ср', sent: 1598, delivered: 1534, error: 64 },
            { day: 'Чт', sent: 1756, delivered: 1689, error: 67 },
            { day: 'Пт', sent: 1812, delivered: 1743, error: 69 },
            { day: 'Сб', sent: 1234, delivered: 1187, error: 47 },
            { day: 'Вс', sent: 1876, delivered: 1798, error: 78 }
        ],
        errorReasons: [
            { reason: 'Неверный номер телефона', count: 32 },
            { reason: 'Абонент недоступен', count: 24 },
            { reason: 'Чёрный список', count: 15 },
            { reason: 'Таймаут оператора', count: 7 }
        ]
    },
    sms_2: {
        code: 'SMS_PROMO_CARD', name: 'Промо карта', channel: 'sms',
        today: { sent: 845, delivered: 812, error: 33 },
        monthlyAvg: 780,
        weekData: [
            { day: 'Пн', sent: 756, delivered: 728, error: 28 },
            { day: 'Вт', sent: 823, delivered: 791, error: 32 },
            { day: 'Ср', sent: 798, delivered: 765, error: 33 },
            { day: 'Чт', sent: 867, delivered: 834, error: 33 },
            { day: 'Пт', sent: 889, delivered: 854, error: 35 },
            { day: 'Сб', sent: 654, delivered: 629, error: 25 },
            { day: 'Вс', sent: 845, delivered: 812, error: 33 }
        ],
        errorReasons: [
            { reason: 'Абонент недоступен', count: 14 },
            { reason: 'Неверный номер телефона', count: 11 },
            { reason: 'Отказ от рекламы', count: 8 }
        ]
    },
    sms_3: {
        code: 'SMS_RENEWAL', name: 'Продление подписки', channel: 'sms',
        today: { sent: 423, delivered: 398, error: 25 },
        monthlyAvg: 380,
        weekData: [
            { day: 'Пн', sent: 367, delivered: 345, error: 22 },
            { day: 'Вт', sent: 412, delivered: 387, error: 25 },
            { day: 'Ср', sent: 389, delivered: 366, error: 23 },
            { day: 'Чт', sent: 445, delivered: 418, error: 27 },
            { day: 'Пт', sent: 456, delivered: 428, error: 28 },
            { day: 'Сб', sent: 298, delivered: 280, error: 18 },
            { day: 'Вс', sent: 423, delivered: 398, error: 25 }
        ],
        errorReasons: [
            { reason: 'Неверный номер телефона', count: 12 },
            { reason: 'Абонент недоступен', count: 9 },
            { reason: 'Чёрный список', count: 4 }
        ]
    },
    push_1: {
        code: 'PUSH_PROMO', name: 'Промо пуш', channel: 'push',
        today: { sent: 2341, delivered: 2289, error: 52 },
        monthlyAvg: 2100,
        weekData: [
            { day: 'Пн', sent: 1987, delivered: 1945, error: 42 },
            { day: 'Вт', sent: 2156, delivered: 2108, error: 48 },
            { day: 'Ср', sent: 2089, delivered: 2043, error: 46 },
            { day: 'Чт', sent: 2234, delivered: 2185, error: 49 },
            { day: 'Пт', sent: 2312, delivered: 2261, error: 51 },
            { day: 'Сб', sent: 1756, delivered: 1718, error: 38 },
            { day: 'Вс', sent: 2341, delivered: 2289, error: 52 }
        ],
        errorReasons: [
            { reason: 'Токен устройства недействителен', count: 23 },
            { reason: 'Приложение удалено', count: 18 },
            { reason: 'Уведомления отключены', count: 11 }
        ]
    },
    push_2: {
        code: 'PUSH_WELCOME', name: 'Приветственный', channel: 'push',
        today: { sent: 1654, delivered: 1621, error: 33 },
        monthlyAvg: 1500,
        weekData: [
            { day: 'Пн', sent: 1423, delivered: 1394, error: 29 },
            { day: 'Вт', sent: 1567, delivered: 1535, error: 32 },
            { day: 'Ср', sent: 1498, delivered: 1468, error: 30 },
            { day: 'Чт', sent: 1612, delivered: 1580, error: 32 },
            { day: 'Пт', sent: 1678, delivered: 1644, error: 34 },
            { day: 'Сб', sent: 1234, delivered: 1209, error: 25 },
            { day: 'Вс', sent: 1654, delivered: 1621, error: 33 }
        ],
        errorReasons: [
            { reason: 'Токен устройства недействителен', count: 15 },
            { reason: 'Приложение удалено', count: 12 },
            { reason: 'Таймаут соединения', count: 6 }
        ]
    },
    push_3: {
        code: 'PUSH_LOAN_ABANDON', name: 'Брошенный кредит', channel: 'push',
        today: { sent: 987, delivered: 954, error: 33 },
        monthlyAvg: 890,
        weekData: [
            { day: 'Пн', sent: 856, delivered: 827, error: 29 },
            { day: 'Вт', sent: 934, delivered: 903, error: 31 },
            { day: 'Ср', sent: 912, delivered: 881, error: 31 },
            { day: 'Чт', sent: 967, delivered: 934, error: 33 },
            { day: 'Пт', sent: 1001, delivered: 968, error: 33 },
            { day: 'Сб', sent: 734, delivered: 709, error: 25 },
            { day: 'Вс', sent: 987, delivered: 954, error: 33 }
        ],
        errorReasons: [
            { reason: 'Приложение удалено', count: 16 },
            { reason: 'Токен устройства недействителен', count: 12 },
            { reason: 'Уведомления отключены', count: 5 }
        ]
    },
    email_1: {
        code: '12345', name: 'Сброс пароля', channel: 'email',
        today: { sent: 987, delivered: 934, error: 53 },
        monthlyAvg: 920,
        weekData: [
            { day: 'Пн', sent: 876, delivered: 829, error: 47 },
            { day: 'Вт', sent: 945, delivered: 894, error: 51 },
            { day: 'Ср', sent: 912, delivered: 863, error: 49 },
            { day: 'Чт', sent: 978, delivered: 926, error: 52 },
            { day: 'Пт', sent: 1012, delivered: 958, error: 54 },
            { day: 'Сб', sent: 756, delivered: 715, error: 41 },
            { day: 'Вс', sent: 987, delivered: 934, error: 53 }
        ],
        errorReasons: [
            { reason: 'Почтовый ящик не существует', count: 24 },
            { reason: 'Ящик переполнен', count: 15 },
            { reason: 'Спам-фильтр', count: 9 },
            { reason: 'Домен в чёрном списке', count: 5 }
        ]
    },
    email_2: {
        code: '67890', name: 'Подтверждение email', channel: 'email',
        today: { sent: 567, delivered: 534, error: 33 },
        monthlyAvg: 520,
        weekData: [
            { day: 'Пн', sent: 489, delivered: 461, error: 28 },
            { day: 'Вт', sent: 534, delivered: 503, error: 31 },
            { day: 'Ср', sent: 512, delivered: 483, error: 29 },
            { day: 'Чт', sent: 556, delivered: 524, error: 32 },
            { day: 'Пт', sent: 578, delivered: 545, error: 33 },
            { day: 'Сб', sent: 423, delivered: 399, error: 24 },
            { day: 'Вс', sent: 567, delivered: 534, error: 33 }
        ],
        errorReasons: [
            { reason: 'Почтовый ящик не существует', count: 18 },
            { reason: 'Спам-фильтр', count: 10 },
            { reason: 'Ящик переполнен', count: 5 }
        ]
    },
    email_3: {
        code: '11111', name: 'Промо кредит', channel: 'email',
        today: { sent: 234, delivered: 212, error: 22 },
        monthlyAvg: 210,
        weekData: [
            { day: 'Пн', sent: 198, delivered: 179, error: 19 },
            { day: 'Вт', sent: 223, delivered: 202, error: 21 },
            { day: 'Ср', sent: 212, delivered: 192, error: 20 },
            { day: 'Чт', sent: 234, delivered: 212, error: 22 },
            { day: 'Пт', sent: 245, delivered: 222, error: 23 },
            { day: 'Сб', sent: 167, delivered: 151, error: 16 },
            { day: 'Вс', sent: 234, delivered: 212, error: 22 }
        ],
        errorReasons: [
            { reason: 'Отписка от рассылки', count: 10 },
            { reason: 'Почтовый ящик не существует', count: 7 },
            { reason: 'Спам-фильтр', count: 5 }
        ]
    },
    cc_1: {
        code: 'CC_SEGMENT_1', name: 'Сегмент удержания', channel: 'cc',
        today: { sent: 156, delivered: 134, error: 22 },
        monthlyAvg: 140,
        weekData: [
            { day: 'Пн', sent: 134, delivered: 115, error: 19 },
            { day: 'Вт', sent: 148, delivered: 127, error: 21 },
            { day: 'Ср', sent: 142, delivered: 122, error: 20 },
            { day: 'Чт', sent: 156, delivered: 134, error: 22 },
            { day: 'Пт', sent: 163, delivered: 140, error: 23 },
            { day: 'Сб', sent: 112, delivered: 96, error: 16 },
            { day: 'Вс', sent: 156, delivered: 134, error: 22 }
        ],
        errorReasons: [
            { reason: 'Клиент не ответил', count: 12 },
            { reason: 'Неверный номер', count: 6 },
            { reason: 'Отказ от разговора', count: 4 }
        ]
    },
    cc_3: {
        code: 'CC_LOAN_HOT', name: 'Горячие лиды кредит', channel: 'cc',
        today: { sent: 189, delivered: 167, error: 22 },
        monthlyAvg: 170,
        weekData: [
            { day: 'Пн', sent: 162, delivered: 143, error: 19 },
            { day: 'Вт', sent: 178, delivered: 157, error: 21 },
            { day: 'Ср', sent: 171, delivered: 151, error: 20 },
            { day: 'Чт', sent: 185, delivered: 163, error: 22 },
            { day: 'Пт', sent: 194, delivered: 171, error: 23 },
            { day: 'Сб', sent: 145, delivered: 128, error: 17 },
            { day: 'Вс', sent: 189, delivered: 167, error: 22 }
        ],
        errorReasons: [
            { reason: 'Клиент не ответил', count: 11 },
            { reason: 'Неверный номер', count: 7 },
            { reason: 'Сброс вызова', count: 4 }
        ]
    },
    cc_4: {
        code: 'CC_CARD_UPSELL', name: 'Апсейл карты', channel: 'cc',
        today: { sent: 102, delivered: 89, error: 13 },
        monthlyAvg: 95,
        weekData: [
            { day: 'Пн', sent: 89, delivered: 78, error: 11 },
            { day: 'Вт', sent: 97, delivered: 85, error: 12 },
            { day: 'Ср', sent: 94, delivered: 82, error: 12 },
            { day: 'Чт', sent: 101, delivered: 88, error: 13 },
            { day: 'Пт', sent: 106, delivered: 93, error: 13 },
            { day: 'Сб', sent: 78, delivered: 68, error: 10 },
            { day: 'Вс', sent: 102, delivered: 89, error: 13 }
        ],
        errorReasons: [
            { reason: 'Клиент не ответил', count: 7 },
            { reason: 'Отказ от разговора', count: 4 },
            { reason: 'Неверный номер', count: 2 }
        ]
    }
};

/* Переключение режима дашборда */
function switchDashboardMode() {
    const mode = document.getElementById('dashboardMode').value;
    const templateField = document.getElementById('templateSelectorField');
    const templateInfo = document.getElementById('templateInfoField');
    const channelSection = document.querySelector('.channel-stats-grid')?.closest('.dashboard-section');
    const topSection = document.getElementById('topTemplatesBody')?.closest('.dashboard-section');
    const detailedStats = document.getElementById('templateDetailedStats');
    
    const perUserSection = document.getElementById('perUserSection');
    const overheatSection = document.getElementById('overheatSection');
    const audienceSection = document.getElementById('audienceSection');
    const overlapSection = document.getElementById('overlapSection');
    const noChannelSection = document.getElementById('noChannelSection');
    const topActiveSegmentsSection = document.getElementById('topActiveSegmentsSection');
    const topWorstDeliverySection = document.getElementById('topWorstDeliverySection');
    const avgCommPerUserSection = document.getElementById('avgCommPerUserSection');
    const pctUsersOverNSection = document.getElementById('pctUsersOverNSection');
    const topOverloadedSection = document.getElementById('topOverloadedSection');
    const unsubscribesSection = document.getElementById('unsubscribesSection');
    const extraSections = [audienceSection, overlapSection, noChannelSection, topActiveSegmentsSection, topWorstDeliverySection, avgCommPerUserSection, pctUsersOverNSection, topOverloadedSection, unsubscribesSection];
    if (mode === 'all') {
        templateField.style.display = 'none';
        templateInfo.style.display = 'none';
        if (channelSection) channelSection.style.display = 'block';
        if (topSection) topSection.style.display = 'block';
        if (perUserSection) perUserSection.style.display = 'block';
        if (overheatSection) overheatSection.style.display = 'block';
        extraSections.forEach(s => { if (s) s.style.display = 'block'; });
        if (detailedStats) detailedStats.style.display = 'none';
        
        // Восстанавливаем общую статистику
        loadOverallStats();
    } else {
        templateField.style.display = 'block';
        if (channelSection) channelSection.style.display = 'none';
        if (topSection) topSection.style.display = 'none';
        if (perUserSection) perUserSection.style.display = 'none';
        if (overheatSection) overheatSection.style.display = 'none';
        extraSections.forEach(s => { if (s) s.style.display = 'none'; });
        
        // Если шаблон уже выбран, загружаем его
        const selectedTemplate = document.getElementById('dashboardTemplate').value;
        if (selectedTemplate) {
            loadTemplateStats();
        } else {
            // Показываем пустое состояние
            if (detailedStats) detailedStats.style.display = 'none';
            document.getElementById('todaySends').textContent = '—';
            document.getElementById('avgMonthly').textContent = '—';
            document.getElementById('successCount').textContent = '—';
            document.getElementById('errorCount').textContent = '—';
            document.getElementById('todayTrend').textContent = '';
            document.getElementById('weekChart').innerHTML = '<div style="text-align: center; color: var(--dim); padding: 50px;">Выберите шаблон для просмотра статистики</div>';
        }
    }
}

/* Загрузка общей статистики */
function loadOverallStats() {
    const data = DASHBOARD_DATA;
    if (!data || !data.today) return;
    const detailedStats = document.getElementById('templateDetailedStats');
    if (detailedStats) detailedStats.style.display = 'none';

    const today = data.today;
    const total = today.total || 0;
    const success = today.success || 0;
    const err = today.error || 0;

    const todayEl = document.getElementById('todaySends');
    const avgEl = document.getElementById('avgMonthly');
    const successEl = document.getElementById('successCount');
    const errorEl = document.getElementById('errorCount');
    if (todayEl) todayEl.textContent = total.toLocaleString();
    if (avgEl) avgEl.textContent = (data.monthlyAvg != null ? data.monthlyAvg : 0).toLocaleString();
    if (successEl) successEl.textContent = success.toLocaleString();
    if (errorEl) errorEl.textContent = err.toLocaleString();

    const monthlyAvg = data.monthlyAvg || 1;
    const diff = total ? ((total - monthlyAvg) / monthlyAvg * 100).toFixed(1) : '0';
    const trendEl = document.getElementById('todayTrend');
    if (trendEl) {
        trendEl.className = parseFloat(diff) > 0 ? 'stat-trend up' : 'stat-trend down';
        trendEl.textContent = parseFloat(diff) > 0 ? '↑ +' + diff + '% к среднему' : '↓ ' + diff + '% к среднему';
    }

    const successRateEl = document.getElementById('successRate');
    const errorRateEl = document.getElementById('errorRate');
    if (successRateEl && total) successRateEl.textContent = ((success / total) * 100).toFixed(1) + '% от общего';
    if (errorRateEl && total) errorRateEl.textContent = ((err / total) * 100).toFixed(1) + '% от общего';

    renderChannelStats();
    renderWeekChart();
    renderTopTemplates();
}

/* Статистика по каналам (сегодня) из DASHBOARD_DATA.today.byChannel */
function renderChannelStats() {
    const byChannel = DASHBOARD_DATA.today && DASHBOARD_DATA.today.byChannel;
    if (!byChannel) return;
    const channels = ['sms', 'push', 'email', 'cc'];
    channels.forEach(ch => {
        const card = document.querySelector('#dashboard .channel-stat-card.' + ch + ':not(.per-user-card):not(.overheat-card)');
        if (!card) return;
        const d = byChannel[ch];
        if (!d) return;
        const total = (d.total || 0);
        const success = (d.success || 0);
        const err = (d.error || 0);
        const totalEl = card.querySelector('.channel-total');
        const detailsEl = card.querySelector('.channel-details');
        const progressFill = card.querySelector('.progress-fill.success');
        if (totalEl) totalEl.textContent = total.toLocaleString();
        if (detailsEl) detailsEl.innerHTML = '<span style="color: var(--green);">✓ ' + success.toLocaleString() + '</span> · <span style="color: var(--coral);">✗ ' + err + '</span>';
        if (progressFill && total) progressFill.style.width = ((success / total) * 100).toFixed(1) + '%';
    });
}

/* Загрузка статистики по конкретному шаблону */
function loadTemplateStats() {
    const templateId = document.getElementById('dashboardTemplate').value;
    
    if (!templateId) {
        switchDashboardMode();
        return;
    }
    
    const data = TEMPLATE_STATS[templateId];
    if (!data) return;
    
    const channelLabels = { sms: 'SMS', push: 'Push', email: 'Email', cc: 'КЦ' };
    
    // Показываем информацию о шаблоне
    document.getElementById('templateInfoField').style.display = 'block';
    document.getElementById('selectedTemplateInfo').innerHTML = `
        <span class="channel-badge channel-${data.channel}" style="margin-right: 10px;">${channelLabels[data.channel]}</span>
        <b>${data.code}</b> — ${data.name}
    `;
    
    // Обновляем основные карточки статистики
    document.getElementById('todaySends').textContent = data.today.sent.toLocaleString();
    document.getElementById('avgMonthly').textContent = data.monthlyAvg.toLocaleString();
    document.getElementById('successCount').textContent = data.today.delivered.toLocaleString();
    document.getElementById('errorCount').textContent = data.today.error.toLocaleString();
    
    const diff = ((data.today.sent - data.monthlyAvg) / data.monthlyAvg * 100).toFixed(1);
    const trendEl = document.getElementById('todayTrend');
    trendEl.className = diff > 0 ? 'stat-trend up' : 'stat-trend down';
    trendEl.textContent = diff > 0 ? `↑ +${diff}% к среднему` : `↓ ${diff}% к среднему`;
    
    document.getElementById('successRate').textContent = ((data.today.delivered/data.today.sent)*100).toFixed(1) + '% от отправленных';
    document.getElementById('errorRate').textContent = ((data.today.error/data.today.sent)*100).toFixed(1) + '% от отправленных';
    
    // Показываем детальную статистику
    const detailedStats = document.getElementById('templateDetailedStats');
    if (detailedStats) {
        detailedStats.style.display = 'block';
        
        document.getElementById('detailSent').textContent = data.today.sent.toLocaleString();
        document.getElementById('detailDelivered').textContent = data.today.delivered.toLocaleString();
        document.getElementById('detailErrors').textContent = data.today.error.toLocaleString();
        document.getElementById('detailDeliveredRate').textContent = ((data.today.delivered/data.today.sent)*100).toFixed(1) + '% от отправленных';
        document.getElementById('detailErrorRate').textContent = ((data.today.error/data.today.sent)*100).toFixed(1) + '% от отправленных';
        
        // Отображаем причины ошибок
        const errorReasonsEl = document.getElementById('errorReasons');
        if (data.errorReasons && data.errorReasons.length > 0) {
            errorReasonsEl.innerHTML = data.errorReasons.map(r => `
                <div class="error-reason">
                    <span class="reason-name">${r.reason}</span>
                    <span class="reason-count">${r.count}</span>
                </div>
            `).join('');
        } else {
            errorReasonsEl.innerHTML = '<div style="color: var(--dim);">Нет данных о причинах ошибок</div>';
        }
    }
    
    // Обновляем график
    renderTemplateWeekChart(data.weekData);
    
    const now = new Date();
    document.getElementById('lastUpdate').textContent = 
        `Последнее обновление: ${now.toLocaleTimeString('ru-RU')}`;
}

/* Рендер графика для конкретного шаблона */
function renderTemplateWeekChart(weekData) {
    const chart = document.getElementById('weekChart');
    const maxTotal = Math.max(...weekData.map(d => d.sent));
    
    chart.innerHTML = weekData.map(d => {
        const height = (d.sent / maxTotal * 100).toFixed(1);
        const deliveredHeight = (d.delivered / d.sent * 100).toFixed(1);
        return `
            <div class="bar" style="height: ${height}%; background: linear-gradient(to top, #22c55e ${deliveredHeight}%, #ef4444 ${deliveredHeight}%);" title="${d.day}: отправлено ${d.sent.toLocaleString()}, доставлено ${d.delivered.toLocaleString()}, ошибок ${d.error}">
                <span class="bar-value">${d.sent}</span>
                <span class="bar-label">${d.day}</span>
            </div>
        `;
    }).join('');
}
