"""
AImake - 机器学习和数据处理后端 FastAPI 服务
时间：2026年3月
作用：提供数据处理、模型训练、聚类分析和大模型对话功能
"""

import os
import re
import io
import base64
import json
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from pathlib import Path
from typing import Optional, List, Dict, Any
from datetime import datetime
import logging
import traceback

# FastAPI 相关
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn
from pydantic import BaseModel

# 数据处理和模型
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.neighbors import KNeighborsClassifier, KNeighborsRegressor
from sklearn.linear_model import LogisticRegression
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
import joblib
import openpyxl

# 环境变量
from dotenv import load_dotenv

# 火山引擎大模型
from volcenginesdkarkruntime import Ark
import volcenginesdkarkruntime as ark
from pydantic import BaseModel


# AI生成数据
class GenerateRequest(BaseModel):
    prompt: str
    row_count: int = 20
    custom_headers: Optional[List[str]] = None

# 特征工程模型
class FeatureRequest(BaseModel):
    file_path: str
    categorical_features: List[str] = [] # 接收前端选中的特征列

# 数据划分模型
class SplitRequest(BaseModel):
    file_path: str
    test_size: float = 0.2
    random_state: int = 42

# 模型训练模型
class TrainRequest(BaseModel):
    file_path: str
    target_column: str
    model_type: str = "auto"


class EvaluateRequest(BaseModel):
    model_path: str
    test_file_path: str
    target_column: str


class PredictRequest(BaseModel):
    model_path: str
    data_file_path: Optional[str] = None
    manual_features: Optional[Dict[str, Any]] = None

# AI 对话请求
class AiChatRequest(BaseModel):
    message: str
    context: Optional[str] = None
    clear_history: Optional[bool] = False


# 加载环境变量
load_dotenv()

# ===================== 日志配置 =====================
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class CleanRequest(BaseModel):
    file_path: str
    drop_columns: Optional[List[str]] = None
    # 是否直接删除含空值的行
    remove_null_rows: bool = False
    # 不删行时是否填充缺失值
    fill_missing: bool = True
    # 兼容旧前端参数
    remove_outliers: bool = False
    # none/clip/remove: 不处理/截断/删行
    outlier_mode: str = 'none'
    outlier_std_threshold: float = 4.0
    # 额外开关
    remove_duplicates: bool = False
    standardize_values: bool = False

# ===================== 项目目录配置 =====================
# 项目根目录
PROJECT_ROOT = Path(__file__).parent.absolute()
# temp 文件夹用于存放 csv/xlsx 文件
TEMP_DIR = PROJECT_ROOT / 'temp'
TEMP_DIR.mkdir(exist_ok=True)
# models 文件夹用于存放已训练的模型
MODELS_DIR = PROJECT_ROOT / 'models'
MODELS_DIR.mkdir(exist_ok=True)

# ===================== 图像生成工具函数 =====================
def generate_cluster_image_base64(X_pca, labels, n_clusters):
    """
    生成聚类结果的可视化图像，返回 base64 编码
    """
    try:
        plt.figure(figsize=(8, 6))
        plt.style.use('default')
        
        # 为每个簇分配不同的颜色
        colors = plt.cm.Set3(np.linspace(0, 1, n_clusters))
        
        for cluster_id in range(n_clusters):
            mask = labels == cluster_id
            plt.scatter(X_pca[mask, 0], X_pca[mask, 1], 
                       c=[colors[cluster_id]], 
                       label=f'簇 {cluster_id}',
                       s=100, alpha=0.7, edgecolors='black', linewidth=0.5)
        
        plt.xlabel('第一主成分 (PC1)')
        plt.ylabel('第二主成分 (PC2)')
        plt.title('K-Means 聚类结果可视化')
        plt.legend(loc='best', fontsize=9)
        plt.grid(True, alpha=0.3)
        plt.tight_layout()
        
        # 转换为 base64
        buffer = io.BytesIO()
        plt.savefig(buffer, format='png', dpi=80, bbox_inches='tight')
        plt.close()
        
        buffer.seek(0)
        image_base64 = base64.b64encode(buffer.read()).decode()
        return f"data:image/png;base64,{image_base64}"
    except Exception as e:
        logger.error(f"生成聚类图像失败: {str(e)}")
        return None

def generate_regression_image_base64(y_true, y_pred, task_type='regression'):
    """
    生成回归/分类预测结果的可视化图像，返回 base64 编码
    """
    try:
        plt.figure(figsize=(10, 6))
        plt.style.use('default')
        
        if task_type == 'regression':
            # 回归：绘制实际值 vs 预测值
            plt.scatter(y_true, y_pred, alpha=0.6, s=100, edgecolors='black', linewidth=0.5)
            # 绘制完美预测线
            min_val = min(y_true.min(), y_pred.min())
            max_val = max(y_true.max(), y_pred.max())
            plt.plot([min_val, max_val], [min_val, max_val], 'r--', label='完美预测', linewidth=2)
            plt.xlabel('实际值 (Actual)')
            plt.ylabel('预测值 (Predicted)')
            plt.title('回归模型预测效果')
        else:
            # 分类：绘制混淆矩阵或分类结果分布
            from sklearn.metrics import confusion_matrix
            
            unique_labels = np.unique(np.concatenate([y_true, y_pred]))
            cm = confusion_matrix(y_true, y_pred, labels=unique_labels)
            
            # 使用 imshow 显示混淆矩阵
            im = plt.imshow(cm, interpolation='nearest', cmap='Blues')
            plt.title('分类模型混淆矩阵')
            plt.colorbar(im)
            
            tick_marks = np.arange(len(unique_labels))
            plt.xticks(tick_marks, unique_labels)
            plt.yticks(tick_marks, unique_labels)
            
            # 添加数字标注
            for i in range(cm.shape[0]):
                for j in range(cm.shape[1]):
                    plt.text(j, i, str(cm[i, j]), ha='center', va='center', 
                            color='white' if cm[i, j] > cm.max() / 2 else 'black')
            
            plt.xlabel('预测标签')
            plt.ylabel('实际标签')
        
        plt.grid(True, alpha=0.3)
        plt.tight_layout()
        
        # 转换为 base64
        buffer = io.BytesIO()
        plt.savefig(buffer, format='png', dpi=80, bbox_inches='tight')
        plt.close()
        
        buffer.seek(0)
        image_base64 = base64.b64encode(buffer.read()).decode()
        return f"data:image/png;base64,{image_base64}"
    except Exception as e:
        logger.error(f"生成预测可视化图像失败: {str(e)}")
        return None

