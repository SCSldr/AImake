// 全局状态管理
const state = {
    currentFilePath: "",
    splitTrainPath: "",
    splitTestPath: "",
    featureFilePath: "",
    modelPath: "",
    targetColumn: "",
    selectedFeatureColumns: [],
    trainedFeatureColumns: [],
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
        state.selectedFeatureColumns = [];
        state.trainedFeatureColumns = [];
    }
    if (stepIndex <= 2) {
        stepCompletion.step3 = false;
        state.splitTrainPath = "";
        state.splitTestPath = "";
        state.trainedFeatureColumns = [];
        const splitResult = document.getElementById("splitResult");
        if (splitResult) splitResult.textContent = "";
    }
    if (stepIndex <= 3) {
        stepCompletion.step4 = false;
        state.modelPath = "";
        state.trainedFeatureColumns = [];
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

const OUTLIER_PERCENT_BY_STD = {
    "1.0": 31.7,
    "1.5": 13.4,
    "2.0": 4.6,
    "2.5": 1.2,
    "3.0": 0.3,
    "3.5": 0.05,
    "4.0": 0.01,
    "4.5": 0.001,
    "5.0": 0.0001,
    "5.5": 0.00001,
    "6.0": 0.000001
};

function updateOutlierPreviewHint(stdValue) {
    const key = Number(stdValue).toFixed(1);
    const value = OUTLIER_PERCENT_BY_STD[key];
    const hint = document.getElementById("outlierPreviewHint");
    if (!hint) return;
    hint.textContent = `相当于原数量的${value !== undefined ? value : 0}%`;
}

function getActiveTargetColumn() {
    const inputVal = (document.getElementById("targetColumn")?.value || "").trim();
    return inputVal || (state.targetColumn || "").trim();
}

function normalizeColumnName(value) {
    return String(value || "").trim().toLowerCase();
}

function getManualTemplateColumns() {
    const sourceCols =
        (Array.isArray(state.trainedFeatureColumns) && state.trainedFeatureColumns.length ? state.trainedFeatureColumns : null)
        || (Array.isArray(state.selectedFeatureColumns) && state.selectedFeatureColumns.length ? state.selectedFeatureColumns : null)
        || (Array.isArray(state.previewColumns) ? state.previewColumns : []);

    const cols = [...new Set((sourceCols || []).map(col => String(col).trim()).filter(Boolean))];
    if (!cols.length) return [];
    const activeTarget = getActiveTargetColumn();
    if (!activeTarget) return cols;
    const targetNorm = normalizeColumnName(activeTarget);
    return cols.filter(col => normalizeColumnName(col) !== targetNorm);
}

function updateManualHeaderTemplate() {
    const box = document.getElementById("manualHeaderTemplateBox");
    if (!box) return;
    const cols = getManualTemplateColumns();
    if (!cols.length) {
        box.value = '{"feature_1": "", "feature_2": ""}';
        return;
    }
    const templateObj = {};
    cols.forEach(col => {
        templateObj[col] = "";
    });
    box.value = JSON.stringify(templateObj, null, 2);
}

function renderEvaluateVisualization(imageBase64, taskType, totalSamples) {
    const panel = document.getElementById("evaluateVisualizationPanel");
    const img = document.getElementById("evaluateVisualizationImage");
    const meta = document.getElementById("evaluateVisualizationMeta");
    if (!panel || !img || !meta) return;

    if (!imageBase64) {
        panel.classList.add("d-none");
        img.removeAttribute("src");
        meta.textContent = "";
        return;
    }

    img.src = imageBase64;
    meta.textContent = `可视化类型：${taskType === "classification" ? "分类" : "回归"}，样本数：${totalSamples || 0}`;
    panel.classList.remove("d-none");
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
    updateManualHeaderTemplate();
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
        notify.warning("请先选择 Excel 文件（.xlsx/.xls）");
        return;
    }

    await withLoading(button, "上传并预览", "处理中...", async () => {
        const formData = new FormData();
        formData.append("file", file);
        
        const notif = notify.loading(`📤 上传中... (${file.name})`);
        try {
            const response = await fetch("/api/preview-excel", { method: "POST", body: formData });

            const data = await response.json().catch((err) => ({}));

            if (!response.ok) {
                notif.update(`❌ 上传失败: ${parseErrorMessage(data, response.status, "上传失败")}`, 'error');
                throw new Error(parseErrorMessage(data, response.status, "上传失败"));
            }
            if (data && data.status === "error") {
                notif.update(`❌ 解析失败: ${parseErrorMessage(data, response.status, "解析失败")}`, 'error');
                throw new Error(parseErrorMessage(data, response.status, "解析失败"));
            }

            notif.update(`✅ 数据加载成功，共 ${data.total_rows} 行`, 'success');
            renderPreviewTable(data);
            setFilePath(data.file_path || `temp/${file.name}`);
            stepCompletion.step1 = true;
            invalidateFrom(1);
            updateStepControls();

            setTimeout(() => notif.close(), 2000);
        } catch (fetchErr) {
            notif.update(`❌ 错误: ${fetchErr.message}`, 'error');
            showStep1Error(`第一步失败：${fetchErr.message}`);
            throw fetchErr;
        }
    }).catch((err) => {
        notify.error(`上传失败: ${err.message}`);
        showStep1Error(`第一步失败：${err.message}`);
    });
});

