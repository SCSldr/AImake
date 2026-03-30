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
    remove_outliers: bool = True
    outlier_std_threshold: float = 3.0

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
    获取 DataFrame 的预览信息
    """
    return {
        'shape': {'rows': len(df), 'cols': len(df.columns)},
        'columns': df.columns.tolist(),
        'dtypes': df.dtypes.astype(str).to_dict(),
        'preview': df.head(rows).to_dict('records'),
        'missing_values': df.isnull().sum().to_dict()
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


# ===================== 接口 1: 测试大模型连通性 =====================
@app.post('/process/check_llm_connection')
async def check_llm_connection():
    """
    测试火山引擎大模型的连通性和 API Key 是否有效
    """
    try:
        if not VOLC_API_KEY:
            return JSONResponse(
                status_code=400,
                content={'error': '未设置 api_key 环境变量'}
            )
        
        # 创建大模型客户端，使用自定义的 API Key 和 Base URL
        import os
        os.environ['VOLC_ACCESSKEY'] = VOLC_API_KEY
        
        client = ark.ArksRuntimeClient()
        
        # 发送简单的测试消息
        messages = [
            ArksMessage(role='user', content='你好，请回复"连接成功"即可')
        ]
        
        response = client.chat.completions.create(
            model=VOLC_MODEL,
            messages=messages,
            max_tokens=50
        )
        
        # 检查响应
        if response and hasattr(response, 'choices') and len(response.choices) > 0:
            content = response.choices[0].message.content
            logger.info('大模型连通性测试成功')
            return {
                'status': 'success',
                'message': '大模型连接成功',
                'model': VOLC_MODEL,
                'base_url': VOLC_BASE_URL,
                'response': content
            }
        else:
            return JSONResponse(
                status_code=500,
                content={'error': '大模型返回异常响应'}
            )
    
    except Exception as e:
        logger.error(f'测试大模型连通性失败: {str(e)}\n{traceback.format_exc()}')
        return JSONResponse(
            status_code=500,
            content={
                'error': '大模型连通性测试失败',
                'details': str(e)
            }
        )


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

        # 5. 后续解析逻辑 (保持不变)
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


# ===================== 接口 3: 数据清洗（删除缺失值） =====================
@app.post('/process/clean')
async def clean_data(request: CleanRequest):  # 2. 这里改用模型接收
    file_path = request.file_path
    drop_columns = request.drop_columns
    remove_outliers = request.remove_outliers
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
        
        # 删除包含缺失值的行
        before_dropna_rows = len(df)
        df = df.dropna()
        null_rows_removed = int(before_dropna_rows - len(df))

        # 仅对数值列执行 3σ 异常值过滤，字符串列不做处理
        outlier_rows_removed = 0
        numeric_columns_checked: List[str] = []
        if remove_outliers:
            if outlier_std_threshold <= 0:
                raise ValueError('outlier_std_threshold 必须大于 0')

            numeric_columns = df.select_dtypes(include=[np.number]).columns.tolist()
            numeric_columns_checked = numeric_columns

            if numeric_columns:
                keep_mask = pd.Series(True, index=df.index)
                for col in numeric_columns:
                    mean_val = df[col].mean()
                    std_val = df[col].std()

                    # 标准差为 0 或无效时，跳过该列过滤
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
        
        # 保存清洗后的数据
        cleaned_path = save_dataframe(df)
        
        preview_info = get_dataframe_preview(df)

        return {
            'status': 'success',
            'cleaned_file_path': cleaned_path,
            # 兼容前端渲染：顶层直接给 columns/preview/total_rows
            'columns': preview_info['columns'],
            'preview': preview_info['preview'],
            'total_rows': preview_info['shape']['rows'],
            # 保留完整预览元信息，便于后续扩展
            'preview_info': preview_info,
            'statistics': {
                'original_rows': int(original_rows),
                'cleaned_rows': int(cleaned_rows),
                'rows_removed': int(original_rows - cleaned_rows),
                'rows_removed_by_null': null_rows_removed,
                'rows_removed_by_outlier': outlier_rows_removed,
                'original_null_count': int(original_nulls),
                'cleaned_null_count': int(cleaned_nulls),
                'columns_removed': drop_columns if drop_columns else [],
                'remove_outliers': bool(remove_outliers),
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
async def feature_engineering(req: FeatureRequest): # 👈 改用模型接收
    try:
        df = load_dataframe(req.file_path)
        # ... 原有处理逻辑，将 file_path 改为 req.file_path，categorical_features 改为 req.categorical_features
        categorical_features = req.categorical_features
        for col in categorical_features:
            if col in df.columns:
                df[col] = df[col].astype(str)
        df = pd.get_dummies(df, columns=categorical_features, drop_first=False)
        feature_path = save_dataframe(df)
        return {
            'status': 'success',
            'feature_file_path': feature_path,
            'preview': get_dataframe_preview(df)
        }
    except Exception as e:
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
async def train_model(req: TrainRequest): # 👈 改用模型接收
    try:
        df = load_dataframe(req.file_path)

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


# 接口 7: 模型评估（测试集检测）
@app.post('/model/evaluate')
async def evaluate_model(req: EvaluateRequest):
    try:
        model_path_full = validate_file_path(req.model_path)
        model_package = joblib.load(model_path_full)

        model = model_package['model']
        train_cols = model_package['train_cols']
        label_encoder = model_package.get('label_encoder')

        test_df = load_dataframe(req.test_file_path)
        if req.target_column not in test_df.columns:
            raise ValueError(f'目标列 "{req.target_column}" 不存在于测试集')

        x_test = test_df.drop(columns=[req.target_column])
        y_test = test_df[req.target_column]

        x_test_dummies = pd.get_dummies(x_test)
        x_test_aligned = x_test_dummies.reindex(columns=train_cols, fill_value=0)

        if label_encoder is not None:
            y_test_encoded = label_encoder.transform(y_test)
        else:
            y_test_encoded = y_test

        y_pred = model.predict(x_test_aligned)
        accuracy = float(model.score(x_test_aligned, y_test_encoded))

        sample_predictions: List[Dict[str, Any]] = []
        for i in range(min(10, len(y_test))):
            pred_value = y_pred[i]
            if label_encoder is not None:
                pred_value = label_encoder.inverse_transform([pred_value])[0]

            sample_predictions.append({
                'actual': to_python_value(y_test.iloc[i]),
                'predicted': to_python_value(pred_value),
                'correct': bool(y_test.iloc[i] == pred_value)
            })

        return {
            'status': 'success',
            'accuracy': round(accuracy, 4),
            'total_samples': int(len(y_test)),
            'sample_predictions': sample_predictions
        }
    except Exception as e:
        logger.error(f'模型评估失败: {str(e)}\n{traceback.format_exc()}')
        return JSONResponse(status_code=500, content={'error': '模型评估失败', 'details': str(e)})


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