# ===================== 常量 =====================
# 火山引擎大模型配置（从 .env 文件读取）
VOLC_API_KEY = os.getenv('api_key', '')
VOLC_MODEL = os.getenv('Model', 'doubao-seed-2-0-mini-260215')
VOLC_BASE_URL = os.getenv('api_url', 'https://ark.cn-beijing.volces.com/api/v3')
ALLOWED_EXTENSIONS = {'.csv', '.xlsx'}

# ===================== FastAPI 应用初始化 =====================
app = FastAPI(
    title='AImake - 机器学习后端服务',
    description='数据处理、模型训练、聚类分析和大模型对话服务',
    version='1.0.0'
)

# 添加 CORS 中间件（允许跨域请求）
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*']
)


# ===================== 工具函数 =====================
def get_relative_path(file_path: str) -> str:
    """
    将文件路径转换为相对于项目根目录的相对路径
    """
    try:
        return str(Path(file_path).relative_to(PROJECT_ROOT))
    except ValueError:
        return file_path


def generate_unique_filename(extension: str = '.csv') -> str:
    """
    生成唯一的文件名
    """
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S_%f')
    return f"data_{timestamp}{extension}"


def validate_file_path(file_path: str) -> Path:
    """
    验证文件路径是否存在，返回完整路径
    """
    # 如果是相对路径，则相对于项目根目录
    if not os.path.isabs(file_path):
        file_path = PROJECT_ROOT / file_path
    else:
        file_path = Path(file_path)
    
    if not file_path.exists():
        raise FileNotFoundError(f'文件不存在: {file_path}')
    
    return file_path


def load_dataframe(file_path: str) -> pd.DataFrame:
    """
    加载 CSV 或 XLSX 文件到 DataFrame
    """
    try:
        path = validate_file_path(file_path)
        
        if path.suffix.lower() == '.csv':
            df = pd.read_csv(path)
        elif path.suffix.lower() == '.xlsx':
            df = pd.read_excel(path)
        else:
            raise ValueError(f'不支持的文件类型: {path.suffix}')
        
        logger.info(f'成功加载文件: {file_path}，行数: {len(df)}, 列数: {len(df.columns)}')
        return df
    except Exception as e:
        logger.error(f'加载文件失败: {str(e)}')
        raise


def save_dataframe(df: pd.DataFrame, filename: Optional[str] = None) -> str:
    """
    保存 DataFrame 到 CSV 文件，返回相对路径
    """
    try:
        if filename is None:
            filename = generate_unique_filename('.csv')
        
        file_path = TEMP_DIR / filename
        df.to_csv(file_path, index=False, encoding='utf-8')
        
        relative_path = get_relative_path(str(file_path))
        logger.info(f'成功保存文件: {relative_path}')
        return relative_path
    except Exception as e:
        logger.error(f'保存文件失败: {str(e)}')
        raise


def get_dataframe_preview(df: pd.DataFrame, rows: int = 5) -> Dict[str, Any]:
    """
    获取预览信息，并确保所有数据都能被 JSON 正常序列化
    """
    total_rows = int(len(df))
    total_cols = int(len(df.columns))
    preview_data = df.head(rows).replace({np.nan: None}).to_dict('records')
    missing_dict = {str(k): int(v) for k, v in df.isnull().sum().to_dict().items()}

    return {
        'shape': {'rows': total_rows, 'cols': total_cols},
        'columns': df.columns.tolist(),
        'dtypes': df.dtypes.astype(str).to_dict(),
        'preview': preview_data,
        'missing_values': missing_dict
    }

def to_python_value(value: Any) -> Any:
    """把 numpy/pandas 类型转成标准 Python 类型，避免 JSON 序列化报错。"""
    if isinstance(value, np.generic):
        return value.item()
    if isinstance(value, (list, tuple)):
        return [to_python_value(v) for v in value]
    if isinstance(value, dict):
        return {k: to_python_value(v) for k, v in value.items()}
    return value

#========================= 大模型对话 =====================
chat_history = [
    {"role": "system", "content": "你是aimake平台自主研发的AI助手。简洁回答，不要使用代码块等md格式。不要脱离人工智能/编程/数学的话题"}
]


# AI 对话接口
@app.post('/process/ai_chat')
async def ai_chat(req: AiChatRequest):
    global chat_history
    try:
        # 如果前端发了清空指令
        if req.clear_history:
            chat_history = [{"role": "system", "content": "你是由用户自主研发的AI助手。"}]
            return {"status": "success", "response": "已清空对话历史"}

        # 获取用户消息
        user_msg = req.message
        if req.context:
            # 如果有上下文（比如当前正在看的 Excel 路径），带给 AI
            user_msg = f"当前上下文：{req.context}\n\n用户问题：{user_msg}"

        # 记录用户说的话
        chat_history.append({"role": "user", "content": user_msg})

        # 调用火山引擎 Ark
        from volcenginesdkarkruntime import Ark
        client = Ark(api_key=VOLC_API_KEY)

        response = client.chat.completions.create(
            model=VOLC_MODEL,
            messages=chat_history
        )

        # 提取并清洗回答
        ai_response = response.choices[0].message.content.strip()

        # 记录 AI 说的话，实现连续对话
        chat_history.append({"role": "assistant", "content": ai_response})

        # 保持历史长度，防止爆 Token
        if len(chat_history) > 10:
            chat_history = [chat_history[0]] + chat_history[-9:]

        return {
            "status": "success",
            "response": ai_response
        }

    except Exception as e:
        import traceback
        print(traceback.format_exc())
        return {"status": "error", "response": f"AI 暂时开小差了: {str(e)}"}

