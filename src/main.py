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
from sklearn.ensemble import RandomForestClassifier
from sklearn.neighbors import KNeighborsClassifier
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

# 换成这个
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
    # 是否直接删除含空值的行（勾选时比填充更严格）
    remove_null_rows: bool = False
    # 未删除空值行时，是否执行缺失值填充
    fill_missing: bool = True
    # 兼容旧前端：勾选异常值处理
    remove_outliers: bool = False
    # none/clip/remove，分别表示不处理/截断/删行
    outlier_mode: str = 'none'
    outlier_std_threshold: float = 4.0

# ===================== 项目目录配置 =====================
# 项目根目录
PROJECT_ROOT = Path(__file__).parent.absolute()
# temp 文件夹用于存放 csv/xlsx 文件
TEMP_DIR = PROJECT_ROOT / 'temp'
TEMP_DIR.mkdir(exist_ok=True)
# models 文件夹用于存放已训练的模型
MODELS_DIR = PROJECT_ROOT / 'models'
MODELS_DIR.mkdir(exist_ok=True)

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
    {"role": "system", "content": "你是由用户自主研发的AI助手。简洁回答，不要使用md格式、代码块。"}
]


# 3. 重新立起 AI 对话接口 (解决刚才的 404)
@app.post('/process/ai_chat')  # 👈 必须叫这个名，Java 才能认出它
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

# ===================== 接口 2: 调用大模型生成 CSV 数据 =====================
@app.post('/process/generate')
async def generate_data(req: GenerateRequest): # 👈 关键改动：使用模型接收
    # 从模型中提取数据
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

        # 1. 构建提示词 (保持不变)
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

