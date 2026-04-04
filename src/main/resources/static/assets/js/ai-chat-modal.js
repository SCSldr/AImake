/**
 * AI Chat 集成模块 - 将 AI Chat 功能集成到页面模态框中
 */

let aiChatHistory = [];
let aiChatTotalTokens = 0;
let aiCurrentContext = "";

/**
 * 初始化 AI Chat 模态框
 */
function initializeAiChat() {
    const chatBox = document.getElementById("aiChatBox");
    const chatInput = document.getElementById("aiChatInput");
    const sendBtn = document.getElementById("aiChatSendBtn");
    const clearBtn = document.getElementById("aiChatClearBtn");
    const statusSpan = document.getElementById("aiChatStatus");

    if (!chatBox) return;

    // 添加初始欢迎消息
    appendAiMessage("ai", "你好，我是你的智造小精灵，有问题直接问我。");

    // 发送消息事件
    if (sendBtn) {
        sendBtn.addEventListener("click", async () => {
            await sendAiMessage();
        });
    }

    // 回车发送
    if (chatInput) {
        chatInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendAiMessage();
            }
        });
    }

    // 清空对话
    if (clearBtn) {
        clearBtn.addEventListener("click", async () => {
            const confirmed = confirm("确认要清空对话记录吗？");
            if (!confirmed) return;

            aiChatHistory = [];
            aiChatTotalTokens = 0;
            chatBox.innerHTML = "";
            appendAiMessage("ai", "对话已清空，让我们重新开始吧。");

            // 通知后端清空历史
            try {
                await fetch("/process/ai_chat", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ message: "", clear_history: true })
                });
            } catch (e) {
                // 忽略错误
            }

            if (statusSpan) statusSpan.textContent = "就绪";
        });
    }
}

/**
 * 追加消息到聊天框
 */
function appendAiMessage(role, text) {
    const chatBox = document.getElementById("aiChatBox");
    if (!chatBox) return;

    const messageDiv = document.createElement("div");
    messageDiv.style.marginBottom = "12px";
    messageDiv.style.display = "flex";
    messageDiv.style.justifyContent = role === "user" ? "flex-end" : "flex-start";

    const msgBubble = document.createElement("div");
    msgBubble.style.maxWidth = "80%";
    msgBubble.style.padding = "8px 12px";
    msgBubble.style.borderRadius = "8px";
    msgBubble.style.wordWrap = "break-word";
    msgBubble.style.lineHeight = "1.4";
    msgBubble.style.fontSize = "13px";

    if (role === "user") {
        msgBubble.style.background = "#007bff";
        msgBubble.style.color = "white";
    } else {
        msgBubble.style.background = "white";
        msgBubble.style.color = "#212529";
        msgBubble.style.border = "1px solid #dee2e6";
    }

    msgBubble.textContent = text;
    messageDiv.appendChild(msgBubble);
    chatBox.appendChild(messageDiv);
    chatBox.scrollTop = chatBox.scrollHeight;
}

/**
 * 发送 AI 消息
 */
async function sendAiMessage() {
    const chatInput = document.getElementById("aiChatInput");
    const sendBtn = document.getElementById("aiChatSendBtn");
    const statusSpan = document.getElementById("aiChatStatus");

    if (!chatInput) return;

    const message = chatInput.value.trim();
    if (!message) return;

    // 显示用户消息
    appendAiMessage("user", message);
    aiChatHistory.push({ role: "user", content: message });
    chatInput.value = "";

    if (sendBtn) sendBtn.disabled = true;
    if (statusSpan) statusSpan.textContent = "等待中...";

    try {
        // 构建请求
        const contextWithHistory = `${aiCurrentContext || ""}\n\n历史对话:\n${aiChatHistory.slice(-10).map(i => `${i.role}: ${i.content}`).join("\n")}`.trim();

        const response = await fetch("/process/ai_chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                message: message,
                context: contextWithHistory
            })
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok || (data && data.status === "error")) {
            const errMsg = data.details || data.error || data.response || "请求失败";
            appendAiMessage("ai", `抱歉，出错了: ${errMsg}`);
            if (statusSpan) statusSpan.textContent = "出错";
            return;
        }

        const reply = (data.response || data.reply || "抱歉，我无法回答。").trim();
        appendAiMessage("ai", reply);
        aiChatHistory.push({ role: "assistant", content: reply });

        // 保持历史长度
        if (aiChatHistory.length > 20) {
            aiChatHistory = aiChatHistory.slice(-20);
        }

        if (statusSpan) statusSpan.textContent = "就绪";
    } catch (error) {
        appendAiMessage("ai", `网络错误: ${error.message}`);
        if (statusSpan) statusSpan.textContent = "出错";
    } finally {
        if (sendBtn) sendBtn.disabled = false;
        if (chatInput) chatInput.focus();
    }
}

/**
 * 更新 AI Chat 的上下文信息
 */
function updateAiContext(contextInfo) {
    aiCurrentContext = contextInfo;
}

// 页面加载时初始化
document.addEventListener("DOMContentLoaded", () => {
    initializeAiChat();
});

