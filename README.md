# AImake - 机器学习和数据处理后端服务

## 项目概述

AImake 是一个基于 **FastAPI** 的完整机器学习后端服务，集成了数据处理、模型训练、聚类分析和火山引擎大模型对话功能。

### 核心特性
- ✅ 数据处理：生成、清洗、特征工程、数据划分
- ✅ 机器学习：支持随机森林、KNN、逻辑回归模型训练和预测
- ✅ 聚类分析：K-Means 聚类 + 自动 PCA 降维可视化
- ✅ 大模型集成：调用火山引擎大模型生成数据和进行对话
- ✅ 完整的错误处理和中文注释
- ✅ 所有文件路径都是相对路径（相对于项目根目录）

---

## 项目结构

```
AImake/
├── main.py                    # 核心 FastAPI 应用
├── requirements.txt           # Python 依赖
├── .env                      # 环境变量（包含 VOLC_API_KEY）
├── .env.example              # 环境变量示例
├── README.md                 # 本文件
├── temp/                     # 数据文件夹（自动创建）
│   ├── data_*.csv           # 生成/清洗后的数据文件
│   └── train_*.csv, test_*.csv  # 划分后的数据
└── models/                   # 模型文件夹（自动创建）
    └── model_*.joblib       # 已训练的模型
```

---

## 快速开始

### 1️⃣ 安装依赖

```bash
pip install -r requirements.txt
```

### 2️⃣ 配置环境变量

编辑 `.env` 文件，填入你的火山引擎 API Key：

```env
VOLC_API_KEY=your_actual_api_key_here
```

### 3️⃣ 启动服务

```bash
python main.py
```

服务将在 `http://localhost:8000` 启动

### 4️⃣ 访问 API 文档

- **交互式文档**: http://localhost:8000/docs
- **ReDoc 文档**: http://localhost:8000/redoc

---

## API 接口清单

### 🏥 系统检查

#### `GET /health`
系统健康检查，验证所有目录和配置是否正常

**返回示例：**
```json
{
  "status": "healthy",
  "timestamp": "2026-03-29T10:30:00",
  "temp_dir_exists": true,
  "models_dir_exists": true
}
```

---

### 🤖 大模型接口

#### `POST /process/check_llm_connection`
测试火山引擎大模型连通性

**返回示例：**
```json
{
  "status": "success",
  "message": "大模型连接成功",
  "model": "doubao-seed-2-0-mini-260215",
  "response": "连接成功"
}
```

#### `POST /process/generate`
调用大模型生成 CSV 格式的数据

**请求示例：**
```json
{
  "prompt": "生成一个电商平台的用户行为数据集，包含用户ID、年龄、购买金额、购买类别",
  "row_count": 100
}
```

**返回示例：**
```json
{
  "status": "success",
  "file_path": "temp/data_20260329_103000.csv",
  "preview": {
    "shape": {"rows": 100, "cols": 4},
    "columns": ["user_id", "age", "amount", "category"],
    "preview": [...]
  }
}
```

#### `POST /process/ai_chat`
与大模型进行对话

**请求示例：**
```json
{
  "message": "如何处理 CSV 文件中的缺失值？",
  "context": "我有一个电商数据集"
}
```

**返回示例：**
```json
{
  "status": "success",
  "response": "可以使用 dropna() 或 fillna() 等方法...",
  "message_id": "msg_20260329_103000"
}
```

---

### 📊 数据处理接口

#### `POST /process/clean`
数据清洗（删除缺失值）

**请求示例：**
```json
{
  "file_path": "temp/data_20260329_103000.csv",
  "drop_columns": ["error_column"]
}
```

**返回示例：**
```json
{
  "status": "success",
  "cleaned_file_path": "temp/data_cleaned_20260329_103100.csv",
  "statistics": {
    "original_rows": 100,
    "cleaned_rows": 95,
    "rows_removed": 5,
    "original_null_count": 8
  }
}
```

#### `POST /process/features`
特征工程（独热编码）

**请求示例：**
```json
{
  "file_path": "temp/data_20260329_103000.csv",
  "categorical_features": ["category", "gender"]
}
```

**返回示例：**
```json
{
  "status": "success",
  "feature_file_path": "temp/data_features_20260329_103200.csv",
  "encoding_info": {
    "original_columns": ["category", "gender", "age"],
    "new_columns": ["age", "category_A", "category_B", "gender_M", "gender_F"],
    "total_new_columns": 4
  }
}
```

#### `POST /process/split`
数据划分（训练集 / 测试集）

**请求示例：**
```json
{
  "file_path": "temp/data_20260329_103000.csv",
  "test_size": 0.2,
  "random_state": 42
}
```

