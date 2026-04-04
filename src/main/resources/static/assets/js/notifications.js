/**
 * 通知系统 - 替代 alert() 的非侵入式提示
 */

class NotificationManager {
    constructor() {
        this.container = null;
        this.notifications = [];
        this.initContainer();
    }

    initContainer() {
        if (this.container) return;
        this.container = document.createElement('div');
        this.container.id = 'notificationContainer';
        this.container.className = 'notification-container';
        document.body.appendChild(this.container);
    }

    /**
     * 创建并显示通知
     * @param {string} message - 消息内容
     * @param {string} type - 类型: 'success', 'error', 'info', 'warning', 'loading'
     * @param {number} duration - 自动关闭时间（毫秒），0 表示不自动关闭
     * @returns {object} 通知对象，包含 close() 方法
     */
    show(message, type = 'info', duration = 4000) {
        const notificationEl = document.createElement('div');
        notificationEl.className = `notification notification-${type}`;

        const icon = this.getIcon(type);
        const content = document.createElement('div');
        content.className = 'notification-content';
        content.innerHTML = `${icon}<span class="notification-message">${this.escapeHtml(message)}</span>`;

        const closeBtn = document.createElement('button');
        closeBtn.className = 'notification-close';
        closeBtn.innerHTML = '×';
        closeBtn.onclick = () => this.removeNotification(notificationEl);

        notificationEl.appendChild(content);
        notificationEl.appendChild(closeBtn);
        this.container.appendChild(notificationEl);

        // 添加进入动画
        setTimeout(() => notificationEl.classList.add('show'), 10);

        const notification = {
            el: notificationEl,
            close: () => this.removeNotification(notificationEl),
            update: (msg, newType) => this.updateNotification(notificationEl, msg, newType)
        };

        this.notifications.push(notification);

        if (duration > 0) {
            setTimeout(() => this.removeNotification(notificationEl), duration);
        }

        return notification;
    }

    /**
     * 显示加载中状态
     */
    loading(message = '处理中...') {
        return this.show(message, 'loading', 0);
    }

    /**
     * 显示成功消息
     */
    success(message, duration = 3000) {
        return this.show(message, 'success', duration);
    }

    /**
     * 显示错误消息
     */
    error(message, duration = 5000) {
        return this.show(message, 'error', duration);
    }

    /**
     * 显示信息消息
     */
    info(message, duration = 3000) {
        return this.show(message, 'info', duration);
    }

    /**
     * 显示警告消息
     */
    warning(message, duration = 4000) {
        return this.show(message, 'warning', duration);
    }

    /**
     * 更新通知内容
     */
    updateNotification(el, message, newType) {
        const content = el.querySelector('.notification-message');
        if (content) content.textContent = message;

        if (newType) {
            el.className = `notification notification-${newType} show`;
        }
    }

    /**
     * 移除通知
     */
    removeNotification(el) {
        el.classList.remove('show');
        setTimeout(() => {
            if (el.parentNode) el.parentNode.removeChild(el);
            this.notifications = this.notifications.filter(n => n.el !== el);
        }, 300);
    }

    /**
     * 清空所有通知
     */
    clearAll() {
        this.notifications.forEach(n => this.removeNotification(n.el));
    }

    /**
     * 获取图标 HTML
     */
    getIcon(type) {
        const icons = {
            success: '<svg class="notification-icon" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>',
            error: '<svg class="notification-icon" viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/></svg>',
            warning: '<svg class="notification-icon" viewBox="0 0 24 24"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>',
            info: '<svg class="notification-icon" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>',
            loading: '<svg class="notification-icon notification-spinner" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/></svg>'
        };
        return icons[type] || icons.info;
    }

    /**
     * HTML 转义
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// 全局通知实例
const notify = new NotificationManager();

/**
 * 步骤进度跟踪 - 用于在页面上显示多步骤进度
 */
class StepProgress {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.steps = new Map();
    }

    /**
     * 设置步骤状态
     * @param {string} stepId - 步骤ID
     * @param {string} status - 状态: 'pending', 'loading', 'success', 'error'
     * @param {string} message - 显示消息
     */
    setStep(stepId, status = 'pending', message = '') {
        if (!this.container) return;

        let stepEl = this.container.querySelector(`[data-step-id="${stepId}"]`);
        if (!stepEl) {
            stepEl = document.createElement('div');
            stepEl.className = 'step-progress-item';
            stepEl.dataset.stepId = stepId;
            this.container.appendChild(stepEl);
        }

        stepEl.className = `step-progress-item step-${status}`;
        stepEl.innerHTML = `
            <div class="step-status">
                ${this.getStatusIcon(status)}
                <span class="step-message">${message}</span>
            </div>
        `;

        this.steps.set(stepId, { status, message });
    }

    /**
     * 开始步骤
     */
    start(stepId, message = '处理中...') {
        this.setStep(stepId, 'loading', message);
    }

    /**
     * 完成步骤
     */
    complete(stepId, message = '完成') {
        this.setStep(stepId, 'success', message);
    }

    /**
     * 步骤错误
     */
    error(stepId, message = '出错') {
        this.setStep(stepId, 'error', message);
    }

    /**
     * 清空所有步骤
     */
    clear() {
        if (this.container) this.container.innerHTML = '';
        this.steps.clear();
    }

    /**
     * 获取状态图标
     */
    getStatusIcon(status) {
        const icons = {
            pending: '<svg class="step-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>',
            loading: '<svg class="step-icon step-spinner" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>',
            success: '<svg class="step-icon" viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/></svg>',
            error: '<svg class="step-icon" viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/></svg>'
        };
        return icons[status] || icons.pending;
    }
}

/**
 * 辅助函数 - 在异步操作中显示进度
 */
async function withProgress(operation, {
    loadingMsg = '处理中...',
    successMsg = '完成',
    errorMsg = '出错',
    autoHide = true
} = {}) {
    const notif = notify.loading(loadingMsg);
    try {
        const result = await operation();
        notif.update(successMsg, 'success');
        if (autoHide) setTimeout(() => notif.close(), 3000);
        return result;
    } catch (error) {
        const finalMsg = `${errorMsg}: ${error.message || error}`;
        notif.update(finalMsg, 'error');
        throw error;
    }
}

