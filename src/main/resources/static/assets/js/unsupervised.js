// 全局状态管理
const state = {
    currentFilePath: "",
    previewRows: [],
    previewColumns: [],
    totalRows: 0,
    currentPage: 1,
    pageSize: 10,
    nClusters: 3
};

const MIN_AI_ROWS = 20;
const MAX_AI_ROWS = 100;
const MAX_CUSTOM_HEADERS = 6;

// --- 聊天窗口通信 ---
const aiChatWidgetFrame = document.getElementById("aiChatWidgetFrame");
const chatDragState = {
    dragging: false,
    startX: 0,
    startY: 0,
    startLeft: 0,
    startTop: 0
};

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function ensureFrameFreePosition() {
    if (!aiChatWidgetFrame || aiChatWidgetFrame.dataset.freePosition === "1") return;
    const rect = aiChatWidgetFrame.getBoundingClientRect();
    aiChatWidgetFrame.style.left = `${Math.round(rect.left)}px`;
    aiChatWidgetFrame.style.top = `${Math.round(rect.top)}px`;
    aiChatWidgetFrame.style.right = "auto";
    aiChatWidgetFrame.style.bottom = "auto";
    aiChatWidgetFrame.dataset.freePosition = "1";
}

function moveFrameTo(left, top) {
    if (!aiChatWidgetFrame) return;
    const maxLeft = Math.max(0, window.innerWidth - aiChatWidgetFrame.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - aiChatWidgetFrame.offsetHeight);
    aiChatWidgetFrame.style.left = `${clamp(left, 0, maxLeft)}px`;
    aiChatWidgetFrame.style.top = `${clamp(top, 0, maxTop)}px`;
}

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
    if (data.source !== "aiChatWidget") return;
    if (!aiChatWidgetFrame) return;

    if (data.type === "drag") {
        if (data.phase === "start") {
            ensureFrameFreePosition();
            chatDragState.dragging = true;
            chatDragState.startX = Number(data.clientX) || 0;
            chatDragState.startY = Number(data.clientY) || 0;
            chatDragState.startLeft = parseFloat(aiChatWidgetFrame.style.left) || 0;
            chatDragState.startTop = parseFloat(aiChatWidgetFrame.style.top) || 0;
        } else if (data.phase === "move" && chatDragState.dragging) {
            const dx = (Number(data.clientX) || 0) - chatDragState.startX;
            const dy = (Number(data.clientY) || 0) - chatDragState.startY;
            moveFrameTo(chatDragState.startLeft + dx, chatDragState.startTop + dy);
        } else if (data.phase === "end") {
            chatDragState.dragging = false;
        }
        return;
    }

    if (data.type !== "toggle") return;

    if (data.isPanelVisible) {
        // 展开
        aiChatWidgetFrame.style.width = "380px";
        aiChatWidgetFrame.style.height = "560px";
    } else {
        // 收起
        aiChatWidgetFrame.style.width = "58px"; // 修正尺寸
        aiChatWidgetFrame.style.height = "58px"; // 修正尺寸
    }

    if (aiChatWidgetFrame.dataset.freePosition === "1") {
        const left = parseFloat(aiChatWidgetFrame.style.left) || 0;
        const top = parseFloat(aiChatWidgetFrame.style.top) || 0;
        moveFrameTo(left, top);
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
const previewPager = document.getElementById("previewPager");

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
    return data.message || data.details || data.detail || data.error || data.response || fallback || `请求失败：${statusCode}`;
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
    const previewInfo = data?.preview_info || (data?.preview && !Array.isArray(data.preview) ? data.preview : null);
    const previewRows = Array.isArray(data?.preview)
        ? data.preview
        : (Array.isArray(previewInfo?.preview) ? previewInfo.preview : []);
    const columnsFromPayload = Array.isArray(data?.columns)
        ? data.columns
        : (Array.isArray(previewInfo?.columns) ? previewInfo.columns : null);
    const columns = columnsFromPayload || (previewRows.length ? Object.keys(previewRows[0]) : []);

    state.previewColumns = columns;
    state.previewRows = previewRows;
    state.totalRows = Number(data?.total_rows ?? previewInfo?.shape?.rows ?? previewRows.length);
    if (state.previewRows.length > 0) {
        state.totalRows = state.previewRows.length;
    }
    state.currentPage = 1;

    if (!columns.length) {
        previewTable.innerHTML = "<tbody><tr><td class='text-muted small-hint'>暂无预览数据</td></tr></tbody>";
        if (previewPager) previewPager.innerHTML = "";
        return;
    }

    renderPreviewPage();
    renderPager();
}

