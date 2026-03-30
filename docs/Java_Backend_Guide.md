# Java 后端使用指南

## 项目概述
这是一个基于 Spring Boot 3.x 的后端服务，作为 "Java + Python + 原生 HTML" 架构的一部分。主要负责文件上传、Excel 预览，并将算法请求转发给 Python FastAPI 服务。

## 核心功能
- **Excel 预览**：上传 Excel 文件，预览前 20 行数据。
- **请求转发**：将所有 `/api/**` 的 POST 请求转发到 Python 服务 (127.0.0.1:8000)。

## 启动方式
1. 确保 Java 17 环境。
2. 运行 `mvn spring-boot:run` 启动服务。
3. 服务默认运行在 8080 端口。

## API 接口
- `POST /api/preview-excel`：上传 Excel 文件，返回预览 JSON。
- 其他 `POST /api/**`：转发到 Python 服务。

## 注意事项
- 所有数据通过文件路径传递，无数据库依赖。
- 临时文件存储在 `temp/` 文件夹。
- 无登录认证和权限控制。
