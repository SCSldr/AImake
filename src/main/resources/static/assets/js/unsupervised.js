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
const CHAT_COLLAPSED_SIZE = 58;
const CHAT_OPEN_WIDTH = 380;
const CHAT_OPEN_HEIGHT = 560;

// --- 聊天窗口通信 ---
const aiChatWidgetFrame = document.getElementById("aiChatWidgetFrame");
const chatDragState = {
    dragging: false,
    startScreenX: 0,
    startScreenY: 0,
    startLeft: 0,
    startTop: 0
};
const chatToggleState = {
    collapsedLeft: null,
    collapsedTop: null
};
let dragMask = null;

function ensureDragMask() {
    if (dragMask) return dragMask;
    dragMask = document.createElement("div");
    dragMask.id = "chatDragMask";
    dragMask.style.position = "fixed";
    dragMask.style.left = "0";
    dragMask.style.top = "0";
    dragMask.style.width = "100vw";
    dragMask.style.height = "100vh";
    dragMask.style.zIndex = "9999";
    dragMask.style.display = "none";
    dragMask.style.background = "transparent";
    dragMask.style.cursor = "grabbing";
    document.body.appendChild(dragMask);
    return dragMask;
}

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

function setFrameSize(width, height) {
    if (!aiChatWidgetFrame) return;
    aiChatWidgetFrame.style.width = `${width}px`;
    aiChatWidgetFrame.style.height = `${height}px`;
}

function expandFrameAutoDirection() {
    if (!aiChatWidgetFrame) return;
    ensureFrameFreePosition();
    const rect = aiChatWidgetFrame.getBoundingClientRect();
    chatToggleState.collapsedLeft = rect.left;
    chatToggleState.collapsedTop = rect.top;

    const spaceLeft = rect.right;
    const spaceRight = window.innerWidth - rect.left;
    const spaceTop = rect.bottom;
    const spaceBottom = window.innerHeight - rect.top;

    const expandToLeft = spaceLeft >= CHAT_OPEN_WIDTH || spaceLeft >= spaceRight;
    const expandUp = spaceTop >= CHAT_OPEN_HEIGHT || spaceTop >= spaceBottom;

    const targetLeft = expandToLeft ? rect.right - CHAT_OPEN_WIDTH : rect.left;
    const targetTop = expandUp ? rect.bottom - CHAT_OPEN_HEIGHT : rect.top;

    setFrameSize(CHAT_OPEN_WIDTH, CHAT_OPEN_HEIGHT);
    aiChatWidgetFrame.style.right = "auto";
    aiChatWidgetFrame.style.bottom = "auto";
    moveFrameTo(targetLeft, targetTop);
}

function collapseFrameToAnchor() {
    if (!aiChatWidgetFrame) return;
    setFrameSize(CHAT_COLLAPSED_SIZE, CHAT_COLLAPSED_SIZE);
    aiChatWidgetFrame.style.right = "auto";
    aiChatWidgetFrame.style.bottom = "auto";

    const fallbackLeft = parseFloat(aiChatWidgetFrame.style.left) || 0;
    const fallbackTop = parseFloat(aiChatWidgetFrame.style.top) || 0;
    const left = chatToggleState.collapsedLeft ?? fallbackLeft;
    const top = chatToggleState.collapsedTop ?? fallbackTop;
    moveFrameTo(left, top);
}

function onDocumentDragMove(e) {
    if (!chatDragState.dragging || !aiChatWidgetFrame) return;
    const dx = e.screenX - chatDragState.startScreenX;
    const dy = e.screenY - chatDragState.startScreenY;
    moveFrameTo(chatDragState.startLeft + dx, chatDragState.startTop + dy);
    aiChatWidgetFrame.style.right = "auto";
    aiChatWidgetFrame.style.bottom = "auto";
}