# ===================== 接口 2: 生成 CSV 数据 =====================
@app.post('/process/generate')
async def generate_data(req: GenerateRequest):
    prompt = req.prompt
    row_count = int(req.row_count or 20)
    row_count = max(20, min(100, row_count))
    custom_headers = [str(h).strip() for h in (req.custom_headers or []) if str(h).strip()]
    custom_headers = list(dict.fromkeys(custom_headers))
    if len(custom_headers) > 6:
        raise HTTPException(status_code=400, detail='custom_headers 最多允许 6 个')
    try:
        if not VOLC_API_KEY:
            raise ValueError('未设置 api_key 环境变量')

        # 构建提示词
        header_rule = ""
        if custom_headers:
            header_rule = f"6. 严格使用以下表头且顺序一致: {', '.join(custom_headers)}，不要新增、删除或改名\n"

        full_prompt = f"""请生成一个包含表头的 CSV 数据集，要求如下：
用户需求: {prompt}

行数: {row_count}



**重要要求:**
1. 返回必须是纯 CSV 格式（用逗号分隔）
2. 第一行必须是列名（表头）
3. 不要包含任何其他文字、md格式符、解释或代码块
4. 确保数据一致性和真实性
5. 列名用英文，用下划线连接（如 user_id, product_name）
{header_rule}请直接输出 CSV 内容:

"""

        # 初始化客户端
        from volcenginesdkarkruntime import Ark
        client = Ark(api_key=VOLC_API_KEY)

        # 对话消息
        messages = [
            {"role": "user", "content": full_prompt}
        ]

        # 调用模型
        response = client.chat.completions.create(
            model=VOLC_MODEL,
            messages=messages,
            max_tokens=8000
        )

        # 解析返回
        if not response or not response.choices:
            raise ValueError('大模型返回异常响应')

        csv_content = response.choices[0].message.content.strip()
        # 移除可能的 markdown 包裹
        if csv_content.startswith('```'):
            lines = csv_content.split('\n')
            if len(lines) > 1:
                csv_content = '\n'.join(lines[1:])
        if csv_content.endswith('```'):
            csv_content = csv_content.rsplit('```', 1)[0]

        csv_content = csv_content.strip()

        # 解析为 DataFrame
        import pandas as pd
        import io

        df = pd.read_csv(io.StringIO(csv_content))

        if df.empty:
            raise ValueError('生成的数据内容为空，无法解析为表格')

        # 保存文件
        file_path = save_dataframe(df)

        # 返回预览
        full_preview = df.to_dict('records')
        return {
            'status': 'success',
            'file_path': file_path,
            'model': VOLC_MODEL,
            'columns': df.columns.tolist(),
            'preview': full_preview,
            'preview_info': get_dataframe_preview(df, rows=min(100, len(df))),
            'total_rows': len(df),
            'raw_response': csv_content[:500] + '...' if len(csv_content) > 500 else csv_content
        }

    except Exception as e:
        logger.error(f'生成数据失败: {str(e)}\n{traceback.format_exc()}')
        return JSONResponse(
            content={
                'error': '生成数据失败',
                'details': str(e)
            }
        )


# ===================== 接口 3: 数据清洗=====================
@app.post('/process/clean')
async def clean_data(request: CleanRequest):
    file_path = request.file_path
    drop_columns = request.drop_columns
    remove_null_rows = request.remove_null_rows
    fill_missing = request.fill_missing
    remove_outliers = request.remove_outliers
    outlier_mode = (request.outlier_mode or 'none').lower().strip()
    outlier_std_threshold = request.outlier_std_threshold
    """
    读取数据文件，执行数据清洗操作（删除缺失值 + 数值列 3σ 异常值过滤）
    
    参数:
    - file_path: 输入文件的相对路径
    - drop_columns: 可选，要删除的列名列表
    
    返回:
    - cleaned_file_path: 清洗后文件的相对路径
    - preview: 清洗后数据的预览（行数据）
    - statistics: 清洗前后的对比统计
    """
    try:
        # 加载数据
        df = load_dataframe(file_path)
        original_rows = len(df)
        original_nulls = df.isnull().sum().sum()
        
        # 删除指定的列
        if drop_columns:
            df = df.drop(columns=[col for col in drop_columns if col in df.columns])
        
       # 删除重复行（整行重复）
        rows_removed_by_duplicate = 0
        rows_standardized = 0
        remove_duplicates = getattr(request, 'remove_duplicates', False)
        if remove_duplicates:
            before_dup = len(df)
            df = df.drop_duplicates()
            rows_removed_by_duplicate = before_dup - len(df)
        
        # 规范化非规范值
        standardize_values = getattr(request, 'standardize_values', False)
        if standardize_values:
            for col in df.columns:
                if df[col].dtype == 'object':
                    # 修复逗号分隔的数字（如 1,000 → 1000）
                    df[col] = df[col].astype(str).str.replace(r'^(\d{1,3})(,(\d{3}))+$', lambda m: m.group(0).replace(',', ''), regex=True)
                    # 前后空格去除
                    df[col] = df[col].astype(str).str.strip()
            rows_standardized = 1  # 标记已执行
        
        # 空值处理：删行或填充
        null_rows_removed = 0
        numeric_columns = df.select_dtypes(include=[np.number]).columns.tolist()
        object_columns = [col for col in df.columns if col not in numeric_columns]

        if remove_null_rows:
            before_dropna_rows = len(df)
            df = df.dropna()
            null_rows_removed = int(before_dropna_rows - len(df))
            # 删除行后重新识别列类型
            numeric_columns = df.select_dtypes(include=[np.number]).columns.tolist()
            object_columns = [col for col in df.columns if col not in numeric_columns]
        elif fill_missing:
            # 数值列用中位数，文本列用众数
            for col in numeric_columns:
                median_val = df[col].median()
                if pd.isna(median_val):
                    median_val = 0
                df[col] = df[col].fillna(median_val)

            for col in object_columns:
                mode_series = df[col].mode(dropna=True)
                fill_val = mode_series.iloc[0] if not mode_series.empty else ''
                df[col] = df[col].fillna(fill_val)

        # 兼容旧参数
        if outlier_mode not in {'none', 'clip', 'remove'}:
            outlier_mode = 'none'
        if remove_outliers and outlier_mode == 'none':
            outlier_mode = 'remove'

        # 异常值处理：clip 截断，remove 删行
        outlier_rows_removed = 0
        outlier_cells_capped = 0
        numeric_columns_checked: List[str] = []
        if outlier_mode in {'clip', 'remove'}:
            if outlier_std_threshold <= 0:
                raise ValueError('outlier_std_threshold 必须大于 0')

            numeric_columns_checked = numeric_columns

            if numeric_columns:
                if outlier_mode == 'clip':
                    for col in numeric_columns:
                        mean_val = df[col].mean()
                        std_val = df[col].std()

                        # 标准差为 0 或无效时，跳过该列过滤
                        if pd.isna(std_val) or std_val == 0:
                            continue

                        lower = mean_val - outlier_std_threshold * std_val
                        upper = mean_val + outlier_std_threshold * std_val
                        before_clip = df[col].copy()
                        df[col] = df[col].clip(lower=lower, upper=upper)
                        outlier_cells_capped += int((before_clip != df[col]).sum())

                        # 3sigma 无命中时，回退 IQR
                        if int((before_clip != df[col]).sum()) == 0:
                            q1 = df[col].quantile(0.25)
                            q3 = df[col].quantile(0.75)
                            iqr = q3 - q1
                            if not pd.isna(iqr) and iqr > 0:
                                iqr_k = max(0.5, outlier_std_threshold / 2.0)
                                iqr_lower = q1 - iqr_k * iqr
                                iqr_upper = q3 + iqr_k * iqr
                                before_iqr_clip = df[col].copy()
                                df[col] = df[col].clip(lower=iqr_lower, upper=iqr_upper)
                                outlier_cells_capped += int((before_iqr_clip != df[col]).sum())
                else:
                    keep_mask = pd.Series(True, index=df.index)
                    for col in numeric_columns:
                        mean_val = df[col].mean()
                        std_val = df[col].std()

                        if pd.isna(std_val) or std_val == 0:
                            continue

                        lower = mean_val - outlier_std_threshold * std_val
                        upper = mean_val + outlier_std_threshold * std_val
                        keep_mask &= df[col].between(lower, upper, inclusive='both')

                    before_outlier_rows = len(df)
                    df = df.loc[keep_mask]
                    outlier_rows_removed = int(before_outlier_rows - len(df))

                    # 3sigma 无命中时，回退 IQR
                    if outlier_rows_removed == 0 and len(df) > 0:
                        iqr_keep_mask = pd.Series(True, index=df.index)
                        iqr_k = max(0.5, outlier_std_threshold / 2.0)
                        for col in numeric_columns:
                            q1 = df[col].quantile(0.25)
                            q3 = df[col].quantile(0.75)
                            iqr = q3 - q1
                            if pd.isna(iqr) or iqr <= 0:
                                continue
                            iqr_lower = q1 - iqr_k * iqr
                            iqr_upper = q3 + iqr_k * iqr
                            iqr_keep_mask &= df[col].between(iqr_lower, iqr_upper, inclusive='both')

                        before_iqr_rows = len(df)
                        df = df.loc[iqr_keep_mask]
                        outlier_rows_removed += int(before_iqr_rows - len(df))
        
        cleaned_rows = len(df)
        cleaned_nulls = df.isnull().sum().sum()
        cleaned_path = save_dataframe(df)
        preview_info = get_dataframe_preview(df,rows=min(len(df), 1000))

        return {
            'status': 'success',
            'cleaned_file_path': cleaned_path,
            'columns': preview_info.get('columns', []),
            'preview': preview_info.get('preview', []),
            'total_rows': cleaned_rows,
            'preview_info': preview_info,
            'statistics': {
                'original_rows': int(original_rows),
                'cleaned_rows': int(cleaned_rows),
                'rows_removed': int(original_rows - cleaned_rows),
                'rows_removed_by_null': null_rows_removed,
                'rows_removed_by_outlier': outlier_rows_removed,
                'rows_removed_by_duplicate': int(rows_removed_by_duplicate),
                'rows_standardized': int(rows_standardized),
                'outlier_cells_capped': int(outlier_cells_capped),
                'original_null_count': int(original_nulls),
                'cleaned_null_count': int(cleaned_nulls),
                'columns_removed': drop_columns if drop_columns else [],
                'remove_null_rows': bool(remove_null_rows),
                'fill_missing': bool(fill_missing),
                'remove_outliers': bool(remove_outliers),
                'outlier_mode': outlier_mode,
                'outlier_std_threshold': float(outlier_std_threshold),
                'numeric_columns_checked': numeric_columns_checked
            }
        }
    
    except Exception as e:
        logger.error(f'数据清洗失败: {str(e)}\n{traceback.format_exc()}')
        return JSONResponse(
            status_code=500,
            content={
                'error': '数据清洗失败',
                'details': str(e)
            }
        )