**返回示例：**
```json
{
  "status": "success",
  "train_file_path": "temp/train_20260329_103300.csv",
  "test_file_path": "temp/test_20260329_103300.csv",
  "statistics": {
    "total_rows": 100,
    "train_rows": 80,
    "test_rows": 20,
    "train_ratio": 0.8,
    "test_ratio": 0.2
  }
}
```

---

### 🎯 模型训练和预测

#### `POST /model/train_manual`
训练机器学习模型

**请求示例：**
```json
{
  "file_path": "temp/train_20260329_103300.csv",
  "target_column": "purchase_amount",
  "model_type": "random_forest",
  "test_size": 0.2,
  "random_state": 42
}
```

**支持的模型类型：**
- `random_forest` - 随机森林分类器
- `knn` - K-近邻分类器
- `logistic_regression` - 逻辑回归

**返回示例：**
```json
{
  "status": "success",
  "model_path": "models/model_random_forest_20260329_103400.joblib",
  "accuracy": {
    "train": 0.95,
    "test": 0.92
  },
  "train_cols": ["age", "category_A", "category_B", ...],
  "target_column": "purchase_amount",
  "data_info": {
    "total_rows": 80,
    "feature_count": 10,
    "train_rows": 64,
    "test_rows": 16
  }
}
```

#### `POST /model/evaluate`
使用测试集评估模型

**请求示例：**
```json
{
  "model_path": "models/model_random_forest_20260329_103400.joblib",
  "test_file_path": "temp/test_20260329_103300.csv",
  "target_column": "purchase_amount"
}
```

**返回示例：**
```json
{
  "status": "success",
  "accuracy": 0.92,
  "total_samples": 20,
  "correct_predictions": 18,
  "sample_predictions": [
    {"actual": 100, "predicted": 102, "correct": true},
    ...
  ]
}
```

#### `POST /model/predict_manual`
使用模型进行预测 ⭐ 关键特性：自动对齐特征列

**请求示例：**
```json
{
  "model_path": "models/model_random_forest_20260329_103400.joblib",
  "data_file_path": "temp/new_data.csv"
}
```

**返回示例：**
```json
{
  "status": "success",
  "total_predictions": 50,
  "prediction_file_path": "temp/predictions_20260329_103500.csv",
  "sample_predictions": [
    {"prediction": 105},
    {"prediction": 98},
    ...
  ]
}
```

**⭐ 关键逻辑说明：**
- 自动读取模型时保存的 `train_cols`（训练时的特征列名）
- 对输入数据进行 `pd.get_dummies` 处理
- 使用 `df.reindex(columns=train_cols, fill_value=0)` 对齐特征列
- **彻底解决列不匹配导致的 500 错误**

---

### 🎨 聚类分析

#### `POST /clustering/train_and_visualize`
K-Means 聚类 + 可视化

**请求示例：**
```json
{
  "file_path": "temp/data_20260329_103000.csv",
  "n_clusters": 3,
  "exclude_columns": ["user_id"]
}
```

**聚类逻辑：**
1. 使用 `StandardScaler` 进行数据标准化
2. 如果特征 > 2 维，使用 `PCA` 自动降维到 2D
3. 执行 K-Means 聚类
4. 生成 matplotlib 可视化图片

**返回示例：**
```json
{
  "status": "success",
  "cluster_image_base64": "iVBORw0KGgoAAAANSUhEUgAA...",
  "cluster_data_path": "temp/data_clustered_20260329_103600.csv",
  "clustering_info": {
    "n_clusters": 3,
    "n_samples": 100,
    "n_original_features": 5,
    "pca_applied": true,
    "pca_explained_variance": 0.95,
    "cluster_sizes": {
      "0": 35,
      "1": 33,
      "2": 32
    }
  }
}
```

---

## 工作流示例

### 完整的机器学习流程

```python
# 1. 生成数据
POST /process/generate
{
  "prompt": "生成一个电商数据集",
  "row_count": 1000
}
# 返回: file_path = "temp/data_xxx.csv"

# 2. 清洗数据
POST /process/clean
{
  "file_path": "temp/data_xxx.csv"
}
# 返回: cleaned_file_path = "temp/data_cleaned_xxx.csv"

# 3. 特征工程
POST /process/features
{
  "file_path": "temp/data_cleaned_xxx.csv",
  "categorical_features": ["category", "region"]
}
# 返回: feature_file_path = "temp/data_features_xxx.csv"

# 4. 数据划分
POST /process/split
{
  "file_path": "temp/data_features_xxx.csv",
  "test_size": 0.2
}
# 返回: train_file_path, test_file_path

# 5. 模型训练
POST /model/train_manual
{
  "file_path": "temp/train_xxx.csv",
  "target_column": "price",
  "model_type": "random_forest"
}
# 返回: model_path = "models/model_random_forest_xxx.joblib"

# 6. 模型评估
POST /model/evaluate
{
  "model_path": "models/model_random_forest_xxx.joblib",
  "test_file_path": "temp/test_xxx.csv",
  "target_column": "price"
}

# 7. 预测
POST /model/predict_manual
{
  "model_path": "models/model_random_forest_xxx.joblib",
  "data_file_path": "temp/new_data.csv"
}
# 返回: prediction_file_path
```