function onDocumentDragEnd() {
    if (!chatDragState.dragging) return;
    chatDragState.dragging = false;
    const mask = ensureDragMask();
    mask.style.display = "none";
    document.removeEventListener("mousemove", onDocumentDragMove);
    document.removeEventListener("mouseup", onDocumentDragEnd);
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
    if (!aiChatWidgetFrame) return;

    if (data.type === "dragStart") {
        ensureFrameFreePosition();
        const rect = aiChatWidgetFrame.getBoundingClientRect();
        chatDragState.dragging = true;
        chatDragState.startScreenX = Number(data.screenX) || 0;
        chatDragState.startScreenY = Number(data.screenY) || 0;
        chatDragState.startLeft = rect.left;
        chatDragState.startTop = rect.top;

        const mask = ensureDragMask();
        mask.style.display = "block";

        document.addEventListener("mousemove", onDocumentDragMove);
        document.addEventListener("mouseup", onDocumentDragEnd);
        return;
    }

    if (data.source !== "aiChatWidget") return;
    if (data.type !== "toggle") return;

    if (data.isPanelVisible) {
        // 自动判断展开方向：上方不够则向下，左侧不够则向右
        expandFrameAutoDirection();
    } else {
        // 收起时回到展开前悬浮球位置
        collapseFrameToAnchor();
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
    if (currentFilePathText) {
        currentFilePathText.textContent = `当前文件：${state.currentFilePath || "未设置"}`;
    }
    sendContextToChatWidget();
}

// ... (保留所有其他业务逻辑函数，如 withLoading, postJson, renderPreviewTable 等)
// 为了简洁，这里省略了未修改的函数，实际写入时会保留它们。

// ==============================================================================
// 辅助函数 (未修改)
// ==============================================================================
const stepIds = ["step1", "step2", "step3", "step4", "step5"];
let currentStepIndex = 0;
const stepCompletion = {
    step1: false,
    step2: false,
    step3: false,
    step4: false
};

const stepNav = document.getElementById("stepNav");
const previewTable = document.getElementById("previewTable");
const previewPager = document.getElementById("previewPager");
const currentFilePathText = document.getElementById("currentFilePathText");

function isCurrentStepCompleted(index) {
    switch (index) {
        case 0: return stepCompletion.step1;
        case 1: return stepCompletion.step2;
        case 2: return stepCompletion.step3;
        case 3: return stepCompletion.step4;
        default: return true;
    }
}

function updateStepControls() {
    const prevBtn = document.getElementById("btnPrevStep");
    const nextBtn = document.getElementById("btnNextStep");
    if (!prevBtn || !nextBtn) return;
    prevBtn.disabled = currentStepIndex === 0;
    nextBtn.disabled = currentStepIndex === stepIds.length - 1 || !isCurrentStepCompleted(currentStepIndex);
}

function invalidateFrom(stepIndex) {
    if (stepIndex <= 2) {
        stepCompletion.step3 = false;
        const stats = document.getElementById("clusterStats");
        if (stats) stats.textContent = "暂无数据";
        const clusterImg = document.getElementById("clusterImage");
        if (clusterImg) clusterImg.removeAttribute("src");
    }
    if (stepIndex <= 3) {
        stepCompletion.step4 = false;
        const visImg = document.getElementById("visualizeImage");
        if (visImg) visImg.removeAttribute("src");
    }
}

function showStep(index) {
    currentStepIndex = Math.max(0, Math.min(index, stepIds.length - 1));
    stepIds.forEach((id, i) => {
        const panel = document.getElementById(id);
        if (panel) panel.classList.toggle("is-hidden", i !== currentStepIndex);
    });

    if (stepNav) {
        [...stepNav.querySelectorAll(".list-group-item")].forEach((btn, i) => {
            btn.classList.toggle("active", i === currentStepIndex);
        });
    }
    updateStepControls();
}

if (stepNav) {
    stepNav.addEventListener("click", (e) => {
        const target = e.target.closest("[data-step]");
        if (!target) return;
        const idx = stepIds.indexOf(target.dataset.step);
        if (idx >= 0) showStep(idx);
    });
}

document.getElementById("btnPrevStep")?.addEventListener("click", () => showStep(currentStepIndex - 1));
document.getElementById("btnNextStep")?.addEventListener("click", () => {
    if (!isCurrentStepCompleted(currentStepIndex)) {
        if (currentStepIndex === 0) {
            alert("请先完成第一步（上传或 AI 生成数据）");
        } else if (currentStepIndex === 1) {
            alert("请先完成数据清洗");
        } else if (currentStepIndex === 2) {
            alert("请先完成聚类分析");
        } else if (currentStepIndex === 3) {
            alert("请先完成降维可视化");
        }
        return;
    }
    showStep(currentStepIndex + 1);
});

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
    if (!Number.isFinite(state.totalRows) || state.totalRows < 0) state.totalRows = previewRows.length;
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
        <div class="small-hint">第 ${state.currentPage}/${totalPages} 页，显示 ${start}-${end} 行（共 ${state.totalRows} 条数据）</div>
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

function renderCleanStats(statistics) {
    const panel = document.getElementById("cleanStatsPanel");
    if (!panel) return;
    if (!statistics) {
        panel.innerHTML = "";
        return;
    }

    const originalRows = Number(statistics.original_rows || 0);
    const cleanedRows = Number(statistics.cleaned_rows || 0);
    const keepRate = originalRows > 0 ? Math.max(0, Math.min(100, (cleanedRows / originalRows) * 100)) : 0;
    const removeRate = 100 - keepRate;

    panel.innerHTML = `
        <div class="row g-2">
            <div class="col-6 col-md-3"><div class="small border rounded p-2">原始行数<br><strong>${originalRows}</strong></div></div>
            <div class="col-6 col-md-3"><div class="small border rounded p-2">清洗后行数<br><strong>${cleanedRows}</strong></div></div>
            <div class="col-6 col-md-3"><div class="small border rounded p-2">空值删行<br><strong>${Number(statistics.rows_removed_by_null || 0)}</strong></div></div>
            <div class="col-6 col-md-3"><div class="small border rounded p-2">异常值删行<br><strong>${Number(statistics.rows_removed_by_outlier || 0)}</strong></div></div>
        </div>
        <div class="mt-2 small-hint">保留率 ${keepRate.toFixed(1)}%（删除率 ${removeRate.toFixed(1)}%）</div>
        <div class="progress" style="height: 8px;">
            <div class="progress-bar bg-success" role="progressbar" style="width: ${keepRate.toFixed(1)}%"></div>
            <div class="progress-bar bg-danger" role="progressbar" style="width: ${removeRate.toFixed(1)}%"></div>
        </div>
        <div class="small-hint mt-2">策略：空值=${statistics.remove_null_rows ? "删除行" : (statistics.fill_missing ? "填充" : "不处理")}；异常值=${statistics.outlier_mode || "none"}；阈值=${Number(statistics.outlier_std_threshold || 0)}</div>
    `;
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
        stepCompletion.step1 = true;
        invalidateFrom(1);
        updateStepControls();
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
        stepCompletion.step1 = true;
        invalidateFrom(1);
        updateStepControls();
    }).catch(err => alert(`错误: ${err.message}`));
});