# 接口 4: 特征工程
@app.post('/process/features')
async def feature_engineering(req: FeatureRequest):
    try:
        df = load_dataframe(req.file_path)

        # 调试：前端传入的分类列
        print(f"📢 前端请求编码的列: {req.categorical_features}")
        # 调试：当前列类型
        print(f"📊 编码前的列类型:\n{df.dtypes}")

        # 仅处理用户指定且存在的列
        cat_cols = [c for c in req.categorical_features if c in df.columns]

        if not cat_cols:
            return {"status": "success", "message": "跳过编码", "feature_file_path": req.file_path}

        # 找出那些不在编码名单里的数值列
        other_cols = [c for c in df.columns if c not in cat_cols]
        df_others = df[other_cols].copy()

        # 只对指定的列进行独热编码
        df_cat = pd.get_dummies(df[cat_cols], dtype=int)

        # 拼回去：[数值列] + [编码后的 01 列]
        df_final = pd.concat([df_others, df_cat], axis=1)
        print(f"🚀 处理后的总列数: {len(df_final.columns)}")

        feature_path = save_dataframe(df_final)

        return {
            'status': 'success',
            'feature_file_path': feature_path,
            'preview': get_dataframe_preview(df_final,rows=min(len(df_final), 1000)),
            'total_rows': int(len(df_final))
        }
    except Exception as e:
        import traceback
        print(traceback.format_exc())
        return JSONResponse(status_code=500, content={'error': str(e)})

# 接口 5: 数据划分
@app.post('/process/split')
async def split_data(req: SplitRequest):
    try:
        df = load_dataframe(req.file_path)
        train_df, test_df = train_test_split(df, test_size=req.test_size, random_state=req.random_state)
        train_path = save_dataframe(train_df, f'train_{datetime.now().strftime("%Y%m%d")}.csv')
        test_path = save_dataframe(test_df, f'test_{datetime.now().strftime("%Y%m%d")}.csv')
        return {
            'status': 'success',
            'train_file_path': train_path,
            'test_file_path': test_path
        }
    except Exception as e:
        return JSONResponse(status_code=500, content={'error': str(e)})