// Step1 AI 生成
document.getElementById("btnGenerateData").addEventListener("click", async (e) => {
    const button = e.target;
    const prompt = document.getElementById("aiPrompt").value.trim();
    const rowCountInput = Number(document.getElementById("aiRowCount").value || MIN_AI_ROWS);
    if (!prompt) {
        showStep1Error("请先输入 AI 生成需求");
        notify.warning("请先输入 AI 生成需求");
        return;
    }
    const rowCount = Math.floor(rowCountInput);
    if (!Number.isFinite(rowCount) || rowCount < MIN_AI_ROWS || rowCount > MAX_AI_ROWS) {
        showStep1Error(`生成行数必须在 ${MIN_AI_ROWS}~${MAX_AI_ROWS} 之间`);
        notify.warning(`生成行数必须在 ${MIN_AI_ROWS}~${MAX_AI_ROWS} 之间`);
        return;
    }

    let customHeaders = [];
    try {
        customHeaders = parseCustomHeaders(document.getElementById("aiCustomHeaders").value);
    } catch (err) {
        showStep1Error(err.message);
        notify.warning(err.message);
        return;
    }

    clearStep1Error();
    const notif = notify.loading("🤖 AI 正在生成数据中...");

    await withLoading(button, "AI 生成并预览", "处理中...", async () => {
        const finalPrompt = buildGeneratePrompt(prompt, customHeaders);
        const data = await postJson("api/py/generate-data", {
            prompt: finalPrompt,
            custom_headers: customHeaders,
            row_count: rowCount,
            rowCount
        });

        notif.update(`✅ 数据生成成功，共 ${data.total_rows} 行`, 'success');
        if (data.file_path) setFilePath(data.file_path);
        renderPreviewTable(data);
        stepCompletion.step1 = true;
        invalidateFrom(1);
        updateStepControls();

        setTimeout(() => notif.close(), 2000);
    }).catch((err) => {
        notif.update(`❌ AI 生成失败: ${err.message}`, 'error');
        showStep1Error(`AI 生成失败：${err.message}`);
    });
});

