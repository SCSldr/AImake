"""
AImake 测试套件
用于验证 API 接口的正确性
"""

import pytest
import requests
import json
import pandas as pd
from pathlib import Path

# API 基础 URL
BASE_URL = "http://localhost:8000"

# ===================== Fixtures =====================

@pytest.fixture
def sample_csv_file():
    """创建示例 CSV 文件"""
    data = {
        'user_id': [1, 2, 3, 4, 5],
        'age': [25, 30, 35, 40, 45],
        'amount': [100, 200, 150, 300, 250],
        'category': ['A', 'B', 'A', 'C', 'B']
    }
    df = pd.DataFrame(data)
    file_path = Path('temp') / 'test_sample.csv'
    df.to_csv(file_path, index=False)
    return str(file_path.relative_to(Path.cwd()))


# ===================== 系统健康检查测试 =====================

def test_health_check():
    """测试健康检查接口"""
    response = requests.get(f"{BASE_URL}/health")
    assert response.status_code == 200
    data = response.json()
    assert data['status'] == 'healthy'
    assert 'timestamp' in data
    assert data['temp_dir_exists']
    assert data['models_dir_exists']


def test_root_endpoint():
    """测试根路由"""
    response = requests.get(f"{BASE_URL}/")
    assert response.status_code == 200
    data = response.json()
    assert 'title' in data
    assert 'endpoints' in data


# ===================== 大模型接口测试 =====================

@pytest.mark.skip(reason="需要有效的 VOLC_API_KEY")
def test_check_llm_connection():
    """测试大模型连通性"""
    response = requests.post(f"{BASE_URL}/process/check_llm_connection")
    assert response.status_code == 200
    data = response.json()
    assert data['status'] == 'success'
    assert 'model' in data


@pytest.mark.skip(reason="需要有效的 VOLC_API_KEY")
def test_generate_data():
    """测试数据生成"""
    response = requests.post(
        f"{BASE_URL}/process/generate",
        json={
            "prompt": "生成10行的测试数据",
            "row_count": 10
        }
    )
    assert response.status_code == 200
    data = response.json()
    assert data['status'] == 'success'
    assert 'file_path' in data
    assert 'preview' in data
    assert data['preview']['shape']['rows'] == 10


@pytest.mark.skip(reason="需要有效的 VOLC_API_KEY")
def test_ai_chat():
    """测试大模型对话"""
    response = requests.post(
        f"{BASE_URL}/process/ai_chat",
        json={
            "message": "简单地回复 OK",
            "context": "这是一个测试"
        }
    )
    assert response.status_code == 200
    data = response.json()
    assert data['status'] == 'success'
    assert 'response' in data


# ===================== 数据处理接口测试 =====================

def test_clean_data(sample_csv_file):
    """测试数据清洗"""
    response = requests.post(
        f"{BASE_URL}/process/clean",
        json={"file_path": sample_csv_file}
    )
    assert response.status_code == 200
    data = response.json()
    assert data['status'] == 'success'
    assert 'cleaned_file_path' in data
    assert 'statistics' in data
    assert data['statistics']['original_rows'] == 5


def test_features_engineering(sample_csv_file):
    """测试特征工程"""
    response = requests.post(
        f"{BASE_URL}/process/features",
        json={
            "file_path": sample_csv_file,
            "categorical_features": ["category"]
        }
    )
    assert response.status_code == 200
    data = response.json()
    assert data['status'] == 'success'
    assert 'feature_file_path' in data
    assert 'encoding_info' in data


def test_split_data(sample_csv_file):
    """测试数据划分"""
    response = requests.post(
        f"{BASE_URL}/process/split",
        json={
            "file_path": sample_csv_file,
            "test_size": 0.2,
            "random_state": 42
        }
    )
    assert response.status_code == 200
    data = response.json()
    assert data['status'] == 'success'
    assert 'train_file_path' in data
    assert 'test_file_path' in data
    assert 'statistics' in data


# ===================== 模型训练测试 =====================

def test_train_model(sample_csv_file):
    """测试模型训练"""
    # 先进行特征工程
    response = requests.post(
        f"{BASE_URL}/process/features",
        json={
            "file_path": sample_csv_file,
            "categorical_features": ["category"]
        }
    )
    feature_file = response.json()['feature_file_path']
    
    # 训练模型
    response = requests.post(
        f"{BASE_URL}/model/train_manual",
        json={
            "file_path": feature_file,
            "target_column": "amount",
            "model_type": "random_forest"
        }
    )
    
    assert response.status_code == 200
    data = response.json()
    assert data['status'] == 'success'
    assert 'model_path' in data
    assert 'accuracy' in data
    assert 'train_cols' in data