# 接口 6: 模型训练
@app.post('/model/train_manual')
async def train_model(req: TrainRequest):
    try:
        df = load_dataframe(req.file_path)
        if req.target_column not in df.columns:
            raise ValueError(f"找不到目标列: {req.target_column}")

        # 特征统一做哑变量，避免字符串列导致训练报错
        x_data = df.drop(columns=[req.target_column])
        x_data = pd.get_dummies(x_data, dummy_na=True)
        x_data = x_data.apply(pd.to_numeric, errors='coerce').fillna(0)
        train_cols = x_data.columns.tolist()
        if not train_cols:
            raise ValueError('没有可用于训练的特征列，请先做特征工程')

        y_raw = df[req.target_column]
        model_type = (req.model_type or '').lower()

        # 自动判定任务类型，避免把连续值交给分类器
        y_numeric = pd.to_numeric(y_raw, errors='coerce')
        non_null_numeric = y_numeric.dropna()
        unique_count = int(non_null_numeric.nunique())
        unique_ratio = (unique_count / len(non_null_numeric)) if len(non_null_numeric) else 0

        if model_type == 'logistic_regression':
            task_type = 'classification'
        elif not pd.api.types.is_numeric_dtype(y_raw):
            task_type = 'classification'
        else:
            # 数值目标高基数时按回归；低基数(如0/1、1/2/3)按分类
            task_type = 'regression' if (unique_count > 15 and unique_ratio > 0.2) else 'classification'

        if task_type == 'classification':
            y_class = y_raw.astype(str).replace('nan', np.nan)
            valid_mask = y_class.notna()
            x_data = x_data.loc[valid_mask].reset_index(drop=True)
            y_class = y_class.loc[valid_mask].reset_index(drop=True)
            label_encoder = LabelEncoder()
            y_encoded = label_encoder.fit_transform(y_class)
        else:
            valid_mask = y_numeric.notna()
            x_data = x_data.loc[valid_mask].reset_index(drop=True)
            y_encoded = y_numeric.loc[valid_mask].astype(float).reset_index(drop=True)
            label_encoder = None

        if len(x_data) < 5 or len(y_encoded) < 5:
            raise ValueError('可用于训练的数据太少（至少需要 5 行有效数据）')

        x_train, x_test, y_train, y_test = train_test_split(
            x_data,
            y_encoded,
            test_size=0.2,
            random_state=42
        )

        if task_type == 'classification':
            if model_type == 'random_forest':
                model = RandomForestClassifier(n_estimators=100, random_state=42)
            elif model_type == 'knn':
                model = KNeighborsClassifier(n_neighbors=5)
            elif model_type == 'logistic_regression':
                model = LogisticRegression(random_state=42, max_iter=1000)
            else:
                raise ValueError(f'不支持的分类模型类型: {req.model_type}')
        else:
            if model_type == 'random_forest':
                model = RandomForestRegressor(n_estimators=120, random_state=42)
            elif model_type == 'knn':
                model = KNeighborsRegressor(n_neighbors=5)
            elif model_type == 'logistic_regression':
                raise ValueError('logistic_regression 仅支持分类任务，回归请使用 random_forest 或 knn')
            else:
                raise ValueError(f'不支持的回归模型类型: {req.model_type}')

        model.fit(x_train, y_train)

        train_accuracy = float(model.score(x_train, y_train))
        test_accuracy = float(model.score(x_test, y_test))

        model_filename = f"model_{model_type}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.joblib"
        model_path = MODELS_DIR / model_filename
        model_package = {
            'model': model,
            'train_cols': train_cols,
            'label_encoder': label_encoder,
            'model_type': model_type,
            'task_type': task_type,
            'target_column': req.target_column
        }
        joblib.dump(model_package, model_path)

        return {
            'status': 'success',
            'model_path': get_relative_path(str(model_path)),
            'model_type': model_type,
            'task_type': task_type,
            'target_column': req.target_column,
            'accuracy': {
                'train': round(train_accuracy, 4),
                'test': round(test_accuracy, 4)
            },
            'train_cols': train_cols,
            'label_encoder_classes': label_encoder.classes_.tolist() if label_encoder else None
        }
    except Exception as e:
        logger.error(f'模型训练失败: {str(e)}\n{traceback.format_exc()}')
        return JSONResponse(status_code=500, content={'error': '模型训练失败', 'details': str(e)})


@app.post('/model/evaluate')
async def evaluate_model(req: EvaluateRequest):
    """在测试集上评估模型表现，兼容分类与回归任务。"""
    try:
        model_path_full = validate_file_path(req.model_path)
        model_package = joblib.load(model_path_full)

        model = model_package['model']
        train_cols = model_package.get('train_cols', [])
        label_encoder = model_package.get('label_encoder')
        task_type = model_package.get('task_type', 'classification' if label_encoder is not None else 'regression')

        test_df = load_dataframe(req.test_file_path)
        if req.target_column not in test_df.columns:
            raise ValueError(f"目标列 '{req.target_column}' 不存在于测试文件")

        x_raw = test_df.drop(columns=[req.target_column])
        x_data = pd.get_dummies(x_raw, dummy_na=True)
        x_data = x_data.apply(pd.to_numeric, errors='coerce').fillna(0)
        x_aligned = x_data.reindex(columns=train_cols, fill_value=0)

        sample_predictions: List[Dict[str, Any]] = []

        if task_type == 'classification':
            y_text = test_df[req.target_column].astype(str).replace('nan', np.nan)
            valid_mask = y_text.notna()
            x_eval = x_aligned.loc[valid_mask].reset_index(drop=True)
            y_eval_text = y_text.loc[valid_mask].reset_index(drop=True)

            if len(x_eval) == 0:
                raise ValueError('测试集中没有可用于评估的有效标签')

            dropped_unknown_labels = 0
            if label_encoder is not None:
                known_labels = set(label_encoder.classes_.tolist())
                known_mask = y_eval_text.isin(known_labels)
                dropped_unknown_labels = int((~known_mask).sum())
                x_eval = x_eval.loc[known_mask].reset_index(drop=True)
                y_eval_text = y_eval_text.loc[known_mask].reset_index(drop=True)

                if len(x_eval) == 0:
                    raise ValueError('测试集标签与训练标签不匹配，无法评估')

                y_true_encoded = label_encoder.transform(y_eval_text)
                y_pred_encoded = model.predict(x_eval)
                accuracy = float(np.mean(y_pred_encoded == y_true_encoded))

                y_true_display = y_eval_text.tolist()
                y_pred_display = label_encoder.inverse_transform(y_pred_encoded).tolist()
            else:
                y_true_display = y_eval_text.tolist()
                y_pred_display = [to_python_value(v) for v in model.predict(x_eval).tolist()]
                accuracy = float(np.mean(np.array(y_true_display) == np.array(y_pred_display)))

            for actual, predicted in list(zip(y_true_display, y_pred_display))[:10]:
                sample_predictions.append({
                    'actual': to_python_value(actual),
                    'predicted': to_python_value(predicted),
                    'correct': bool(actual == predicted)
                })

            payload = {
                'status': 'success',
                'task_type': 'classification',
                'accuracy': float(accuracy),
                'total_samples': int(len(y_true_display)),
                'sample_predictions': sample_predictions,
                'dropped_unknown_labels': int(dropped_unknown_labels)
            }
        else:
            from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

            y_numeric = pd.to_numeric(test_df[req.target_column], errors='coerce')
            valid_mask = y_numeric.notna()
            x_eval = x_aligned.loc[valid_mask].reset_index(drop=True)
            y_true = y_numeric.loc[valid_mask].astype(float).reset_index(drop=True)

            if len(x_eval) == 0:
                raise ValueError('测试集中没有可用于评估的有效数值标签')

            y_pred = model.predict(x_eval)
            mse = float(mean_squared_error(y_true, y_pred))
            rmse = float(np.sqrt(mse))
            mae = float(mean_absolute_error(y_true, y_pred))
            r2 = float(r2_score(y_true, y_pred))

            for actual, predicted in list(zip(y_true.tolist(), y_pred.tolist()))[:10]:
                sample_predictions.append({
                    'actual': to_python_value(actual),
                    'predicted': to_python_value(predicted),
                    'error': float(predicted - actual)
                })

            payload = {
                'status': 'success',
                'task_type': 'regression',
                'accuracy': r2,
                'total_samples': int(len(y_true)),
                'metrics': {
                    'r2': r2,
                    'mae': mae,
                    'mse': mse,
                    'rmse': rmse
                },
                'sample_predictions': sample_predictions
            }

        return to_python_value(payload)
    except Exception as e:
        logger.error(f'模型评估失败: {str(e)}\n{traceback.format_exc()}')
        return JSONResponse(status_code=500, content={'error': '模型评估失败', 'details': str(e)})