// Step2 数据质量检测
document.getElementById("btnCheckQuality").addEventListener("click", async (e) => {
    const button = e.target;
    if (!state.currentFilePath) {
        notify.warning("请先完成第一步");
        return;
    }

    const notif = notify.loading("📊 正在检测数据质量...");

    try {
        const response = await fetch("api/py/check-data", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ file_path: state.currentFilePath })
        });
        const data = await response.json();

        if (!response.ok || data.status === "error") {
            throw new Error(data.details || "质量检测失败");
        }

        // 生成质量报告
        let reportHtml = "";

        if (data.duplicates.has_duplicates) {
            reportHtml += `<div class="mb-2">🔁 <strong>重复行：</strong>${data.duplicates.duplicate_rows} 行（${data.duplicates.duplicate_ratio}%）</div>`;
            document.getElementById("duplicateHint").innerHTML = `<strong>${data.duplicates.duplicate_rows}</strong> 行重复`;
        } else {
            document.getElementById("duplicateHint").innerHTML = "无重复行 ✓";
        }

        if (data.non_standard_values.has_non_standard) {
            reportHtml += `<div class="mb-2">⚠️ <strong>非规范值：</strong>${data.non_standard_values.problematic_cells} 个单元格（${data.non_standard_values.problematic_ratio}%）`;
            const issues = [];
            for (const [col, details] of Object.entries(data.non_standard_values.issues_by_column)) {
                if (details.comma_numbers > 0) issues.push(`${col}中有${details.comma_numbers}个逗号分隔的数字`);
                if (details.iso_dates > 0) issues.push(`${col}中有${details.iso_dates}个ISO日期格式`);
                if (details.leading_spaces > 0) issues.push(`${col}中有${details.leading_spaces}个含空格的值`);
            }
            if (issues.length > 0) {
                reportHtml += `<ul style="margin: 8px 0 0 20px;">` + issues.map(i => `<li style="font-size: 12px;">${i}</li>`).join("") + `</ul>`;
            }
            reportHtml += `</div>`;
            document.getElementById("nonStandardHint").innerHTML = `<strong>${data.non_standard_values.problematic_cells}</strong> 个问题`;
        } else {
            document.getElementById("nonStandardHint").innerHTML = "无非规范值 ✓";
        }

        if (!data.quality_issues.has_issues) {
            reportHtml = '<div class="mb-2">✅ 数据质量良好，无明显问题</div>';
        }

        const panel = document.getElementById("qualityReportPanel");
        document.getElementById("qualityReportContent").innerHTML = reportHtml;
        panel.classList.remove("d-none");

        notif.update(`✅ 检测完成：${data.quality_issues.issue_count} 个问题`, 'success');
        setTimeout(() => notif.close(), 2000);
    } catch (err) {
        notif.update(`❌ 检测失败: ${err.message}`, 'error');
        notify.error(`检测失败: ${err.message}`);
    }
});

// 实时计算异常值数量（监听滑块变化）
document.getElementById("cleanStdThreshold").addEventListener("input", (e) => {
    const stdValue = parseFloat(e.target.value);
    document.getElementById("stdThresholdValue").textContent = stdValue.toFixed(1);
    updateOutlierPreviewHint(stdValue);
});

// Step2 预处理
document.getElementById("btnCleanData").addEventListener("click", async (e) => {
    const button = e.target;
    if (!state.currentFilePath) {
        notify.warning("请先完成第一步");
        return;
    }

    const removeNullRows = Boolean(document.getElementById("cleanRemoveNullRows")?.checked);
    const removeDuplicates = Boolean(document.getElementById("cleanRemoveDuplicates")?.checked);
    const standardizeValues = Boolean(document.getElementById("cleanStandardizeValues")?.checked);
    const outlierMode = (document.getElementById("cleanOutlierMode")?.value || "none").trim();
    const stdThreshold = Number(document.getElementById("cleanStdThreshold")?.value || 3);
    if (!Number.isFinite(stdThreshold) || stdThreshold <= 0) {
        notify.warning("标准差阈值必须大于 0");
        return;
    }

    const notif = notify.loading("🧹 正在清洗数据...");

    await withLoading(button, "一键清洗", "处理中...", async () => {
        const data = await postJson("/api/py/clean-data", {
            file_path: state.currentFilePath,
            remove_null_rows: removeNullRows,
            fill_missing: !removeNullRows,
            outlier_mode: outlierMode,
            remove_outliers: outlierMode === "remove",
            outlier_std_threshold: stdThreshold,
            remove_duplicates: removeDuplicates,
            standardize_values: standardizeValues
        }, "数据清洗失败");

        setFilePath(data.cleaned_file_path || data.file_path || state.currentFilePath);
        renderPreviewTable(data);
        renderCleanStats(data.statistics);

        const stats = data.statistics;
        const cleanedRows = stats.cleaned_rows || 0;
        const kept = stats.cleaned_rows && stats.original_rows ?
            ((cleanedRows / stats.original_rows) * 100).toFixed(1) : '0';

        let details = `保留 ${kept}% (${cleanedRows} 行)`;
        if (removeDuplicates && stats.rows_removed_by_duplicate) details += `，删除重复 ${stats.rows_removed_by_duplicate}`;
        if (standardizeValues && stats.rows_standardized) details += `，规范化 ${stats.rows_standardized}`;

        notif.update(`✅ 清洗完成：${details}`, 'success');
        stepCompletion.step2Cleaned = true;
        stepCompletion.step2Featured = false;
        invalidateFrom(2);
        updateStepControls();

        setTimeout(() => notif.close(), 2000);
    }).catch((err) => {
        notif.update(`❌ 清洗失败: ${err.message}`, 'error');
        notify.error(`清洗失败: ${err.message}`);
    });
});

