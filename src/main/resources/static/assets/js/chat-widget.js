// 全局变量
let currentContext = "";
let totalTokens = 0;
let chatHistory = [];

// DOM 元素获取
const widgetRoot = document.querySelector('.widget-root'); // 关键：获取根容器
const panel = document.getElementById("panel");
const fab = document.getElementById("fab");
const btnMinimize = document.getElementById("btnMinimize");
const chatBox = document.getElementById("chatBox");
const chatInput = document.getElementById("chatInput");
const btnSendChat = document.getElementById("btnSendChat");
const btnNewChat = document.getElementById("btnNewChat");
const timeLabel = document.getElementById("timeLabel");
const tokenLabel = document.getElementById("tokenLabel");
const chatHeader = document.querySelector(".chat-header");

/**
 * 设置聊天窗口的打开状态。
 * @param {boolean} isOpen - true 为打开，false 为关闭。
 */
function setOpenState(isOpen) {
    // 关键：在 widget-root 上切换 class
    if (widgetRoot) {
        widgetRoot.classList.toggle('is-open', isOpen);
    }

    // 显式控制显示，避免仅靠 CSS class 导致面板无法打开
    if (panel) {
        panel.style.display = isOpen ? "flex" : "none";
    }
    if (fab) {
        fab.style.display = isOpen ? "none" : "flex";
    }

    // 通知父页面调整 iframe 大小
    window.parent.postMessage({
        source: "aiChatWidget",
        type: "toggle",
        isPanelVisible: isOpen
    }, "*");

    if (isOpen) {
        setTimeout(() => {
            if (chatInput) {
                chatInput.focus();
            }
        }, 60);
    }
}

function isDragIgnoredTarget(target) {
    if (!target) return false;
    return Boolean(target.closest("button, input, textarea, select, a, .chat-header-btn"));
}

function onDragStart(e) {
    if (!panel || panel.style.display === "none") return;
    if (e.button !== undefined && e.button !== 0) return;
    if (isDragIgnoredTarget(e.target)) return;

    // 只发起拖拽信号，具体 move/up 逻辑在父页面处理
    window.parent.postMessage({
        type: "dragStart",
        screenX: e.screenX,
        screenY: e.screenY
    }, "*");
    e.preventDefault();
}

// --- 聊天功能 (不变) ---
function cleanMarkdown(text) {
    if (!text) return text;
    return text.replace(/^#+\s*/gm, "").replace(/\*+/g, "").replace(/^[-*]{3,}\s*$/gm, "").trim();
}
function appendMessage(role, text) {
    if (!chatBox) return null;
    const messageDiv = document.createElement("div");
    messageDiv.className = `chat-item ${role === "user" ? "chat-user" : "chat-ai"}`;
    const textSpan = document.createElement("span");
    textSpan.textContent = text;
    messageDiv.appendChild(textSpan);
    chatBox.appendChild(messageDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
    return textSpan;
}
function typewriterToElement(el, text, i = 0) {
    if (!el || !chatBox) return;
    if (i === 0) el.textContent = "";
    if (i >= text.length) return;
    el.textContent += text[i];
    chatBox.scrollTop = chatBox.scrollHeight;
    setTimeout(() => typewriterToElement(el, text, i + 1), 12);
}
async function sendMessage() {
    if (!chatInput || !btnSendChat) return;
    const message = chatInput.value.trim();
    if (!message) return;
    appendMessage("user", message);
    chatHistory.push({ role: "user", content: message });
    chatInput.value = "";
    btnSendChat.disabled = true;
    const startTime = Date.now();
    try {
        const contextWithHistory = `${currentContext || ""}\n\n历史对话:\n${chatHistory.slice(-10).map(i => `${i.role}: ${i.content}`).join("\n")}`.trim();
        const response = await fetch("/api/py/ai-chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message, context: contextWithHistory })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || (data && data.status === "error")) {
            const errMsg = data.details || data.error || data.response || `请求失败: ${response.status}`;
            appendMessage("ai", `请求失败: ${errMsg}`);
            return;
        }
        const reply = cleanMarkdown(data.response || data.reply || "抱歉，我无法回答。");
        const aiEl = appendMessage("ai", "");
        typewriterToElement(aiEl, reply);
        chatHistory.push({ role: "assistant", content: reply });
        if (data.usage && data.usage.total_tokens) {
            totalTokens += data.usage.total_tokens;
            tokenLabel.textContent = `Tokens: ${totalTokens}`;
        }
        const duration = (Date.now() - startTime) / 1000;
        timeLabel.textContent = `耗时: ${duration.toFixed(2)}s`;
    } finally {
        btnSendChat.disabled = false;
        chatInput.focus();
    }
}
async function resetChat() {
    if (!chatBox || !tokenLabel || !timeLabel) return;
    if (!confirm("确定要开始新的对话吗？")) return;
    try {
        await fetch("/api/py/ai-chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ clear_history: true })
        });
    } catch (e) {}
    chatHistory = [];
    totalTokens = 0;
    chatBox.innerHTML = '';
    const initialMsg = appendMessage("ai", "");
    typewriterToElement(initialMsg, "你好，我是你的智造小精灵，有问题直接问我。");
    tokenLabel.textContent = "Tokens: 0";
    timeLabel.textContent = "就绪";
}

// --- 事件监听器 (不变) ---
window.addEventListener("message", (event) => {
    const data = event.data || {};
    if (data.source === "hostPage" && data.type === "context") {
        currentContext = data.context || "";
    }
});
if (fab) fab.addEventListener("click", () => setOpenState(true));
if (btnMinimize) btnMinimize.addEventListener("click", () => setOpenState(false));
if (btnNewChat) btnNewChat.addEventListener("click", resetChat);
if (btnSendChat) btnSendChat.addEventListener("click", sendMessage);
if (chatHeader) chatHeader.addEventListener("mousedown", onDragStart);
if (chatInput) {
    chatInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        } else if (e.key === "Escape") {
            setOpenState(false);
        }
    });
}

// --- 初始化 ---
setOpenState(false);
const initialMsg = appendMessage("ai", "");
if (initialMsg) {
    typewriterToElement(initialMsg, "你好，我是你的智造小E，有问题直接问我。");
}