# 接口: 手动/文件预测
@app.post('/model/predict_manual')
async def predict_manual(req: PredictRequest):
    try:
        model_path_full = validate_file_path(req.model_path)
        model_package = joblib.load(model_path_full)

        model = model_package['model']
        train_cols = model_package['train_cols']
        label_encoder = model_package.get('label_encoder')

        if req.manual_features is not None:
            data_df = pd.DataFrame([req.manual_features])
        elif req.data_file_path:
            data_df = load_dataframe(req.data_file_path)
        else:
            raise ValueError('data_file_path 和 manual_features 至少提供一个')

        result_df = data_df.copy()
        x_data = pd.get_dummies(data_df, dummy_na=True)
        x_data = x_data.apply(pd.to_numeric, errors='coerce').fillna(0)
        x_aligned = x_data.reindex(columns=train_cols, fill_value=0)

        train_col_set = set(train_cols)
        input_col_set = set(x_data.columns.tolist())
        matched_features = sorted(list(train_col_set & input_col_set))
        missing_features = sorted(list(train_col_set - input_col_set))
        unexpected_features = sorted(list(input_col_set - train_col_set))

        if req.manual_features is not None and len(matched_features) == 0:
            raise ValueError('手动输入的特征与模型训练特征完全不匹配，请使用训练返回的 train_cols 作为键名模板')

        predictions = model.predict(x_aligned)
        if label_encoder is not None:
            predictions = label_encoder.inverse_transform(predictions)

        result_df['prediction'] = predictions
        prediction_file_path = save_dataframe(result_df)

        sample_predictions = [
            {'prediction': to_python_value(v)}
            for v in result_df['prediction'].head(10).tolist()
        ]

        unique_predictions = [to_python_value(v) for v in result_df['prediction'].unique().tolist()]

        return {
            'status': 'success',
            'total_predictions': int(len(result_df)),
            'prediction_file_path': prediction_file_path,
            'sample_predictions': sample_predictions,
            'unique_predictions': unique_predictions,
            'feature_alignment': {
                'matched_count': int(len(matched_features)),
                'train_feature_count': int(len(train_cols)),
                'missing_count': int(len(missing_features)),
                'unexpected_count': int(len(unexpected_features)),
                'matched_features': matched_features[:20],
                'missing_features_preview': missing_features[:20],
                'unexpected_features_preview': unexpected_features[:20]
            }
        }
    except Exception as e:
        logger.error(f'模型预测失败: {str(e)}\n{traceback.format_exc()}')
        return JSONResponse(status_code=500, content={'error': '模型预测失败', 'details': str(e)})


# 接口：生成有监督学习预测可视化
class VisualizePredictionsRequest(BaseModel):
    model_path: str
    test_file_path: str
    target_column: str


# 接口：生成有监督学习预测可视化
@app.post('/model/visualize_predictions')
async def visualize_predictions(req: VisualizePredictionsRequest):
    """
    生成模型预测效果的可视化（实际值 vs 预测值）
    """
    try:
        model_path_full = validate_file_path(req.model_path)
        model_package = joblib.load(model_path_full)
        
        model = model_package['model']
        train_cols = model_package['train_cols']
        label_encoder = model_package.get('label_encoder')
        
        # 加载测试数据
        test_df = load_dataframe(req.test_file_path)
        if req.target_column not in test_df.columns:
            raise ValueError(f"目标列 '{req.target_column}' 不存在于测试集")
        
        # 提取特征并按训练列对齐，避免列缺失导致 KeyError
        x_raw = test_df.drop(columns=[req.target_column])
        x_data = pd.get_dummies(x_raw, dummy_na=True)
        x_data = x_data.apply(pd.to_numeric, errors='coerce').fillna(0)
        x_test_aligned = x_data.reindex(columns=train_cols, fill_value=0)
        y_true = test_df[req.target_column]
        
        # 进行预测
        y_pred = model.predict(x_test_aligned)
        
        # 如果是分类问题，反转编码
        task_type = 'classification' if label_encoder is not None else 'regression'
        
        if label_encoder is not None:
            y_true_text = y_true.astype(str)
            known_labels = set(label_encoder.classes_.tolist())
            known_mask = y_true_text.isin(known_labels)
            if int(known_mask.sum()) == 0:
                raise ValueError('测试集标签与训练标签不匹配，无法生成分类可视化')

            y_true_encoded = label_encoder.transform(y_true_text.loc[known_mask])
            y_pred = y_pred[known_mask.values]
            y_true_plot = y_true_encoded
            y_pred_plot = y_pred
        else:
            y_true_numeric = pd.to_numeric(y_true, errors='coerce')
            valid_mask = y_true_numeric.notna()
            if int(valid_mask.sum()) == 0:
                raise ValueError('测试集没有可用于可视化的有效数值标签')
            y_true_plot = y_true_numeric.loc[valid_mask].astype(float).values
            y_pred_plot = y_pred[valid_mask.values]
        
        # 生成可视化图像
        image_base64 = generate_regression_image_base64(
            y_true_plot,
            y_pred_plot,
            task_type=task_type
        )
        
        return {
            'status': 'success',
            'visualization_image': image_base64,
            'task_type': task_type,
            'metrics': {
                'total_samples': int(len(test_df)),
                'predictions_generated': int(len(y_pred_plot))
            }
        }
    except Exception as e:
        logger.error(f'生成预测可视化失败: {str(e)}\n{traceback.format_exc()}')
        return JSONResponse(status_code=500, content={'error': '生成可视化失败', 'details': str(e)})