document.getElementById("btnProcessFeatures").addEventListener("click", async (e) => {
    const button = e.target;
    const selectedFeatures = getSelectedFeatures();
    if (!state.currentFilePath) {
        notify.warning("请先准备数据");
        return;
    }
    if (!selectedFeatures.length) {
        notify.warning("请至少选择一个特征列");
        return;
    }

    const notif = notify.loading("⚙️ 正在执行特征工程...");

    await withLoading(button, "执行特征工程", "处理中...", async () => {
        const data = await postJson("/api/py/process-features", {
            file_path: state.currentFilePath,
            categorical_features: selectedFeatures
        }, "特征工程失败");
        state.selectedFeatureColumns = [...selectedFeatures];
        state.featureFilePath = data.feature_file_path || data.file_path || state.currentFilePath;
        setFilePath(state.featureFilePath);
        renderPreviewTable(data);

        notif.update(`✅ 特征工程完成：处理 ${selectedFeatures.length} 个特征`, 'success');
        stepCompletion.step2Featured = true;
        invalidateFrom(2);
        updateStepControls();

        setTimeout(() => notif.close(), 2000);
    }).catch((err) => {
        notif.update(`❌ 特征处理失败: ${err.message}`, 'error');
        notify.error(`特征处理失败: ${err.message}`);
    });
});

// Step3 划分
document.getElementById("btnSplitData").addEventListener("click", async (e) => {
    const button = e.target;
    if (!state.currentFilePath) {
        notify.warning("请先完成前面步骤");
        return;
    }

    const testSize = Number(document.getElementById("testSize").value || 0.2);
    const randomState = Number(document.getElementById("randomState").value || 42);

    const notif = notify.loading("📊 正在执行划分...");

    await withLoading(button, "执行划分", "处理中...", async () => {
        const data = await postJson("/api/py/process/split", {
            file_path: state.currentFilePath,
            test_size: testSize,
            random_state: randomState
        }, "训练测试划分失败");
        state.splitTrainPath = data.train_file_path || "";
        state.splitTestPath = data.test_file_path || "";

        // 优先读取后端返回的统计；若缺失则按当前总行数兜底估算，避免显示 ?
        let trainRows = Number(data.statistics?.train_rows ?? data.train_rows);
        let testRows = Number(data.statistics?.test_rows ?? data.test_rows);
        if (!Number.isFinite(trainRows) || !Number.isFinite(testRows)) {
            const total = Number(state.totalRows || 0);
            if (Number.isFinite(total) && total > 0) {
                testRows = Number.isFinite(testRows) ? testRows : Math.round(total * testSize);
                trainRows = Number.isFinite(trainRows) ? trainRows : Math.max(0, total - testRows);
            }
        }

        const trainText = Number.isFinite(trainRows) ? String(Math.max(0, Math.round(trainRows))) : "?";
        const testText = Number.isFinite(testRows) ? String(Math.max(0, Math.round(testRows))) : "?";
        document.getElementById("splitResult").textContent = `✅ 划分完成：训练集 ${trainText} 行，测试集 ${testText} 行`;

        notif.update(`✅ 数据划分完成（训练:测试 = ${(1-testSize).toFixed(1)}:${testSize.toFixed(1)})`, 'success');
        stepCompletion.step3 = true;
        invalidateFrom(3);
        updateStepControls();

        setTimeout(() => notif.close(), 2000);
    }).catch((err) => {
        notif.update(`❌ 划分失败: ${err.message}`, 'error');
        notify.error(`划分失败: ${err.message}`);
    });
});