function renderPreviewPage() {
    const columns = state.previewColumns;
    if (!columns.length) return;
    const start = (state.currentPage - 1) * state.pageSize;
    const end = start + state.pageSize;
    const pageRows = state.previewRows.slice(start, end);

    const thead = `<thead><tr>${columns.map(col => `<th>${escapeHtml(col)}</th>`).join("")}</tr></thead>`;
    const tbodyContent = pageRows.length
        ? pageRows.map(row => `<tr>${columns.map(col => `<td>${escapeHtml(row?.[col])}</td>`).join("")}</tr>`).join("")
        : `<tr><td colspan="${columns.length}" class="small-hint">本页暂无数据</td></tr>`;
    previewTable.innerHTML = `${thead}<tbody>${tbodyContent}</tbody>`;
}

function renderPager() {
    if (!previewPager) return;
    const totalPages = Math.max(1, Math.ceil(state.totalRows / state.pageSize));
    const start = state.totalRows === 0 ? 0 : ((state.currentPage - 1) * state.pageSize + 1);
    const end = Math.min(state.currentPage * state.pageSize, state.totalRows);

    previewPager.innerHTML = `
        <div class="small-hint">第 ${state.currentPage}/${totalPages} 页，显示 ${start}-${end} 行（共 ${state.totalRows} 行）</div>
        <div class="d-flex gap-2">
            <button class="btn btn-sm btn-outline-light" id="pagerPrev" ${state.currentPage <= 1 ? "disabled" : ""}>上一页</button>
            <button class="btn btn-sm btn-outline-light" id="pagerNext" ${state.currentPage >= totalPages ? "disabled" : ""}>下一页</button>
        </div>
    `;

    const prev = document.getElementById("pagerPrev");
    const next = document.getElementById("pagerNext");
    if (prev) prev.addEventListener("click", () => { state.currentPage = Math.max(1, state.currentPage - 1); renderPreviewPage(); renderPager(); });
    if (next) next.addEventListener("click", () => { state.currentPage = Math.min(totalPages, state.currentPage + 1); renderPreviewPage(); renderPager(); });
}

function parseCustomHeaders(rawValue) {
    const headers = (rawValue || "")
        .split(",")
        .map(v => v.trim())
        .filter(Boolean);
    const uniqueHeaders = [...new Set(headers)];
    if (uniqueHeaders.length > MAX_CUSTOM_HEADERS) {
        throw new Error(`自定义表头最多 ${MAX_CUSTOM_HEADERS} 个`);
    }
    return uniqueHeaders;
}

function buildGeneratePrompt(prompt, customHeaders) {
    if (!customHeaders.length) return prompt;
    return `${prompt}\n\n请严格使用以下 CSV 表头且顺序一致：${customHeaders.join(",")}。不要新增、删除或改名。`;
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
        const rawText = await response.text();
        let data = {};
        try {
            data = rawText ? JSON.parse(rawText) : {};
        } catch (err) {
            data = { details: rawText || "后端返回了非 JSON 响应" };
        }
        if (!response.ok) throw new Error(parseErrorMessage(data, response.status, "上传失败"));
        if (data && data.status === "error") throw new Error(parseErrorMessage(data, response.status, "上传失败"));
        renderPreviewTable(data);
        setFilePath(data.file_path || `temp/${file.name}`);
    }).catch(err => alert(`上传失败: ${err.message}`));
});

document.getElementById("btnGenerateData").addEventListener("click", async (e) => {
    const button = e.target;
    const prompt = document.getElementById("aiPrompt").value.trim();
    if (!prompt) {
        alert("请填写生成需求。");
        return;
    }

    const rowCount = Math.floor(Number(document.getElementById("aiRowCount").value || MIN_AI_ROWS));
    if (!Number.isFinite(rowCount) || rowCount < MIN_AI_ROWS || rowCount > MAX_AI_ROWS) {
        alert(`生成行数必须在 ${MIN_AI_ROWS}~${MAX_AI_ROWS} 之间`);
        return;
    }

    let customHeaders = [];
    try {
        customHeaders = parseCustomHeaders(document.getElementById("aiCustomHeaders").value);
    } catch (err) {
        alert(err.message);
        return;
    }

    await withLoading(button, "生成中...", async () => {
        const finalPrompt = buildGeneratePrompt(prompt, customHeaders);
        const data = await postJson("/api/py/generate-data", {
            prompt: finalPrompt,
            custom_headers: customHeaders,
            row_count: rowCount,
            rowCount
        });
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
        const data = await postJson("/api/py/clean-data", { file_path: state.currentFilePath });
        setFilePath(data.cleaned_file_path || data.file_path || state.currentFilePath);
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
        const data = await postJson("/api/py/clustering/train", {
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
        const data = await postJson("/api/py/clustering/visualize", {
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
