package com.aimake.automl;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartException;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * 统一处理 /api 接口的常见异常，保证前端能拿到可读错误信息。
 */
@ControllerAdvice(annotations = RestController.class)
public class ApiExceptionHandler {

    @ExceptionHandler({MultipartException.class, MaxUploadSizeExceededException.class})
    public ResponseEntity<Map<String, Object>> handleMultipart(Exception ex) {
        return buildError(HttpStatus.BAD_REQUEST, "upload", "上传失败：文件过大或上传流异常。", ex.getMessage());
    }

    @ExceptionHandler(MissingServletRequestParameterException.class)
    public ResponseEntity<Map<String, Object>> handleMissingParam(MissingServletRequestParameterException ex) {
        return buildError(HttpStatus.BAD_REQUEST, "request", "请求缺少必要参数: " + ex.getParameterName(), ex.getMessage());
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> handleGeneric(Exception ex) {
        return buildError(HttpStatus.INTERNAL_SERVER_ERROR, "server", "服务内部错误，请查看后端日志。", ex.getMessage());
    }

    private ResponseEntity<Map<String, Object>> buildError(HttpStatus status, String stage, String message, String details) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("status", "error");
        body.put("stage", stage);
        body.put("requestId", UUID.randomUUID().toString());
        body.put("message", message);
        body.put("details", details);
        return ResponseEntity.status(status).body(body);
    }
}