"""  # 这里的逻辑保持你原来的即可

        # 2. 初始化客户端 (使用正确的 Ark 类)
        from volcenginesdkarkruntime import Ark
        client = Ark(api_key=VOLC_API_KEY)  # 直接传入 API Key

        # 3. 核心修复：将 ArksMessage 替换为标准的字典格式
        messages = [
            {"role": "user", "content": full_prompt}
        ]

        # 4. 调用模型
        response = client.chat.completions.create(
            model=VOLC_MODEL,
            messages=messages,
            max_tokens=8000
        )

        # 5. 后续解析逻辑
        if not response or not response.choices:
            raise ValueError('大模型返回异常响应')

        csv_content = response.choices[0].message.content.strip()
        # --- 1. 移除可能包含的 markdown 代码块标记 ---
        if csv_content.startswith('```'):
            # 找到第一个换行符，取后面的内容
            lines = csv_content.split('\n')
            if len(lines) > 1:
                csv_content = '\n'.join(lines[1:])
        if csv_content.endswith('```'):
            csv_content = csv_content.rsplit('```', 1)[0]

        csv_content = csv_content.strip()

        # --- 2. 尝试解析为 DataFrame ---
        import pandas as pd
        import io

        # 使用 StringIO 将字符串模拟成文件流供 pandas 读取
        df = pd.read_csv(io.StringIO(csv_content))

        if df.empty:
            raise ValueError('生成的数据内容为空，无法解析为表格')

        # --- 3. 保存到本地文件 (调用你之前的保存工具函数) ---
        # 假设你已经定义了 save_dataframe(df)
        file_path = save_dataframe(df)

        # --- 4. 返回预览和文件路径给 Java 端 ---
        full_preview = df.to_dict('records')
        return {
            'status': 'success',
            'file_path': file_path,
            'model': VOLC_MODEL,
            'columns': df.columns.tolist(),
            'preview': full_preview,
            # 假设你已经定义了 get_dataframe_preview(df, rows=5)
            'preview_info': get_dataframe_preview(df, rows=min(10, len(df))),
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
async def clean_data(request: CleanRequest):  # 2. 这里改用模型接收
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
        
        # 空值处理：可选“删除含空值行”或“缺失值填充”
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
            # 温和填充：数值列用中位数，文本列用众数（兜底空字符串）
            for col in numeric_columns:
                median_val = df[col].median()
                if pd.isna(median_val):
                    median_val = 0
                df[col] = df[col].fillna(median_val)

            for col in object_columns:
                mode_series = df[col].mode(dropna=True)
                fill_val = mode_series.iloc[0] if not mode_series.empty else ''
                df[col] = df[col].fillna(fill_val)

        # 兼容旧参数：remove_outliers=true 但未传 outlier_mode 时，按 remove 处理
        if outlier_mode not in {'none', 'clip', 'remove'}:
            outlier_mode = 'none'
        if remove_outliers and outlier_mode == 'none':
            outlier_mode = 'remove'

        # 异常值处理：clip=截断，remove=删行
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
        
        cleaned_rows = len(df)
        cleaned_nulls = df.isnull().sum().sum()
        cleaned_path = save_dataframe(df)
        preview_info = get_dataframe_preview(df)

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

        # 🔍 诊断 1：看看到底传了哪些列进来
        print(f"📢 前端请求编码的列: {req.categorical_features}")
        # 🔍 诊断 2：看看现在每列的“原始身份”是什么
        print(f"📊 编码前的列类型:\n{df.dtypes}")

        # 核心逻辑：严格过滤，只对“确实存在”且“用户指定”的列操作
        cat_cols = [c for c in req.categorical_features if c in df.columns]

        if not cat_cols:
            return {"status": "success", "message": "跳过编码", "feature_file_path": req.file_path}

        # --- 核心防御：手动分离数值列 ---
        # 找出那些不在编码名单里的“幸运儿”（数值列）
        other_cols = [c for c in df.columns if c not in cat_cols]
        df_others = df[other_cols].copy()

        # 只对指定的列进行独热编码
        df_cat = pd.get_dummies(df[cat_cols], dtype=int)

        # 拼回去：[数值列] + [编码后的 01 列]
        df_final = pd.concat([df_others, df_cat], axis=1)

        # 🔍 诊断 3：看看拼完之后长啥样
        print(f"🚀 处理后的总列数: {len(df_final.columns)}")

        feature_path = save_dataframe(df_final)

        return {
            'status': 'success',
            'feature_file_path': feature_path,
            'preview': get_dataframe_preview(df_final),
            'total_rows': int(len(df_final))
        }
    except Exception as e:
        import traceback
        print(traceback.format_exc())
        return JSONResponse(status_code=500, content={'error': str(e)})

# 接口 5: 数据划分
@app.post('/process/split')
async def split_data(req: SplitRequest): # 👈 改用模型接收
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

        # 1. 自动过滤掉所有非数字的“捣乱分子”
        # 这样即使你没删 '2024Q2'，它也会被自动踢出特征集 X
        numeric_df = df.select_dtypes(include=[np.number])

        # 2. 确保目标列（Target）在里面
        if req.target_column not in df.columns:
            raise ValueError(f"找不到目标列: {req.target_column}")

        # 3. 准备特征 X 和 目标 y
        # X 只能包含数字列，且要排除掉目标列本身
        X = numeric_df.drop(columns=[req.target_column] if req.target_column in numeric_df.columns else [])
        y = df[req.target_column]

        # 打印一下，看看哪些列被留下了
        print(f"✅ 最终参与训练的特征有: {X.columns.tolist()}")

        if req.target_column not in df.columns:
            raise ValueError(f'目标列 "{req.target_column}" 不存在于数据中')

        x_data = df.drop(columns=[req.target_column])
        y_data = df[req.target_column]
        train_cols = x_data.columns.tolist()

        if y_data.dtype == 'object':
            label_encoder = LabelEncoder()
            y_encoded = label_encoder.fit_transform(y_data)
        else:
            label_encoder = None
            y_encoded = y_data

        x_train, x_test, y_train, y_test = train_test_split(
            x_data,
            y_encoded,
            test_size=0.2,
            random_state=42
        )

        model_type = (req.model_type or '').lower()
        if model_type == 'random_forest':
            model = RandomForestClassifier(n_estimators=100, random_state=42)
        elif model_type == 'knn':
            model = KNeighborsClassifier(n_neighbors=5)
        elif model_type == 'logistic_regression':
            model = LogisticRegression(random_state=42, max_iter=1000)
        else:
            raise ValueError(f'不支持的模型类型: {req.model_type}')

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
            'target_column': req.target_column
        }
        joblib.dump(model_package, model_path)

        return {
            'status': 'success',
            'model_path': get_relative_path(str(model_path)),
            'model_type': model_type,
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


# ===================== 接口 6: 模型训练=====================
@app.post('/model/train_manual')
async def train_model(req: TrainRequest):
    try:
        df = load_dataframe(req.file_path)
        target_col = req.target_column

        # --- [第一道防线] 检查目标列 ---
        if target_col not in df.columns:
            raise ValueError(f"目标列 '{target_col}' 消失了，请重新选择")

        # --- [第二道防线] 暴力过滤特征 X ---
        # 只拿数字列，且排除目标列
        X_numeric = df.select_dtypes(include=[np.number])
        X = X_numeric.drop(columns=[target_col] if target_col in X_numeric.columns else [])
        train_cols = X.columns.tolist()
        print(f"✅ 核心特征确认: {train_cols}")

        # --- [第三道防线] 核心：处理目标 y 的字符串病灶 ---
        y = df[target_col]

        # 如果目标列里混进了像 '2024Q2' 这样的脏数据，或者是纯字符串
        if y.dtype == 'object' or not np.issubdtype(y.dtype, np.number):
            print(f"⚠️ 警告：目标列 '{target_col}' 包含非数字，正在尝试强制转换...")
            # 如果是做回归，尝试强转数字，转不了的变 NaN 删掉
            y_numeric = pd.to_numeric(y, errors='coerce')

            if y_numeric.isnull().all():
                # 说明这一列全是文字（比如：季度、行业）
                # 这种情况下，自动转为分类编码 (LabelEncoding)
                from sklearn.preprocessing import LabelEncoder
                le = LabelEncoder()
                y = le.fit_transform(y.astype(str))
                label_encoder = le
                print(f"✅ 已将分类目标转换为编码: {le.classes_.tolist()[:5]}...")
            else:
                # 说明是数字列里混了脏数据
                valid_mask = y_numeric.notnull()
                X = X[valid_mask]
                y = y_numeric[valid_mask]
                label_encoder = None
                print(f"✅ 已剔除无法转为数字的脏数据行，剩余: {len(y)} 行")
        else:
            label_encoder = None

        # --- 执行划分与训练 ---
        from sklearn.model_selection import train_test_split
        x_train, x_test, y_train, y_test = train_test_split(X, y, test_size=req.test_size,
                                                            random_state=req.random_state)

        # 初始化模型 (根据 req.model_type)
        # ... 这里保留你之前的 model 初始化代码 ...

        model.fit(x_train, y_train)

        # ... 后续保存和返回逻辑 ...
        return {"status": "success", "accuracy": "..."}  # 这里补全你的返回逻辑

    except Exception as e:
        import traceback
        print(traceback.format_exc())
        return JSONResponse(status_code=500, content={'error': str(e)})
# 接口 8: 手动/文件预测
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
        x_data = pd.get_dummies(data_df)
        x_aligned = x_data.reindex(columns=train_cols, fill_value=0)

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
            'unique_predictions': unique_predictions
        }
    except Exception as e:
        logger.error(f'模型预测失败: {str(e)}\n{traceback.format_exc()}')
        return JSONResponse(status_code=500, content={'error': '模型预测失败', 'details': str(e)})


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


# 2. 聚类训练与可视化接口
@app.post('/clustering/train_and_visualize')  # 👈 必须和 Java 调用的路径完全一致
async def train_and_visualize_clusters(req: ClusterRequest):
    try:
        df = load_dataframe(req.file_path)

        # --- 核心逻辑：只拿数字列 ---
        # 即使没选特征，我们也只针对数字进行聚类，自动过滤掉 '2024Q2'
        X_numeric = df.select_dtypes(include=[np.number])

        if req.features:
            # 只取用户选中的、且确实是数字的列
            cols = [c for c in req.features if c in X_numeric.columns]
            X = X_numeric[cols]
        else:
            X = X_numeric

        if X.empty:
            raise ValueError("没有可用的数值特征进行聚类")

        # 1. 标准化数据（聚类必做，否则量纲大的列会主导结果）
        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)

        # 2. 训练 K-Means
        kmeans = KMeans(n_clusters=req.n_clusters, random_state=42, n_init=10)
        clusters = kmeans.fit_transform(X_scaled)  # 这里的 clusters 是距离，不是标签
        labels = kmeans.labels_  # 这才是每个点的分类标签

        # 3. PCA 降维到 2D（为了在网页前端画图）
        pca = PCA(n_components=2)
        X_pca = pca.fit_transform(X_scaled)

        # 4. 组装返回结果
        # 将降维后的坐标、原始标签、以及一些展示信息拼在一起
        plot_data = []
        for i in range(len(df)):
            plot_data.append({
                'x': float(X_pca[i][0]),
                'y': float(X_pca[i][1]),
                'label': int(labels[i]),
                # 顺便带点原始数据，方便前端 Hover 显示
                'info': df.iloc[i].head(3).to_dict()
            })

        return {
            'status': 'success',
            'clusters': [int(l) for l in labels],
            'plot_data': plot_data,
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
    cluster_labels: List[int] = None  # 有些前端会把刚算好的标签传回来


# 2. 补全这个丢失的 404 接口
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
        # 如果请求里没带标签，我们默认给个 0（或者你可以尝试从 df 中寻找 'cluster' 列）
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

        return {
            'status': 'success',
            'plot_data': plot_data,
            'pca_info': {
                'explained_variance': [float(v) for v in pca.explained_variance_ratio_]
            }
        }

    except Exception as e:
        import traceback
        logger.error(f"可视化生成失败: {str(e)}\n{traceback.format_exc()}")
        return JSONResponse(status_code=500, content={'error': str(e)})

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
            '特征工程': 'POST /process/features',
            '数据划分': 'POST /process/split',
            '模型训练': 'POST /model/train_manual',
            '模型评估': 'POST /model/evaluate',
            '模型预测': 'POST /model/predict_manual',
            '聚类分析': 'POST /clustering/train_and_visualize',
            '大模型对话': 'POST /process/ai_chat'
        }
    }


# ===================== 启动应用 =====================
if __name__ == '__main__':
    # 检查环境变量
    if not VOLC_API_KEY:
        logger.warning('⚠️  未设置 api_key 环境变量，大模型功能将不可用')
    else:
        logger.info(f'✅ 大模型配置已加载')
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