---

## 关键实现特性

### 1. 文件路径管理
- ✅ 所有文件路径都是相对于项目根目录的相对路径
- ✅ temp/ 和 models/ 自动创建
- ✅ 支持跨平台文件路径处理

### 2. 模型预测列对齐
```python
# 关键步骤：防止列不匹配错误
X_aligned = X_dummies.reindex(columns=train_cols, fill_value=0)
# - 如果有新列：填充 0
# - 如果有缺失列：自动删除
# - 完全对齐训练时的特征列
```

### 3. 数据标准化和降维
```python
# StandardScaler 进行数据标准化
scaler = StandardScaler()
X_scaled = scaler.fit_transform(X)

# PCA 自动降维（如果特征 > 2维）
if n_features > 2:
    pca = PCA(n_components=2)
    X_visual = pca.fit_transform(X_scaled)
```

### 4. 错误处理
- ✅ 所有接口都有 try-except 包装
- ✅ 详细的错误日志记录
- ✅ 用户友好的错误消息返回

### 5. 大模型集成
- ✅ 火山引擎双宝模型：`doubao-seed-2-0-mini-260215`
- ✅ 支持数据生成、对话等功能
- ✅ 完整的 API 密钥验证

---

## 环境变量配置

在 `.env` 文件中配置：

```env
# 火山引擎 API Key（必填）
VOLC_API_KEY=你的实际API密钥
```

### 获取 VOLC_API_KEY

1. 登录 [火山引擎控制台](https://console.volcengine.com/)
2. 进入"API Key"或"应用密钥"管理页面
3. 创建新的 API Key
4. 复制 Key 值到 `.env` 文件

---

## 依赖包说明

| 包名 | 版本 | 作用 |
|------|------|------|
| fastapi | 0.104.1 | Web 框架 |
| uvicorn | 0.24.0 | ASGI 服务器 |
| pandas | 2.1.3 | 数据处理 |
| numpy | 1.24.3 | 数值计算 |
| scikit-learn | 1.3.2 | 机器学习 |
| matplotlib | 3.8.2 | 数据可视化 |
| volcengine-python-sdk | 1.0.12 | 火山引擎大模型 |
| python-dotenv | 1.0.0 | 环境变量管理 |
| joblib | 1.3.2 | 模型序列化 |

---

## 常见问题

### Q1: 如何启用 CORS？
✅ 已在 main.py 中启用，允许所有来源的跨域请求

### Q2: 如何查看日志？
✅ 所有操作都会输出到控制台日志，包含时间戳和操作详情

### Q3: 如何处理特征列数量不一致的问题？
✅ 使用自动对齐机制：
```python
X_aligned = X.reindex(columns=train_cols, fill_value=0)
```

### Q4: PCA 降维什么时候触发？
✅ 当特征数 > 2 时，自动使用 PCA 降维到 2D 用于可视化

### Q5: 模型如何持久化？
✅ 使用 joblib 保存整个模型包，包括：
- 模型本身
- 训练时的特征列名 (train_cols)
- LabelEncoder（如果有）

---

## 测试建议

### 使用 curl 测试

```bash
# 1. 检查健康状态
curl http://localhost:8000/health

# 2. 测试大模型连通性
curl -X POST http://localhost:8000/process/check_llm_connection

# 3. 生成数据
curl -X POST http://localhost:8000/process/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt":"生成销售数据","row_count":100}'

# 4. 查看文档
# 在浏览器打开: http://localhost:8000/docs
```

---

## 项目架构图

```
用户请求
    ↓
FastAPI 应用
    ├── 数据处理层
    │   ├── 读取/写入 CSV/XLSX
    │   ├── Pandas 数据清洗
    │   └── 特征工程
    │
    ├── 模型处理层
    │   ├── Scikit-learn 模型训练
    │   ├── Joblib 模型序列化
    │   └── 特征列对齐
    │
    ├── 聚类分析层
    │   ├── StandardScaler 标准化
    │   ├── PCA 降维
    │   ├── K-Means 聚类
    │   └── Matplotlib 可视化
    │
    └── 大模型层
        └── 火山引擎 API
            ├── 数据生成
            └── 对话服务
```

---

## 贡献指南

欢迎提交 Issue 和 Pull Request！

---

## 许可证

MIT License

---

**最后更新**: 2026 年 3 月 29 日
**版本**: 1.0.0