# ===================== 健康检查端点 =====================
@app.get('/health')
async def health_check():
    """
    系统健康检查端点
    """
    return {
        'status': 'healthy',
        'timestamp': datetime.now().isoformat(),
        'project_root': str(PROJECT_ROOT),
        'temp_dir': str(TEMP_DIR),
        'models_dir': str(MODELS_DIR),
        'temp_dir_exists': TEMP_DIR.exists(),
        'models_dir_exists': MODELS_DIR.exists()
    }


class ClusterRequest(BaseModel):
    file_path: str
    n_clusters: int = 3
    features: List[str] = None  # 用户选中的参与聚类的列


# 聚类训练与可视化
@app.post('/clustering/train_and_visualize')
async def train_and_visualize_clusters(req: ClusterRequest):
    try:
        df = load_dataframe(req.file_path)

        # 仅使用数值列
        X_numeric = df.select_dtypes(include=[np.number])

        if req.features:
            # 取用户选中且为数值的列
            cols = [c for c in req.features if c in X_numeric.columns]
            X = X_numeric[cols]
        else:
            X = X_numeric

        if X.empty:
            raise ValueError("没有可用的数值特征进行聚类")

        # 标准化
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)

        # 训练 K-Means
        kmeans = KMeans(n_clusters=req.n_clusters, random_state=42, n_init=10)
        clusters = kmeans.fit_transform(X_scaled)
        labels = kmeans.labels_

        # PCA 降到 2 维
        pca = PCA(n_components=2)
        X_pca = pca.fit_transform(X_scaled)

        # 生成可视化图像
        cluster_image_base64 = generate_cluster_image_base64(X_pca, labels, req.n_clusters)

        # 组装返回
        plot_data = []
        for i in range(len(df)):
            plot_data.append({
                'x': float(X_pca[i][0]),
                'y': float(X_pca[i][1]),
                'label': int(labels[i]),
                # 带部分原始信息，便于前端展示
                'info': df.iloc[i].head(3).to_dict()
            })

        return {
            'status': 'success',
            'clusters': [int(l) for l in labels],
            'plot_data': plot_data,
            'cluster_image_base64': cluster_image_base64,
            'statistics': {
                'n_samples': len(df),
                'n_features': X.shape[1],
                'inertia': float(kmeans.inertia_)
            }
        }

    except Exception as e:
        import traceback
        logger.error(f"聚类失败: {str(e)}\n{traceback.format_exc()}")
        return JSONResponse(status_code=500, content={'error': str(e)})


class VisualizeRequest(BaseModel):
    file_path: str
    features: List[str] = None
    cluster_labels: List[int] = None  # 可选：前端传入标签


# 聚类结果可视化
@app.post('/clustering/visualize')
async def visualize_clusters(req: VisualizeRequest):
    try:
        df = load_dataframe(req.file_path)

        # 强制只提取数字列进行降维
        X_numeric = df.select_dtypes(include=[np.number])

        if req.features:
            X = X_numeric[[c for c in req.features if c in X_numeric.columns]]
        else:
            X = X_numeric

        if X.empty:
            raise ValueError("没有足够的数值特征进行可视化")

        # 数据标准化
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)

        # 使用 PCA 将数据降维到 2D 坐标
        pca = PCA(n_components=2)
        X_pca = pca.fit_transform(X_scaled)

        # 组装绘图数据
        plot_data = []
        # 请求没带标签时默认 0
        labels = req.cluster_labels if req.cluster_labels else [0] * len(df)

        for i in range(len(df)):
            plot_data.append({
                'x': float(X_pca[i][0]),
                'y': float(X_pca[i][1]),
                'label': int(labels[i]),
                'info': {
                    '名称': str(df.iloc[i].get('公司名称', '未知')),
                    '行业': str(df.iloc[i].get('行业', '未知'))
                }
            })

        # 生成降维可视化图像
        n_clusters = len(set(labels)) if labels else 1
        visualize_image_base64 = generate_cluster_image_base64(X_pca, np.array(labels), n_clusters)

        return {
            'status': 'success',
            'plot_data': plot_data,
            'plot_base64': visualize_image_base64,
            'pca_info': {
                'explained_variance': [float(v) for v in pca.explained_variance_ratio_]
            }
        }

    except Exception as e:
        import traceback
        logger.error(f"可视化生成失败: {str(e)}\n{traceback.format_exc()}")
        return JSONResponse(status_code=500, content={'error': str(e)})

# ===================== 新增端点：数据质量检测 =====================
class DataQualityCheckRequest(BaseModel):
    file_path: str


@app.post('/process/check-data-quality')
async def check_data_quality(req: DataQualityCheckRequest):
    """
    检测数据质量问题：重复值、非规范值等
    用于前端显示给用户选择
    """
    try:
        df = load_dataframe(req.file_path)
        
        # 检测重复行
        duplicate_info = detect_duplicate_rows(df)
        
        # 检测非规范值
        non_standard_info = detect_non_standard_values(df)
        
        payload = {
            'status': 'success',
            'file_path': req.file_path,
            'total_rows': len(df),
            'duplicates': duplicate_info,
            'non_standard_values': non_standard_info,
            'quality_issues': {
                'has_issues': duplicate_info['has_duplicates'] or non_standard_info['has_non_standard'],
                'issue_count': duplicate_info['duplicate_rows'] + non_standard_info['problematic_cells'],
                'issue_percentage': round(
                    (duplicate_info['duplicate_rows'] + non_standard_info['problematic_cells']) / len(df) * 100, 2
                ) if len(df) > 0 else 0
            }
        }
        return to_python_value(payload)
    except Exception as e:
        logger.error(f'数据质量检测失败: {str(e)}\n{traceback.format_exc()}')
        return JSONResponse(status_code=500, content={'error': '质量检测失败', 'details': str(e)})


class OutlierCalculateRequest(BaseModel):
    file_path: str
    std_threshold: float = 3.0


@app.post('/process/calculate-outliers')
async def calculate_outliers(req: OutlierCalculateRequest):
    """
    根据标准差阈值，计算会被检测到的异常值个数
    用于前端实时显示异常值统计
    """
    try:
        df = load_dataframe(req.file_path)
        result = calculate_outlier_count(df, req.std_threshold)
        
        return {
            'status': 'success',
            'std_threshold': req.std_threshold,
            'outlier_count': result['outlier_count'],
            'outlier_percentage': round(result['outlier_count'] / len(df) * 100, 2) if len(df) > 0 else 0,
            'numeric_columns': result['numeric_columns'],
            'total_rows': len(df)
        }
    except Exception as e:
        logger.error(f'异常值计算失败: {str(e)}\n{traceback.format_exc()}')
        return JSONResponse(status_code=500, content={'error': '计算失败', 'details': str(e)})


