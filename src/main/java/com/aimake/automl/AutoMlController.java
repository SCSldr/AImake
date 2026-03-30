package com.aimake.automl;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * AutoML 主控制器，负责处理所有 API 请求。
 *
 * @author AImake
 */
@RestController
public class AutoMlController {

    private final AutoMlService autoMlService;
    private final RestTemplate restTemplate;

    // Python FastAPI 服务的地址
    private static final String PYTHON_SERVICE_BASE_URL = "http://127.0.0.1:8000";

    /**
     * 构造函数注入服务和 RestTemplate。
     *
     * @param autoMlService AutoML 业务服务
     */
    @Autowired
    public AutoMlController(AutoMlService autoMlService, org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping mapping) {
        this.autoMlService = autoMlService;
        this.restTemplate = new RestTemplate();

        mapping.getHandlerMethods().forEach((k, v) -> System.out.println("Mapped: " + k + " -> " + v));
    }

    /**
     * Excel 文件预览接口。
     * <p>
     * 接收客户端上传的 Excel 文件，调用 Service 进行处理，并返回预览数据。
     *
     * @param file 上传的文件，通过 @RequestParam("file") 绑定
     * @return 返回一个包含 Excel 预览数据的列表
     */
    @PostMapping("/api/preview-excel")
    public ResponseEntity<Map<String, Object>> previewExcel(@RequestParam("file") MultipartFile file) {
        String requestId = UUID.randomUUID().toString();
        System.out.println("========== [上传请求] ==========");
        System.out.println("  requestId: " + requestId);
        System.out.println("✓ 请求已到达 /api/preview-excel");
        System.out.println("  文件名: " + file.getOriginalFilename());
        System.out.println("  文件大小: " + file.getSize() + " bytes");
        System.out.println("  Content-Type: " + file.getContentType());
        
        try {
            Map<String, Object> result = autoMlService.previewExcel(file);
            result.put("requestId", requestId);
            System.out.println("✓ Service 处理成功");
            System.out.println("  返回数据: " + result);
            System.out.println("========== [上传完成] ==========");
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            System.out.println("✗ Service 处理失败");
            System.out.println("  错误信息: " + e.getMessage());
            e.printStackTrace();
            System.out.println("========== [上传失败] ==========");

            Map<String, Object> errorBody = new LinkedHashMap<>();
            errorBody.put("status", "error");
            errorBody.put("stage", "preview-excel");
            errorBody.put("requestId", requestId);
            errorBody.put("message", e.getMessage());
            errorBody.put("details", "文件预览失败，请检查文件格式、文件内容或查看后端日志 requestId。");
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(errorBody);
        }
    }

    /**
     * 通用请求转发代理方法。
     * <p>
     * 将所有匹配 `/api/**` 但未被其他 @PostMapping 明确映射的 POST 请求，
     * 原封不动地转发到 Python FastAPI 服务。
     *
     * @param requestBody 从客户端接收的原始请求体
     * @param request     HttpServletRequest 对象，用于获取请求的完整路径
     * @return 从 Python 服务返回的响应，类型为 ResponseEntity<String> 以便处理各种响应体
     */
    @PostMapping("/api/py/**")
    public ResponseEntity<String> proxyToPython(@RequestBody(required = false) String requestBody, HttpServletRequest request) {
        // 1. 获取并规范化当前请求路径，映射到 Python 实际路由
        String path = resolvePythonPath(request.getRequestURI());

        // 2. 构建目标 URL
        // 使用 UriComponentsBuilder 来正确处理 URL 构建
        UriComponentsBuilder uriBuilder = UriComponentsBuilder.fromHttpUrl(PYTHON_SERVICE_BASE_URL)
                .path(path);
        // 保留 query 参数，避免 Python 端参数丢失
        if (request.getQueryString() != null && !request.getQueryString().isEmpty()) {
            uriBuilder.query(request.getQueryString());
        }
        URI targetUri = uriBuilder.build(true).toUri();
        System.out.println("Forwarding to Python: " + targetUri);

        // 3. 设置请求头
        // 这里我们只转发 Content-Type，可以根据需要添加更多需要透传的头信息
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON); // 假设 Python 服务总是接受 JSON

        // 4. 创建 HttpEntity，封装请求体和请求头
        HttpEntity<String> entity = new HttpEntity<>(requestBody, headers);

        // 5. 发送请求到 Python 服务
        // 使用 exchange 方法可以更灵活地处理请求和响应
        try {
            ResponseEntity<String> response = restTemplate.exchange(targetUri, HttpMethod.POST, entity, String.class);
            // 6. 将 Python 服务的响应原样返回给客户端
            return response;
        } catch (Exception e) {
            // 如果请求失败（例如 Python 服务未启动），返回一个服务器内部错误响应
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body("请求 Python 服务失败: " + e.getMessage());
        }
    }

    /**
     * 将 Java 侧 /api 请求路径映射为 Python FastAPI 的真实路径。
     */
    private String resolvePythonPath(String requestUri) {
        String path = requestUri;

        // 去掉 Python 代理前缀 /api/py，拿到真实 Python endpoint
        if (path.startsWith("/api/py")) {
            path = path.substring(7);
            if (path.isEmpty()) {
                path = "/";
            }
        }

        // 兼容前端的短路径写法
        return switch (path) {
            case "/ai-chat" -> "/process/ai_chat";
            case "/generate-data" -> "/process/generate";
            case "/clean-data" -> "/process/clean";
            case "/process-features" -> "/process/features";
            case "/train-manual" -> "/model/train_manual";
            case "/evaluate-model" -> "/model/evaluate";
            case "/clustering/train" -> "/clustering/train_and_visualize";
            default -> path;
        };
    }
}