document.getElementById("btnCleanData").addEventListener("click", async (e) => {
    const button = e.target;
    if (!state.currentFilePath) {
        alert("请先上传或生成数据。");
        return;
    }

    const removeNullRows = Boolean(document.getElementById("cleanRemoveNullRows")?.checked);
    const outlierMode = (document.getElementById("cleanOutlierMode")?.value || "none").trim();
    const stdThreshold = Number(document.getElementById("cleanStdThreshold")?.value || 3);
    if (!Number.isFinite(stdThreshold) || stdThreshold <= 0) {
        alert("标准差阈值必须大于 0");
        return;
    }

    await withLoading(button, "清洗中...", async () => {
        const data = await postJson("/api/py/clean-data", {
            file_path: state.currentFilePath,
            remove_null_rows: removeNullRows,
            fill_missing: !removeNullRows,
            outlier_mode: outlierMode,
            remove_outliers: outlierMode === "remove",
            outlier_std_threshold: stdThreshold
        }, "数据清洗失败");
        setFilePath(data.cleaned_file_path || data.file_path || state.currentFilePath);
        renderPreviewTable(data);
        renderCleanStats(data.statistics);
        stepCompletion.step2 = true;
        invalidateFrom(2);
        updateStepControls();
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
        stepCompletion.step3 = true;
        invalidateFrom(3);
        updateStepControls();
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
        stepCompletion.step4 = true;
        updateStepControls();
    }).catch(err => alert(`错误: ${err.message}`));
});

// 页面加载时初始化
window.addEventListener("load", () => {
    showStep(0);
    updateStepControls();
    // 初始化聊天窗口监听器
    setTimeout(sendContextToChatWidget, 500);
});
