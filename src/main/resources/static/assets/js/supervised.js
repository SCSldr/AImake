// 全局状态管理
const state = {
    currentFilePath: "",
    splitTrainPath: "",
    splitTestPath: "",
    featureFilePath: "",
    modelPath: "",
    targetColumn: "",
    previewRows: [],
    previewColumns: [],
    totalRows: 0,
    currentPage: 1,
    pageSize: 10
};

const MIN_AI_ROWS = 20;
const MAX_AI_ROWS = 100;
const MAX_CUSTOM_HEADERS = 6;
const CHAT_COLLAPSED_SIZE = 58;
const CHAT_OPEN_WIDTH = 380;
const CHAT_OPEN_HEIGHT = 560;

// ... (保留 showStep, stepNav, btnPrevStep, btnNextStep 的事件监听)

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

    // 如果已经拖动过，窗口尺寸变化后重新约束一次边界，避免跑出可视区
    if (aiChatWidgetFrame.dataset.freePosition === "1") {
        const left = parseFloat(aiChatWidgetFrame.style.left) || 0;
        const top = parseFloat(aiChatWidgetFrame.style.top) || 0;
        moveFrameTo(left, top);
    }
});


// --- 核心业务逻辑 ---

function setFilePath(path) {
    state.currentFilePath = path || "";
    currentFilePathText.textContent = `当前文件：${state.currentFilePath || "未设置"}`;
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
    step2Cleaned: false,
    step2Featured: false,
    step3: false,
    step4: false
};

const stepNav = document.getElementById("stepNav");
const previewTable = document.getElementById("previewTable");
const currentFilePathText = document.getElementById("currentFilePathText");
const previewPager = document.getElementById("previewPager");
const step1Error = document.getElementById("step1Error");

function isCurrentStepCompleted(index) {
    switch (index) {
        case 0:
            return stepCompletion.step1;
        case 1:
            return stepCompletion.step2Cleaned && stepCompletion.step2Featured;
        case 2:
            return stepCompletion.step3;
        case 3:
            return stepCompletion.step4;
        default:
            return true;
    }
}

function updateStepControls() {
    const prevBtn = document.getElementById("btnPrevStep");
    const nextBtn = document.getElementById("btnNextStep");
    prevBtn.disabled = currentStepIndex === 0;
    nextBtn.disabled = currentStepIndex === stepIds.length - 1 || !isCurrentStepCompleted(currentStepIndex);
}

function invalidateFrom(stepIndex) {
    if (stepIndex <= 1) {
        stepCompletion.step2Cleaned = false;
        stepCompletion.step2Featured = false;
    }
    if (stepIndex <= 2) {
        stepCompletion.step3 = false;
        state.splitTrainPath = "";
        state.splitTestPath = "";
        const splitResult = document.getElementById("splitResult");
        if (splitResult) splitResult.textContent = "";
    }
    if (stepIndex <= 3) {
        stepCompletion.step4 = false;
        state.modelPath = "";
    }
}

function showStep(index) {
    currentStepIndex = Math.max(0, Math.min(index, stepIds.length - 1));
    stepIds.forEach((id, i) => {
        const panel = document.getElementById(id);
        if (panel) panel.classList.toggle("is-hidden", i !== currentStepIndex);
    });

    [...stepNav.querySelectorAll(".list-group-item")].forEach((btn, i) => {
        btn.classList.toggle("active", i === currentStepIndex);
    });

    updateStepControls();
}

stepNav.addEventListener("click", (e) => {
    if (!e.target.dataset.step) return;
    const idx = stepIds.indexOf(e.target.dataset.step);
    if (idx >= 0) showStep(idx);
});
document.getElementById("btnPrevStep").addEventListener("click", () => showStep(currentStepIndex - 1));
document.getElementById("btnNextStep").addEventListener("click", () => {
    if (!isCurrentStepCompleted(currentStepIndex)) {
        if (currentStepIndex === 0) {
            alert("请先完成第一步（上传或AI生成数据）");
        } else if (currentStepIndex === 1) {
            alert("请先完成数据清洗和特征工程");
        } else if (currentStepIndex === 2) {
            alert("请先完成训练测试集划分");
        } else if (currentStepIndex === 3) {
            alert("请先完成模型训练");
        }
        return;
    }
    showStep(currentStepIndex + 1);
});

