"""
AImake 项目配置文件（可选）
你可以在这里定义常量和配置参数
"""

import os
from pathlib import Path

# ===================== 基础配置 =====================

# 项目根目录
PROJECT_ROOT = Path(__file__).parent.parent.absolute()

# FastAPI 应用配置
APP_TITLE = "AImake - 机器学习后端服务"
APP_DESCRIPTION = "数据处理、模型训练、聚类分析和大模型对话服务"
APP_VERSION = "1.0.0"

# 服务器配置
HOST = "0.0.0.0"
PORT = 8000
DEBUG = True

# ===================== 文件配置 =====================

# Temp 文件夹（存放生成的数据）
TEMP_DIR = PROJECT_ROOT / 'temp'

# Models 文件夹（存放训练的模型）
MODELS_DIR = PROJECT_ROOT / 'models'

# 允许的文件扩展名
ALLOWED_EXTENSIONS = {'.csv', '.xlsx', '.xls'}

# ===================== 大模型配置 =====================

# 火山引擎 API Key（从 .env 读取）
VOLC_API_KEY = os.getenv('api_key', '')

# 火山引擎模型名称（从 .env 读取）
VOLC_MODEL = os.getenv('Model', 'doubao-seed-2-0-mini-260215')

# 火山引擎 API Base URL（从 .env 读取）
VOLC_BASE_URL = os.getenv('api_url', 'https://ark.cn-beijing.volces.com/api/v3')

# 大模型请求超时（秒）
LLM_TIMEOUT = 60

# 大模型最大 token 数
LLM_MAX_TOKENS = 2000

# ===================== 机器学习配置 =====================

# 随机森林参数
RANDOM_FOREST_PARAMS = {
    'n_estimators': 100,
    'random_state': 42,
    'n_jobs': -1
}

# KNN 参数
KNN_PARAMS = {
    'n_neighbors': 5
}

# 逻辑回归参数
LOGISTIC_REGRESSION_PARAMS = {
    'random_state': 42,
    'max_iter': 1000
}

# 聚类参数
KMEANS_PARAMS = {
    'n_init': 10,
    'random_state': 42
}

# PCA 参数
PCA_COMPONENTS = 2  # 降维到 2D（用于可视化）

# ===================== 数据处理配置 =====================

# 训练集 / 测试集默认比例
DEFAULT_TEST_SIZE = 0.2
DEFAULT_RANDOM_STATE = 42

# 数据预览行数
PREVIEW_ROWS = 5

# ===================== 日志配置 =====================

LOG_LEVEL = 'INFO'
LOG_FORMAT = '%(asctime)s - %(name)s - %(levelname)s - %(message)s'

# ===================== CORS 配置 =====================

CORS_ORIGINS = ['*']  # 允许所有来源
CORS_CREDENTIALS = True
CORS_METHODS = ['*']
CORS_HEADERS = ['*']
