#!/usr/bin/env python
"""
AImake 大模型配置快速参考

这个脚本可以帮助你验证环境变量配置是否正确
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# 加载 .env 文件
load_dotenv()

# 读取配置
api_key = os.getenv('api_key', '')
model = os.getenv('Model', 'doubao-seed-2-0-mini-260215')
api_url = os.getenv('api_url', 'https://ark.cn-beijing.volces.com/api/v3')

print("=" * 80)
print("🔧 AImake 大模型配置检查")
print("=" * 80)
print()

# 检查 .env 文件
env_file = Path('.env')
if env_file.exists():
    print("✅ .env 文件存在")
else:
    print("❌ .env 文件不存在，请从 .env.example 复制")
    print()
    print("建议命令:")
    print("  Linux/Mac:  cp .env.example .env")
    print("  Windows:    Copy-Item .env.example .env")

print()
print("-" * 80)
print("📋 当前配置信息")
print("-" * 80)

print()
print("1. API Key:")
if api_key:
    print(f"   ✅ 已配置（显示前10个字符）: {api_key[:10]}...")
    print(f"   📝 完整值: {api_key}")
else:
    print("   ❌ 未配置！")
    print("   📌 请在 .env 文件中添加：api_key=your_key_here")

print()
print("2. 模型名称:")
print(f"   ✅ 已配置: {model}")
if model not in ['doubao-seed-2-0-mini-260215', 'doubao-pro-4-turbo']:
    print(f"   ⚠️  警告：该模型不在推荐列表中")
    print(f"   推荐模型: doubao-seed-2-0-mini-260215 (轻量) 或 doubao-pro-4-turbo (高性能)")

print()
print("3. API Base URL:")
print(f"   ✅ 已配置: {api_url}")
if not api_url.startswith('https://'):
    print(f"   ⚠️  警告：URL 应该以 https:// 开头")

print()
print("-" * 80)
print("🚀 启动服务")
print("-" * 80)
print()

if api_key:
    print("✅ 配置完整，可以启动服务！")
    print()
    print("启动命令:")
    print("  python main.py")
    print()
    print("然后打开浏览器访问:")
    print("  http://localhost:8000/docs")
    print()
    print("测试大模型连接:")
    print("  curl -X POST http://localhost:8000/process/check_llm_connection")
else:
    print("⚠️  缺少必要配置（API Key），大模型相关功能将不可用")
    print()
    print("不过其他功能仍可使用:")
    print("  ✅ 数据处理（清洗、特征、划分）")
    print("  ✅ 模型训练（随机森林、KNN、逻辑回归）")
    print("  ✅ 模型预测和评估")
    print("  ✅ 聚类分析")
    print("  ❌ 数据生成（需要大模型）")
    print("  ❌ 大模型对话（需要大模型）")

print()
print("=" * 80)
print("💡 更多帮助，请查看: LLM_CONFIG_GUIDE.md")
print("=" * 80)