function withLoading(buttonEl, actionText, loadingText, fn) {
    const oldText = buttonEl.textContent;
    buttonEl.disabled = true;
    buttonEl.textContent = loadingText || "处理中...";
    return Promise.resolve(fn()).finally(() => {
        buttonEl.disabled = false;
        buttonEl.textContent = actionText || oldText;
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
    if (!response.ok) throw new Error(parseErrorMessage(data, response.status, fallbackErrorMsg));
    if (data && data.status === "error") throw new Error(parseErrorMessage(data, response.status, fallbackErrorMsg));
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

function renderFeatureCheckbox(columns) {
    const wrap = document.getElementById("featureCheckboxWrap");
    wrap.innerHTML = "";
    columns.forEach(col => {
        const id = `feature_${col.replace(/\W/g, "_")}`;
        const item = document.createElement("div");
        item.className = "form-check";
        item.innerHTML = `<input class="form-check-input feature-check" type="checkbox" value="${escapeHtml(col)}" id="${id}"><label class="form-check-label" for="${id}">${escapeHtml(col)}</label>`;
        wrap.appendChild(item);
    });
}

function getSelectedFeatures() {
    const textFeatures = document.getElementById("featureInput").value.split(",").map(s => s.trim()).filter(Boolean);
    const checkedFeatures = [...document.querySelectorAll(".feature-check:checked")].map(el => el.value).filter(Boolean);
    return [...new Set([...textFeatures, ...checkedFeatures])];
}

function renderPreviewTable(payload) {
    const previewInfo = payload?.preview_info || (payload?.preview && !Array.isArray(payload.preview) ? payload.preview : null);
    const normalizedRows = Array.isArray(payload?.preview)
        ? payload.preview
        : (Array.isArray(previewInfo?.preview) ? previewInfo.preview : []);
    const normalizedColumns = Array.isArray(payload?.columns)
        ? payload.columns
        : (Array.isArray(previewInfo?.columns) ? previewInfo.columns : null);

    state.previewRows = normalizedRows;
    state.previewColumns = Array.isArray(normalizedColumns)
        ? normalizedColumns
        : (normalizedRows.length ? Object.keys(normalizedRows[0]) : []);
    state.totalRows = Number(payload?.total_rows ?? previewInfo?.shape?.rows ?? normalizedRows.length);
    if (!Number.isFinite(state.totalRows) || state.totalRows < 0) state.totalRows = normalizedRows.length;
    state.currentPage = 1;

    if (!state.previewColumns.length) {
        previewTable.innerHTML = "<tbody><tr><td class='text-muted'>暂无预览数据</td></tr></tbody>";
        previewPager.innerHTML = "";
        return;
    }

    renderPreviewPage();
    renderPager();
    renderFeatureCheckbox(state.previewColumns);
}

function renderPreviewPage() {
    if (!state.previewColumns.length) return;
    const startIndex = (state.currentPage - 1) * state.pageSize;
    const endIndex = startIndex + state.pageSize;
    const pageRows = state.previewRows.slice(startIndex, endIndex);

    const thead = `<thead><tr>${state.previewColumns.map(c => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>`;
    const tbodyRows = pageRows.length
        ? pageRows.map(row => `<tr>${state.previewColumns.map(col => `<td>${escapeHtml(row?.[col])}</td>`).join("")}</tr>`).join("")
        : `<tr><td colspan="${state.previewColumns.length}" class="small-hint">本页暂无数据</td></tr>`;
    previewTable.innerHTML = `${thead}<tbody>${tbodyRows}</tbody>`;
}

function renderPager() {
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
    const removedRows = Number(statistics.rows_removed || 0);
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

function clearStep1Error() {
    step1Error.classList.add("d-none");
    step1Error.textContent = "";
}

function showStep1Error(msg) {
    step1Error.textContent = msg;
    step1Error.classList.remove("d-none");
}

// Step1 上传预览
document.getElementById("btnPreviewExcel").addEventListener("click", async (e) => {
    const button = e.target;
    const file = document.getElementById("excelFile").files[0];
    clearStep1Error();
    if (!file) {

        showStep1Error("请先选择 Excel 文件（.xlsx/.xls）");
        return;
    }

    console.log("========== [前端上传开始] ==========");
    console.log("✓ 文件已选择");
    console.log("  文件名:", file.name);
    console.log("  文件大小:", file.size, "bytes");
    console.log("  文件类型:", file.type);

    await withLoading(button, "上传并预览", "处理中...", async () => {
        const formData = new FormData();
        formData.append("file", file);
        
        console.log("✓ FormData 已准备，准备发送 POST 请求...");
        console.log("URL:/api/preview-excel");
        
        try {
            const response = await fetch("/api/preview-excel", { method: "POST", body: formData });
            console.log("✓ 收到后端响应");
            console.log("  状态码:", response.status);
            console.log("  Content-Type:", response.headers.get("Content-Type"));
            
            const data = await response.json().catch((err) => {
                console.error("✗ JSON 解析失败:", err.message);
                return {};
            });
            
            console.log("✓ 响应 JSON 已解析");
            console.log("  响应内容:", JSON.stringify(data, null, 2));
            
            if (!response.ok) {
                console.error("✗ 响应状态不正常");
                throw new Error(parseErrorMessage(data, response.status, "上传失败"));
            }
            if (data && data.status === "error") {
                console.error("✗ 后端返回错误状态");
                throw new Error(parseErrorMessage(data, response.status, "解析失败"));
            }

            console.log("✓ 所有检查通过，准备渲染表格");
            renderPreviewTable(data);
            setFilePath(data.file_path || `temp/${file.name}`);
            stepCompletion.step1 = true;
            invalidateFrom(1);
            updateStepControls();
            console.log("✓ 表格渲染完成");
            console.log("========== [前端上传成功] ==========");
        } catch (fetchErr) {
            console.error("✗ fetch 请求出错:", fetchErr.message);
            throw fetchErr;
        }
    }).catch((err) => {
        console.error("========== [前端上传失败] ==========");
        console.error("错误信息:", err.message);
        showStep1Error(`第一步失败：${err.message}（详情见控制台日志）`);
    });
});

// Step1 AI 生成
document.getElementById("btnGenerateData").addEventListener("click", async (e) => {
    const button = e.target;
    const prompt = document.getElementById("aiPrompt").value.trim();
    const rowCountInput = Number(document.getElementById("aiRowCount").value || MIN_AI_ROWS);
    if (!prompt) {
        showStep1Error("请先输入 AI 生成需求");
        return;
    }
    const rowCount = Math.floor(rowCountInput);
    if (!Number.isFinite(rowCount) || rowCount < MIN_AI_ROWS || rowCount > MAX_AI_ROWS) {
        showStep1Error(`生成行数必须在 ${MIN_AI_ROWS}~${MAX_AI_ROWS} 之间`);
        return;
    }

    let customHeaders = [];
    try {
        customHeaders = parseCustomHeaders(document.getElementById("aiCustomHeaders").value);
    } catch (err) {
        showStep1Error(err.message);
        return;
    }

    clearStep1Error();

    await withLoading(button, "AI 生成并预览", "处理中...", async () => {
        const finalPrompt = buildGeneratePrompt(prompt, customHeaders);
        const data = await postJson("/api/py/generate-data", {
            prompt: finalPrompt,
            custom_headers: customHeaders,
            row_count: rowCount,
            rowCount
        }, "AI 生成失败");
        if (data.file_path) setFilePath(data.file_path);
        renderPreviewTable(data);
        stepCompletion.step1 = true;
        invalidateFrom(1);
        updateStepControls();
    }).catch((err) => showStep1Error(`AI 生成失败：${err.message}`));
});

// Step2 预处理
document.getElementById("btnCleanData").addEventListener("click", async (e) => {
    const button = e.target;
    if (!state.currentFilePath) return alert("请先完成第一步");

    const removeNullRows = Boolean(document.getElementById("cleanRemoveNullRows")?.checked);
    const outlierMode = (document.getElementById("cleanOutlierMode")?.value || "none").trim();
    const stdThreshold = Number(document.getElementById("cleanStdThreshold")?.value || 3);
    if (!Number.isFinite(stdThreshold) || stdThreshold <= 0) {
        alert("标准差阈值必须大于 0");
        return;
    }

    await withLoading(button, "一键清洗", "处理中...", async () => {
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
        stepCompletion.step2Cleaned = true;
        stepCompletion.step2Featured = false;
        invalidateFrom(2);
        updateStepControls();
    }).catch((err) => alert("清洗失败：" + err.message));
});

document.getElementById("btnProcessFeatures").addEventListener("click", async (e) => {
    const button = e.target;
    const selectedFeatures = getSelectedFeatures();
    if (!state.currentFilePath) return alert("请先准备数据");
    if (!selectedFeatures.length) return alert("请至少选择一个特征列");

    await withLoading(button, "执行特征工程", "处理中...", async () => {
        const data = await postJson("/api/py/process-features", {
            file_path: state.currentFilePath,
            categorical_features: selectedFeatures
        }, "特征工程失败");
        state.featureFilePath = data.feature_file_path || data.file_path || state.currentFilePath;
        setFilePath(state.featureFilePath);
        renderPreviewTable(data);
        stepCompletion.step2Featured = true;
        invalidateFrom(2);
        updateStepControls();
    }).catch((err) => alert("特征处理失败：" + err.message));
});

// Step3 划分
document.getElementById("btnSplitData").addEventListener("click", async (e) => {
    const button = e.target;
    if (!state.currentFilePath) return alert("请先完成前面步骤");

    const testSize = Number(document.getElementById("testSize").value || 0.2);
    const randomState = Number(document.getElementById("randomState").value || 42);

    await withLoading(button, "执行划分", "处理中...", async () => {
        const data = await postJson("/api/py/process/split", {
            file_path: state.currentFilePath,
            test_size: testSize,
            random_state: randomState
        }, "训练测试划分失败");
        state.splitTrainPath = data.train_file_path || "";
        state.splitTestPath = data.test_file_path || "";
        document.getElementById("splitResult").textContent = `划分完成：训练集 ${state.splitTrainPath}，测试集 ${state.splitTestPath}`;
        stepCompletion.step3 = true;
        invalidateFrom(3);
        updateStepControls();
    }).catch((err) => alert("划分失败：" + err.message));
});

// Step4 训练
document.getElementById("btnTrainModel").addEventListener("click", async (e) => {
    const button = e.target;
    const targetColumn = document.getElementById("targetColumn").value.trim();
    const modelType = document.getElementById("modelType").value;
    if (!targetColumn) return alert("请填写目标列名");

    const trainPath = state.splitTrainPath || state.currentFilePath;
    if (!trainPath) return alert("请先准备训练数据");

    await withLoading(button, "开始训练", "处理中...", async () => {
        const data = await postJson("/api/py/train-manual", {
            file_path: trainPath,
            target_column: targetColumn,
            model_type: modelType
        }, "模型训练失败");
        state.modelPath = data.model_path || "";
        state.targetColumn = targetColumn;
        stepCompletion.step4 = true;
        updateStepControls();
        alert("训练完成");
    }).catch((err) => alert("训练失败：" + err.message));
});

// Step5 检测
document.getElementById("btnEvaluate").addEventListener("click", async (e) => {
    const button = e.target;
    if (!state.modelPath) return alert("请先完成模型训练");
    if (!state.splitTestPath) return alert("请先执行训练测试划分");
    if (!state.targetColumn) return alert("请先填写并训练目标列");

    await withLoading(button, "测试集检测", "处理中...", async () => {
        const data = await postJson("/api/py/model/evaluate", {
            model_path: state.modelPath,
            test_file_path: state.splitTestPath,
            target_column: state.targetColumn
        }, "测试集检测失败");

        const samples = Array.isArray(data.sample_predictions) ? data.sample_predictions.slice(0, 5) : [];
        document.getElementById("evaluateResult").innerHTML = `检测完成：准确率 ${data.accuracy ?? "-"}，样本数 ${data.total_samples ?? "-"}<br>${samples.map(s => `实际:${escapeHtml(s.actual)} / 预测:${escapeHtml(s.predicted)}`).join("<br>")}`;
    }).catch((err) => alert("检测失败：" + err.message));
});

// Step5 手动预测
document.getElementById("btnManualPredict").addEventListener("click", async (e) => {
    const button = e.target;
    if (!state.modelPath) return alert("请先完成模型训练");

    const inputText = document.getElementById("manualPredictInput").value.trim();
    if (!inputText) return alert("请先输入 JSON 特征");

    let manualFeatures;
    try {
        manualFeatures = JSON.parse(inputText);
    } catch (err) {
        alert("JSON 格式错误，请检查大括号和引号");
        return;
    }

    await withLoading(button, "执行手动预测", "处理中...", async () => {
        const data = await postJson("/api/py/model/predict_manual", {
            model_path: state.modelPath,
            manual_features: manualFeatures
        }, "手动预测失败");

        const one = Array.isArray(data.sample_predictions) && data.sample_predictions.length ? data.sample_predictions[0] : null;
        document.getElementById("manualPredictResult").textContent = one
            ? `预测结果：${JSON.stringify(one)}`
            : `预测完成：${JSON.stringify(data.unique_predictions || [])}`;
    }).catch((err) => alert("手动预测失败：" + err.message));
});

window.addEventListener("load", () => {
    showStep(0);
    setTimeout(sendContextToChatWidget, 200);
});
