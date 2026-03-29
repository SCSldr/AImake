// 全局状态管理
const state = {
    currentFilePath: "",
    splitTrainPath: "",
    splitTestPath: "",
    featureFilePath: "",
    modelPath: "",
    targetColumn: "",
    previewColumns: [],
    totalRows: 0,
    currentPage: 1,
    pageSize: 10
};

// ... (保留 showStep, stepNav, btnPrevStep, btnNextStep 的事件监听)

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

const stepNav = document.getElementById("stepNav");
const previewTable = document.getElementById("previewTable");
const currentFilePathText = document.getElementById("currentFilePathText");
const previewPager = document.getElementById("previewPager");
const step1Error = document.getElementById("step1Error");

function showStep(index) {
    currentStepIndex = Math.max(0, Math.min(index, stepIds.length - 1));
    stepIds.forEach((id, i) => {
        const panel = document.getElementById(id);
        if (panel) panel.classList.toggle("is-hidden", i !== currentStepIndex);
    });

    [...stepNav.querySelectorAll(".list-group-item")].forEach((btn, i) => {
        btn.classList.toggle("active", i === currentStepIndex);
    });

    document.getElementById("btnPrevStep").disabled = currentStepIndex === 0;
    document.getElementById("btnNextStep").disabled = currentStepIndex === stepIds.length - 1;
}

stepNav.addEventListener("click", (e) => {
    if (!e.target.dataset.step) return;
    const idx = stepIds.indexOf(e.target.dataset.step);
    if (idx >= 0) showStep(idx);
});
document.getElementById("btnPrevStep").addEventListener("click", () => showStep(currentStepIndex - 1));
document.getElementById("btnNextStep").addEventListener("click", () => showStep(currentStepIndex + 1));

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
    const columns = Array.isArray(payload?.columns)
        ? payload.columns
        : (Array.isArray(payload?.preview) && payload.preview.length ? Object.keys(payload.preview[0]) : []);
    state.previewColumns = columns;
    state.totalRows = Number(payload?.total_rows ?? (Array.isArray(payload?.preview) ? payload.preview.length : 0));
    state.currentPage = 1;

    if (!state.previewColumns.length) {
        previewTable.innerHTML = "<tbody><tr><td class='text-muted'>暂无预览数据</td></tr></tbody>";
        previewPager.innerHTML = "";
        return;
    }

    const thead = `<thead><tr>${state.previewColumns.map(c => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>`;
    const tbody = `<tbody><tr><td colspan="${state.previewColumns.length}" class="small-hint">共 ${state.totalRows} 行（仅展示表头）</td></tr></tbody>`;
    previewTable.innerHTML = thead + tbody;
    renderPager();
    renderFeatureCheckbox(state.previewColumns);
}

function renderPager() {
    const totalPages = Math.max(1, Math.ceil(state.totalRows / state.pageSize));
    previewPager.innerHTML = `
        <div class="small-hint">总行数 ${state.totalRows}，分页参考 ${totalPages} 页（每页 ${state.pageSize} 行）</div>
        <div class="d-flex gap-2">
            <button class="btn btn-sm btn-outline-light" id="pagerPrev" ${state.currentPage <= 1 ? "disabled" : ""}>上一页</button>
            <button class="btn btn-sm btn-outline-light" id="pagerNext" ${state.currentPage >= totalPages ? "disabled" : ""}>下一页</button>
        </div>
    `;
    const prev = document.getElementById("pagerPrev");
    const next = document.getElementById("pagerNext");
    if (prev) prev.addEventListener("click", () => { state.currentPage = Math.max(1, state.currentPage - 1); renderPager(); });
    if (next) next.addEventListener("click", () => { state.currentPage = Math.min(totalPages, state.currentPage + 1); renderPager(); });
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

    await withLoading(button, "上传并预览", "处理中...", async () => {
        const formData = new FormData();
        formData.append("file", file);
        const response = await fetch("/api/preview-excel", { method: "POST", body: formData });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(parseErrorMessage(data, response.status, "上传失败"));
        if (data && data.status === "error") throw new Error(parseErrorMessage(data, response.status, "解析失败"));

        renderPreviewTable(data);
        setFilePath(data.file_path || `temp/${file.name}`);
    }).catch((err) => showStep1Error(`第一步失败：${err.message}`));
});

// Step1 AI 生成
document.getElementById("btnGenerateData").addEventListener("click", async (e) => {
    const button = e.target;
    const prompt = document.getElementById("aiPrompt").value.trim();
    const rowCount = Number(document.getElementById("aiRowCount").value || 20);
    if (!prompt) {
        showStep1Error("请先输入 AI 生成需求");
        return;
    }
    clearStep1Error();

    await withLoading(button, "AI 生成并预览", "处理中...", async () => {
        const data = await postJson("/api/generate-data", { prompt, row_count: rowCount, rowCount }, "AI 生成失败");
        if (data.file_path) setFilePath(data.file_path);
        renderPreviewTable(data);
    }).catch((err) => showStep1Error(`AI 生成失败：${err.message}`));
});

// Step2 预处理
document.getElementById("btnCleanData").addEventListener("click", async (e) => {
    const button = e.target;
    if (!state.currentFilePath) return alert("请先完成第一步");

    await withLoading(button, "一键清洗", "处理中...", async () => {
        const data = await postJson("/api/clean-data", { file_path: state.currentFilePath }, "数据清洗失败");
        setFilePath(data.cleaned_file_path || data.file_path || state.currentFilePath);
        renderPreviewTable(data);
    }).catch((err) => alert("清洗失败：" + err.message));
});

document.getElementById("btnProcessFeatures").addEventListener("click", async (e) => {
    const button = e.target;
    const selectedFeatures = getSelectedFeatures();
    if (!state.currentFilePath) return alert("请先准备数据");
    if (!selectedFeatures.length) return alert("请至少选择一个特征列");

    await withLoading(button, "执行特征工程", "处理中...", async () => {
        const data = await postJson("/api/process-features", {
            file_path: state.currentFilePath,
            categorical_features: selectedFeatures
        }, "特征工程失败");
        state.featureFilePath = data.feature_file_path || data.file_path || state.currentFilePath;
        setFilePath(state.featureFilePath);
        renderPreviewTable(data);
    }).catch((err) => alert("特征处理失败：" + err.message));
});

// Step3 划分
document.getElementById("btnSplitData").addEventListener("click", async (e) => {
    const button = e.target;
    if (!state.currentFilePath) return alert("请先完成前面步骤");

    const testSize = Number(document.getElementById("testSize").value || 0.2);
    const randomState = Number(document.getElementById("randomState").value || 42);

    await withLoading(button, "执行划分", "处理中...", async () => {
        const data = await postJson("/api/process/split", {
            file_path: state.currentFilePath,
            test_size: testSize,
            random_state: randomState
        }, "训练测试划分失败");
        state.splitTrainPath = data.train_file_path || "";
        state.splitTestPath = data.test_file_path || "";
        document.getElementById("splitResult").textContent = `划分完成：训练集 ${state.splitTrainPath}，测试集 ${state.splitTestPath}`;
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
        const data = await postJson("/api/train-manual", {
            file_path: trainPath,
            target_column: targetColumn,
            model_type: modelType
        }, "模型训练失败");
        state.modelPath = data.model_path || "";
        state.targetColumn = targetColumn;
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
        const data = await postJson("/api/model/evaluate", {
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
        const data = await postJson("/api/model/predict_manual", {
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