# ===================== 聚类分析测试 =====================

def test_kmeans_clustering(sample_csv_file):
    """测试 K-Means 聚类"""
    response = requests.post(
        f"{BASE_URL}/clustering/train_and_visualize",
        json={
            "file_path": sample_csv_file,
            "n_clusters": 2,
            "exclude_columns": ["user_id"]
        }
    )
    
    assert response.status_code == 200
    data = response.json()
    assert data['status'] == 'success'
    assert 'cluster_image_base64' in data
    assert 'cluster_data_path' in data
    assert 'clustering_info' in data
    assert data['clustering_info']['n_clusters'] == 2


# ===================== 错误处理测试 =====================

def test_invalid_file_path():
    """测试无效的文件路径"""
    response = requests.post(
        f"{BASE_URL}/process/clean",
        json={"file_path": "temp/nonexistent_file.csv"}
    )
    assert response.status_code == 500
    data = response.json()
    assert 'error' in data


def test_invalid_model_type(sample_csv_file):
    """测试无效的模型类型"""
    response = requests.post(
        f"{BASE_URL}/model/train_manual",
        json={
            "file_path": sample_csv_file,
            "target_column": "amount",
            "model_type": "invalid_model"
        }
    )
    assert response.status_code == 500


def test_missing_target_column(sample_csv_file):
    """测试缺失的目标列"""
    response = requests.post(
        f"{BASE_URL}/model/train_manual",
        json={
            "file_path": sample_csv_file,
            "target_column": "nonexistent_column",
            "model_type": "random_forest"
        }
    )
    assert response.status_code == 500


# ===================== 集成测试 =====================

def test_end_to_end_pipeline(sample_csv_file):
    """端到端集成测试：清洗 -> 特征 -> 划分 -> 训练"""
    
    # 1. 清洗数据
    response = requests.post(
        f"{BASE_URL}/process/clean",
        json={"file_path": sample_csv_file}
    )
    assert response.status_code == 200
    cleaned_file = response.json()['cleaned_file_path']
    
    # 2. 特征工程
    response = requests.post(
        f"{BASE_URL}/process/features",
        json={
            "file_path": cleaned_file,
            "categorical_features": ["category"]
        }
    )
    assert response.status_code == 200
    feature_file = response.json()['feature_file_path']
    
    # 3. 数据划分
    response = requests.post(
        f"{BASE_URL}/process/split",
        json={
            "file_path": feature_file,
            "test_size": 0.2
        }
    )
    assert response.status_code == 200
    train_file = response.json()['train_file_path']
    test_file = response.json()['test_file_path']
    
    # 4. 模型训练
    response = requests.post(
        f"{BASE_URL}/model/train_manual",
        json={
            "file_path": train_file,
            "target_column": "amount",
            "model_type": "knn"
        }
    )
    assert response.status_code == 200
    model_path = response.json()['model_path']
    
    # 5. 模型评估
    response = requests.post(
        f"{BASE_URL}/model/evaluate",
        json={
            "model_path": model_path,
            "test_file_path": test_file,
            "target_column": "amount"
        }
    )
    assert response.status_code == 200
    data = response.json()
    assert 'accuracy' in data
    
    # 6. 模型预测
    response = requests.post(
        f"{BASE_URL}/model/predict_manual",
        json={
            "model_path": model_path,
            "data_file_path": test_file
        }
    )
    assert response.status_code == 200
    data = response.json()
    assert 'prediction_file_path' in data


# ===================== 性能测试 =====================

def test_response_time_health_check():
    """测试健康检查的响应时间"""
    import time
    
    start = time.time()
    response = requests.get(f"{BASE_URL}/health")
    elapsed = time.time() - start
    
    assert response.status_code == 200
    assert elapsed < 1.0  # 应该在 1 秒内响应


# ===================== 运行测试 =====================

if __name__ == '__main__':
    # 运行测试: pytest test_main.py -v
    # 跳过需要 API Key 的测试: pytest test_main.py -v -m "not skip"
    pytest.main([__file__, '-v'])