// Step4 训练
document.getElementById("btnTrainModel").addEventListener("click", async (e) => {
    const button = e.target;
    const modelReportContent = document.getElementById("modelReportContent");
    const targetColumn = document.getElementById("targetColumn").value.trim();
    const modelType = document.getElementById("modelType").value;
    if (!targetColumn) {
        notify.warning("请填写目标列名");
        return;
    }

    const trainPath = state.splitTrainPath || state.currentFilePath;
    if (!trainPath) {
        notify.warning("请先准备训练数据");
        return;
    }

    const notif = notify.loading(`🤖 正在训练 ${modelType} 模型...`);
    if (modelReportContent) {
        modelReportContent.innerHTML = `<span class="text-muted">模型训练中，请稍候...</span>`;
    }

    await withLoading(button, "开始训练", "处理中...", async () => {
        const data = await postJson("/api/py/train-manual", {
            file_path: trainPath,
            target_column: targetColumn,
            model_type: modelType
        }, "模型训练失败");
        state.modelPath = data.model_path || "";
        state.targetColumn = targetColumn;
        const trainedCols = data.train_cols || data.train_columns || data.feature_columns || data.features || [];
        state.trainedFeatureColumns = Array.isArray(trainedCols) ? trainedCols : [];
        updateManualHeaderTemplate();

        const trainAcc = data.accuracy?.train ? (data.accuracy.train * 100).toFixed(2) : "?";
        const testAcc = data.accuracy?.test ? (data.accuracy.test * 100).toFixed(2) : "?";
        if (modelReportContent) {
            modelReportContent.innerHTML = `<div class="text-success">训练成功：训练准确率 ${trainAcc}%，测试准确率 ${testAcc}%</div>`;
        }

        notif.update(`✅ 模型训练完成！训练准确率: ${trainAcc}%, 测试准确率: ${testAcc}%`, 'success');
        stepCompletion.step4 = true;
        updateStepControls();

        setTimeout(() => notif.close(), 2000);
    }).catch((err) => {
        if (modelReportContent) {
            modelReportContent.innerHTML = `<div class="text-danger">训练失败：${escapeHtml(err.message || "未知错误")}</div>`;
        }
        notify.error(`训练失败: ${err.message}`);
    });
});

document.getElementById("targetColumn")?.addEventListener("input", () => {
    updateManualHeaderTemplate();
});