# ===================== 根路由 =====================
@app.get('/')
async def root():
    """
    API 文档入口
    """
    return {
        'title': 'AImake - 机器学习后端服务',
        'version': '1.0.0',
        'description': '数据处理、模型训练、聚类分析和大模型对话服务',
        'docs_url': '/docs',
        'endpoints': {
            '健康检查': 'GET /health',
            '大模型连通性': 'POST /process/check_llm_connection',
            '数据生成': 'POST /process/generate',
            '数据清洗': 'POST /process/clean',
            '数据质量检测': 'POST /process/check-data-quality',
            '异常值计算': 'POST /process/calculate-outliers',
            '特征工程': 'POST /process/features',
            '数据划分': 'POST /process/split',
            '模型训练': 'POST /model/train_manual',
            '模型评估': 'POST /model/evaluate',
            '模型预测': 'POST /model/predict_manual',
            '聚类分析': 'POST /clustering/train_and_visualize',
            '大模型对话': 'POST /process/ai_chat'
        }
    }


# ===================== 数据质量检测工具函数 =====================
def detect_duplicate_rows(df: pd.DataFrame) -> Dict[str, Any]:
    """
    检测整行重复的情况
    返回：重复行数、重复比例、示例重复行
    """
    try:
        total_rows = len(df)
        duplicated_mask = df.duplicated(keep=False)
        duplicate_count = int(duplicated_mask.sum())
        duplicate_ratio = (duplicate_count / total_rows * 100) if total_rows > 0 else 0
        
        # 重复示例，最多 5 条
        duplicated_df = df[duplicated_mask]
        duplicate_examples = duplicated_df.drop_duplicates().head(5).values.tolist() if len(duplicated_df) > 0 else []
        
        return {
            'duplicate_rows': duplicate_count,
            'duplicate_ratio': round(duplicate_ratio, 2),
            'duplicate_examples': to_python_value(duplicate_examples),
            'has_duplicates': bool(duplicate_count > 0)
        }
    except Exception as e:
        logger.error(f"检测重复行失败: {str(e)}")
        return {
            'duplicate_rows': 0,
            'duplicate_ratio': 0,
            'duplicate_examples': [],
            'has_duplicates': False
        }


def detect_non_standard_values(df: pd.DataFrame) -> Dict[str, Any]:
    """
    检测字符串列中的常见格式问题
    """
    try:
        non_standard_patterns = {
            'comma_separated_numbers': r'^\d{1,3}(,\d{3})+$',
            'iso_date_with_dashes': r'^\d{4}-\d{2}-\d{2}$',
            'mixed_case': None,
            'leading_trailing_spaces': r'^\s+|\s+$'
        }
        
        non_standard_issues = {}
        total_cells = 0
        problematic_cells = 0
        
        for col in df.columns:
            if df[col].dtype == 'object':
                col_issues = {
                    'comma_numbers': 0,
                    'iso_dates': 0,
                    'leading_spaces': 0,
                    'mixed_case': 0,
                    'examples': []
                }
                
                for value in df[col].dropna().astype(str):
                    total_cells += 1
                    
                    # 1,000 这类写法
                    if re.match(non_standard_patterns['comma_separated_numbers'], value.strip()):
                        col_issues['comma_numbers'] += 1
                        problematic_cells += 1
                        if len(col_issues['examples']) < 3:
                            col_issues['examples'].append(value)
                    
                    # 2024-08-31 这类日期串
                    elif re.match(non_standard_patterns['iso_date_with_dashes'], value.strip()):
                        col_issues['iso_dates'] += 1
                        problematic_cells += 1
                        if len(col_issues['examples']) < 3:
                            col_issues['examples'].append(value)
                    
                    # 前后空格
                    elif re.search(non_standard_patterns['leading_trailing_spaces'], value):
                        col_issues['leading_spaces'] += 1
                        problematic_cells += 1
                        if len(col_issues['examples']) < 3:
                            col_issues['examples'].append(f"[{value}]")
                
                if col_issues['comma_numbers'] + col_issues['iso_dates'] + col_issues['leading_spaces'] > 0:
                    non_standard_issues[col] = col_issues
        
        return {
            'has_non_standard': bool(len(non_standard_issues) > 0),
            'problematic_cells': int(problematic_cells),
            'total_cells': int(total_cells),
            'problematic_ratio': round(problematic_cells / total_cells * 100, 2) if total_cells > 0 else 0,
            'issues_by_column': to_python_value(non_standard_issues)
        }
    except Exception as e:
        logger.error(f"检测非规范值失败: {str(e)}")
        return {
            'has_non_standard': False,
            'problematic_cells': 0,
            'total_cells': 0,
            'problematic_ratio': 0,
            'issues_by_column': {}
        }


def calculate_outlier_count(df: pd.DataFrame, std_threshold: float) -> Dict[str, int]:
    """
    计算在指定标准差阈值下会被检测到的异常值个数
    用于实时更新前端显示
    """
    try:
        numeric_columns = df.select_dtypes(include=[np.number]).columns.tolist()
        outlier_count = 0
        
        for col in numeric_columns:
            mean_val = df[col].mean()
            std_val = df[col].std()
            
            if pd.isna(std_val) or std_val == 0:
                continue
            
            lower = mean_val - std_threshold * std_val
            upper = mean_val + std_threshold * std_val
            
            # 统计超出范围的值
            col_outliers = ((df[col] < lower) | (df[col] > upper)).sum()
            outlier_count += col_outliers
        
        return {
            'outlier_count': int(outlier_count),
            'numeric_columns': numeric_columns
        }
    except Exception as e:
        logger.error(f"计算异常值失败: {str(e)}")
        return {'outlier_count': 0, 'numeric_columns': []}


# ===================== 启动应用 =====================
if __name__ == '__main__':
    # 检查环境变量
    if not VOLC_API_KEY:
        logger.warning('⚠️  未设置 api_key 环境变量，大模型功能将不可用')
    else:
        logger.info('✅ 大模型配置已加载')
        logger.info(f'   - Model: {VOLC_MODEL}')
        logger.info(f'   - Base URL: {VOLC_BASE_URL}')

    logger.info(f'项目根目录: {PROJECT_ROOT}')
    logger.info(f'Temp 目录: {TEMP_DIR}')
    logger.info(f'Models 目录: {MODELS_DIR}')

    # 启动 Uvicorn 服务器
    uvicorn.run(
        app,
        host='0.0.0.0',
        port=8000,
        log_level='info'
    )


