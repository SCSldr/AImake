# AImake Spring Boot 后端服务

这是一个基于 Spring Boot 3.x 的后端服务，作为 Java + Python + 原生 HTML 架构中的 Java 层。

## 核心功能

1.  **Excel 预览**：接收 Excel 文件上传，读取前 20 行数据进行预览。
2.  **Python 服务代理**：将所有其他 `/api/**` 的 POST 请求转发给运行在 `http://127.0.0.1:8000` 的 Python FastAPI 服务。

## 运行要求

*   JDK 17 或更高版本
*   Maven 3.x
*   Python FastAPI 服务需运行在 `http://127.0.0.1:8000`

## 依赖配置 (pom.xml)

请确保你的 `pom.xml` 文件中包含以下依赖：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>
    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.2.5</version> <!-- 请根据实际情况选择合适的 Spring Boot 版本 -->
        <relativePath/> <!-- lookup parent from repository -->
    </parent>
    <groupId>com.aimake</groupId>
    <artifactId>automl</artifactId>
    <version>0.0.1-SNAPSHOT</version>
    <name>automl</name>
    <description>AImake Spring Boot Backend</description>

    <properties>
        <java.version>17</java.version>
    </properties>

    <dependencies>
        <!-- Spring Boot Web Starter，提供 RESTful API 支持 -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>

        <!-- EasyExcel，用于 Excel 文件的读写 -->
        <dependency>
            <groupId>com.alibaba</groupId>
            <artifactId>easyexcel</artifactId>
            <version>3.3.3</version>
        </dependency>

        <!-- Spring Boot Test Starter (可选，用于测试) -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-test</artifactId>
            <scope>test</scope>
        </dependency>
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-maven-plugin</artifactId>
            </plugin>
        </plugins>
    </build>

</project>
```

## 运行项目

1.  **配置 `pom.xml`**：将上述依赖添加到你的 `pom.xml` 文件中。
2.  **创建 `temp` 目录**：在项目根目录下手动创建一个名为 `temp` 的文件夹，用于存放上传的临时文件。
3.  **构建项目**：
    ```bash
    mvn clean install
    ```
4.  **运行项目**：
    ```bash
    mvn spring-boot:run
    ```
    或者通过 IDE 运行 `AutoMlApplication` (主启动类)。

## API 接口测试

### 1. Excel 预览接口

*   **URL**: `http://localhost:8080/api/preview-excel` (如果你的 Spring Boot 端口是 8080)
*   **方法**: `POST`
*   **Content-Type**: `multipart/form-data`
*   **请求体**: 包含一个文件字段，`name` 为 `file`，上传你的 Excel 文件。

    **示例 (使用 curl):**
    ```bash
    curl -X POST -F "file=@/path/to/your/excel.xlsx" http://localhost:8080/api/preview-excel
    ```

    **预期响应**:
    ```json
    [
        {"列名1": "值1", "列名2": "值2", ...},
        {"列名1": "值A", "列名2": "值B", ...},
        ... (最多 20 行)
    ]
    ```

### 2. Python 服务转发接口

*   **URL**: `http://localhost:8080/api/your-python-endpoint` (替换 `your-python-endpoint` 为你的 Python FastAPI 接口路径)
*   **方法**: `POST`
*   **Content-Type**: `application/json` (或其他 Python 服务接受的类型)
*   **请求体**: 任何 JSON 数据，将原封不动地转发给 Python 服务。

    **示例 (使用 curl):**
    ```bash
    curl -X POST -H "Content-Type: application/json" -d '{"param1": "value1", "param2": 123}' http://localhost:8080/api/some-algorithm-path
    ```

    **预期响应**:
    Python FastAPI 服务返回的原始响应。

## 注意事项

*   **端口冲突**：如果 8080 端口被占用，请修改 `application.properties` 或 `application.yml` 中的 `server.port` 配置。
*   **Python 服务**：确保你的 Python FastAPI 服务已启动并监听在 `http://127.0.0.1:8000`。
*   **错误处理**：本示例代码为简化起见，未包含详细的异常处理和日志记录。在生产环境中，请务必添加健壮的错误处理机制。