// Step5 检测
document.getElementById("btnEvaluate").addEventListener("click", async (e) => {
    const button = e.target;
    if (!state.modelPath) {
        notify.warning("请先完成模型训练");
        return;
    }
    if (!state.splitTestPath) {
        notify.warning("请先执行训练测试划分");
        return;
    }
    if (!state.targetColumn) {
        notify.warning("请先填写并训练目标列");
        return;
    }

    const notif = notify.loading("📈 正在在测试集上评估...");
    renderEvaluateVisualization(null);

    await withLoading(button, "测试集检测", "处理中...", async () => {
        const data = await postJson("/api/py/model/evaluate", {
            model_path: state.modelPath,
            test_file_path: state.splitTestPath,
            target_column: state.targetColumn
        }, "测试集检测失败");

        const samples = Array.isArray(data.sample_predictions) ? data.sample_predictions.slice(0, 5) : [];
        const isRegression = data.task_type === "regression";

        if (isRegression) {
            const r2 = Number(data.metrics?.r2 ?? data.accuracy);
            const mae = Number(data.metrics?.mae);
            const rmse = Number(data.metrics?.rmse);
            const r2Text = Number.isFinite(r2) ? r2.toFixed(4) : "?";
            const maeText = Number.isFinite(mae) ? mae.toFixed(4) : "?";
            const rmseText = Number.isFinite(rmse) ? rmse.toFixed(4) : "?";
            const explainedPct = Number.isFinite(r2) ? (r2 * 100).toFixed(2) : "?";
            const rmseVsMae = Number.isFinite(rmse) && Number.isFinite(mae)
                ? (rmse > mae ? "高于" : (rmse < mae ? "低于" : "接近"))
                : "接近";
            const sampleStr = samples
                .map(s => {
                    const predictedNum = Number(s.predicted);
                    const actualNum = Number(s.actual);
                    const rawError = Number(s.error);
                    const finalError = Number.isFinite(rawError)
                        ? rawError
                        : (Number.isFinite(predictedNum) && Number.isFinite(actualNum) ? predictedNum - actualNum : NaN);

                    const predictedText = Number.isFinite(predictedNum)
                        ? predictedNum.toFixed(2)
                        : escapeHtml(s.predicted);
                    const errorText = Number.isFinite(finalError)
                        ? Math.abs(finalError).toFixed(2)
                        : "--";

                    return `实际:${escapeHtml(s.actual)} → 预测:${predictedText} (误差:${errorText})`;
                })
                .join("<br>");

            const metricExplainHtml = `
                <div class="small-hint mt-2" style="background-color: rgba(46, 139, 87, 0.15); color: #2e8b57; border: 1px solid rgba(46, 139, 87, 0.4); border-radius: 8px; padding: 12px 16px; white-space: pre-line; font-weight: 500;backdrop-filter: blur(4px);"><strong>??解读：</strong>
R^2 —— 决定系数
含义：它代表模型解释了因变量中 ${explainedPct}% 的波动。
MAE (Mean Absolute Error) —— 平均绝对误差
含义：它代表预测值与真实值之间差距的绝对平均值，在你的模型中平均每次预测偏离约 ${maeText} 个单位。
RMSE (Root Mean Square Error) —— 均方根误差
含义：它反映预测值偏离真实值的离散程度。你的 RMSE (${rmseText}) ${rmseVsMae} MAE (${maeText})，说明误差点对结果有一定影响。
                </div>
            `;

            document.getElementById("evaluateResult").innerHTML =
                `<strong>R2: ${r2Text}</strong> (测试样本: ${data.total_samples || 0})` +
                `<br>MAE: ${maeText}，RMSE: ${rmseText}` +
                metricExplainHtml +
                (sampleStr ? `<br>${sampleStr}` : "");

            notif.update(`✅ 评估完成：R2=${r2Text}`, 'success');
        } else {
            const accuracy = Number(data.accuracy);
            const accuracyText = Number.isFinite(accuracy) ? (accuracy * 100).toFixed(2) : "?";
            const sampleStr = samples
                .map(s => {
                    const predictedNum = Number(s.predicted);
                    const predictedText = Number.isFinite(predictedNum)
                        ? predictedNum.toFixed(2)
                        : escapeHtml(s.predicted);
                    return `${s.correct ? "✓" : "✗"} 实际:${escapeHtml(s.actual)} → 预测:${predictedText}`;
                })
                .join("<br>");

            document.getElementById("evaluateResult").innerHTML =
                `<strong>准确率: ${accuracyText}%</strong> (测试样本: ${data.total_samples || 0})` +
                (sampleStr ? `<br>${sampleStr}` : "");

            notif.update(`✅ 评估完成：准确率 ${accuracyText}%`, 'success');
        }
        try {
            const vizData = await postJson("/api/py/model/visualize_predictions", {
                model_path: state.modelPath,
                test_file_path: state.splitTestPath,
                target_column: state.targetColumn
            }, "预测可视化生成失败");
            renderEvaluateVisualization(vizData.visualization_image, vizData.task_type, vizData.metrics?.total_samples);
        } catch (vizErr) {
            renderEvaluateVisualization(null);
            notify.warning(`评估已完成，但可视化生成失败：${vizErr.message}`);
        }

        setTimeout(() => notif.close(), 2000);
    }).catch((err) => {
        notif.update(`❌ 评估失败: ${err.message}`, 'error');
        notify.error(`评估失败: ${err.message}`);
    });
});

