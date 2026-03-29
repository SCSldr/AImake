// 全局状态管理
const state = {
    currentFilePath: "",
    previewRows: [],
    previewColumns: [],
    totalRows: 0,
    nClusters: 3
};

// --- 聊天窗口通信 ---
const aiChatWidgetFrame = document.getElementById("aiChatWidgetFrame");

/**
 * 向 AI 聊天窗口发送上下文信息。
 */
function sendContextToChatWidget() {
    if (!aiChatWidgetFrame || !aiChatWidgetFrame.contentWindow) return;
    aiChatWidgetFrame.contentWindow.postMessage({
        source: "hostPage",
        type: "context",
        context: `当前文件: ${state.currentFilePath || "无"}`
    }, "*");
}

/**
 * 监听来自 AI 聊天窗口的消息，并调整 iframe 大小。
 */
window.addEventListener("message", (event) => {
    const data = event.data || {};
    if (data.source !== "aiChatWidget" || data.type !== "toggle") return;
    if (!aiChatWidgetFrame) return;

    if (data.isPanelVisible) {
        // 展开
        aiChatWidgetFrame.style.width = "380px";
        aiChatWidgetFrame.style.height = "560px";
    } else {
        // 收起
        aiChatWidgetFrame.style.width = "58px"; // 修正尺寸
        aiChatWidgetFrame.style.height = "58px"; // 修正尺寸
    }
});


// --- 核心业务逻辑 ---

function setFilePath(path) {
    state.currentFilePath = path || "";
    document.getElementById("currentFilePathText").textContent = `当前文件：${state.currentFilePath || "未设置"}`;
    sendContextToChatWidget();
}

// ... (保留所有其他业务逻辑函数，如 withLoading, postJson, renderPreviewTable 等)
// 为了简洁，这里省略了未修改的函数，实际写入时会保留它们。

// ==============================================================================
// 辅助函数 (未修改)
// ==============================================================================
const previewTable = document.getElementById("previewTable");

function withLoading(buttonEl, loadingText, fn) {
    const oldText = buttonEl.textContent;
    buttonEl.disabled = true;
    buttonEl.textContent = loadingText || "处理中...";
    return Promise.resolve(fn()).finally(() => {
        buttonEl.disabled = false;
        buttonEl.textContent = oldText;
    });
}

function parseErrorMessage(data, statusCode, fallback) {
    if (!data) return fallback || `请求失败：${statusCode}`;
    return data.details || data.detail || data.error || data.response || fallback || `请求失败：${statusCode}`;
}

async function postJson(url, bodyObj, fallbackErrorMsg) {
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyObj || {})
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(parseErrorMessage(data, response.status, fallbackErrorMsg));
    }
    if (data && data.status === "error") {
        throw new Error(parseErrorMessage(data, response.status, fallbackErrorMsg));
    }
    return data;
}

function escapeHtml(value) {
    if (value === null || value === undefined) return "";
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function renderPreviewTable(data) {
    const columns = data.columns || (data.preview && data.preview.length ? Object.keys(data.preview[0]) : []);
    const preview = data.preview || [];
    state.previewColumns = columns;
    state.previewRows = preview;
    state.totalRows = data.total_rows || preview.length;

    if (!columns.length) {
        previewTable.innerHTML = "<tbody><tr><td class='text-muted small-hint'>暂无预览数据</td></tr></tbody>";
        return;
    }

    const thead = `<thead><tr>${columns.map(col => `<th>${escapeHtml(col)}</th>`).join("")}</tr></thead>`;
    const tbodyContent = preview.map(row => `<tr>${columns.map(col => `<td>${escapeHtml(row[col])}</td>`).join("")}</tr>`).join("");
    const tbody = `<tbody>${tbodyContent}</tbody>`;
    previewTable.innerHTML = thead + tbody;
}

function normalizeImageBase64(base64Str) {
    if (!base64Str) return "";
    if (base64Str.startsWith("data:image")) return base64Str;
    return `data:image/png;base64,${base64Str}`;
}

// ==============================================================================
// 事件绑定 (部分修改)
// ==============================================================================

document.getElementById("btnLoadData").addEventListener("click", async (e) => {
    const button = e.target;
    const file = document.getElementById("dataFile").files[0];
    if (!file) {
        alert("请先选择数据文件。");
        return;
    }
    await withLoading(button, "处理中...", async () => {
        const formData = new FormData();
        formData.append("file", file);
        const response = await fetch("/api/preview-excel", { method: "POST", body: formData });
        const data = await response.json();
        if (!response.ok) throw new Error(data.details || "上传失败");
        renderPreviewTable(data);
        setFilePath(data.file_path || `temp/${file.name}`);
    }).catch(err => alert(`错误: ${err.message}`));
});

document.getElementById("btnGenerateData").addEventListener("click", async (e) => {
    const button = e.target;
    const prompt = document.getElementById("aiPrompt").value.trim();
    if (!prompt) {
        alert("请填写生成需求。");
        return;
    }
    await withLoading(button, "生成中...", async () => {
        const data = await postJson("/api/generate-data", { prompt, row_count: Number(document.getElementById("aiRowCount").value) });
        setFilePath(data.file_path);
        renderPreviewTable(data);
    }).catch(err => alert(`错误: ${err.message}`));
});

document.getElementById("btnCleanData").addEventListener("click", async (e) => {
    const button = e.target;
    if (!state.currentFilePath) {
        alert("请先上传或生成数据。");
        return;
    }
    await withLoading(button, "清洗中...", async () => {
        const data = await postJson("/api/clean-data", { file_path: state.currentFilePath });
        setFilePath(data.file_path);
        renderPreviewTable(data);
    }).catch(err => alert(`错误: ${err.message}`));
});

document.getElementById("btnClustering").addEventListener("click", async (e) => {
    const button = e.target;
    if (!state.currentFilePath) {
        alert("请先准备数据。");
        return;
    }
    state.nClusters = Number(document.getElementById("nClusters").value);
    await withLoading(button, "聚类中...", async () => {
        const data = await postJson("/api/clustering/train", {
            file_path: state.currentFilePath,
            n_clusters: state.nClusters,
            random_seed: Number(document.getElementById("randomSeed").value)
        });
        document.getElementById("clusterImage").src = normalizeImageBase64(data.cluster_image_base64);
        document.getElementById("clusterStats").textContent = JSON.stringify(data.clustering_info, null, 2);
    }).catch(err => alert(`错误: ${err.message}`));
});

document.getElementById("btnVisualize").addEventListener("click", async (e) => {
    const button = e.target;
    if (!state.currentFilePath) {
        alert("请先准备数据。");
        return;
    }
    await withLoading(button, "可视化中...", async () => {
        const data = await postJson("/api/clustering/visualize", {
            file_path: state.currentFilePath,
            method: document.getElementById("reduceMethod").value
        });
        document.getElementById("visualizeImage").src = normalizeImageBase64(data.plot_base64);
    }).catch(err => alert(`错误: ${err.message}`));
});

// 页面加载时初始化
window.addEventListener("load", () => {
    // 初始化聊天窗口监听器
    setTimeout(sendContextToChatWidget, 500);
});