// Step5 手动预测
document.getElementById("btnManualPredict").addEventListener("click", async (e) => {
    const button = e.target;
    if (!state.modelPath) {
        notify.warning("请先完成模型训练");
        return;
    }

    const inputText = document.getElementById("manualPredictInput").value.trim();
    if (!inputText) {
        notify.warning("请先输入 JSON 特征");
        return;
    }

    let manualFeatures;
    try {
        manualFeatures = JSON.parse(inputText);
    } catch (err) {
        notify.error("JSON 格式错误，请检查大括号和引号");
        return;
    }

    const notif = notify.loading("🔮 正在进行预测...");

    await withLoading(button, "执行手动预测", "处理中...", async () => {
        const data = await postJson("/api/py/model/predict_manual", {
            model_path: state.modelPath,
            manual_features: manualFeatures
        }, "手动预测失败");
        console.log("准备发送给后端的数据：", manualFeatures);

        const targetName = getActiveTargetColumn() || "prediction";
        const one = Array.isArray(data.sample_predictions) && data.sample_predictions.length ? data.sample_predictions[0] : null;
        let predictedValue = null;
        if (one && typeof one === "object") {
            predictedValue = one.predicted ?? one.prediction ?? one.result ?? null;
        }
        if (predictedValue === null && Array.isArray(data.unique_predictions) && data.unique_predictions.length > 0) {
            predictedValue = data.unique_predictions[0];
        }
        const predictedNum = Number(predictedValue);
        const predictedText = Number.isFinite(predictedNum)
            ? predictedNum.toFixed(2)
            : escapeHtml(predictedValue);
        const result = predictedValue !== null
            ? `🎯 预测结果：${targetName} = ${predictedText}`
            : `✅ 预测完成：${escapeHtml(JSON.stringify(data.unique_predictions || []))}`;

        const align = data.feature_alignment || {};
        let alignHint = "";
        if (Number(align.matched_count) < Number(align.train_feature_count)) {
            alignHint = `<br><span class="text-warning">特征匹配：${align.matched_count || 0}/${align.train_feature_count || 0}，缺失 ${align.missing_count || 0} 个。请优先使用上方模板字段。</span>`;
        }
        if (Array.isArray(align.missing_features_preview) && align.missing_features_preview.length) {
            alignHint += `<br><span class="small-hint">缺失特征示例：${escapeHtml(align.missing_features_preview.slice(0, 8).join(", "))}</span>`;
        }

        document.getElementById("manualPredictResult").innerHTML = `<strong>${result}</strong>${alignHint}`;

        notif.update("✅ 预测完成", 'success');
        setTimeout(() => notif.close(), 2000);
    }).catch((err) => {
        notif.update(`❌ 预测失败: ${err.message}`, 'error');
        notify.error(`预测失败: ${err.message}`);
    });
});

document.getElementById("manualHeaderTemplateBox")?.addEventListener("click", async () => {
    const box = document.getElementById("manualHeaderTemplateBox");
    const input = document.getElementById("manualPredictInput");
    if (!box || !input) return;
    input.value = box.value;
    input.focus();
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(box.value);
            notify.success("已填入输入框并复制到剪贴板");
            return;
        }
    } catch (e) {
        // 剪贴板失败时只保留填入行为
    }
    notify.success("已填入输入框");
});

window.addEventListener("load", () => {
    showStep(0);
    const stdInput = document.getElementById("cleanStdThreshold");
    if (stdInput) updateOutlierPreviewHint(stdInput.value);
    updateManualHeaderTemplate();
    setTimeout(sendContextToChatWidget, 200);
});
