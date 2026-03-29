package com.aimake.automl;

import com.alibaba.excel.EasyExcel;
import com.alibaba.excel.context.AnalysisContext;
import com.alibaba.excel.event.AnalysisEventListener;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * AutoML 服务类，负责处理核心业务逻辑。
 *
 * @author AImake
 */
@Service
public class AutoMlService {

    // 临时文件存储目录，位于当前工作目录下的 temp/ 文件夹
    // 使用 user.dir 确保在 Spring Boot 运行时能正确定位到项目根目录
    private final Path tempDirPath;

    /**
     * 构造函数，在服务初始化时创建 temp 目录（如果不存在）。
     * 确保 temp 目录始终存在，无论 Spring Boot 的工作目录在哪里。
     *
     * @throws IOException 如果创建目录时发生 I/O 错误
     */
    public AutoMlService() throws IOException {
        // 基于用户工作目录创建 temp 路径，更加稳定
        String userDir = System.getProperty("user.dir");
        this.tempDirPath = Paths.get(userDir, "temp");
        
        // 确保目录存在
        if (!Files.exists(tempDirPath)) {
            Files.createDirectories(tempDirPath);
            System.out.println("✓ 已创建 temp 目录：" + tempDirPath.toAbsolutePath());
        }
    }

    /**
     * 预览 Excel 文件。
     * <p>
     * 将上传的 Excel 文件保存到 temp/ 目录，然后使用 EasyExcel 读取文件的前 20 行数据。
     *
     * @param file 用户上传的 MultipartFile 文件
     * @return 返回一个包含 Excel 表头和前 20 行数据的列表，每行数据是一个 Map
     * @throws IOException 如果文件保存或读取时发生 I/O 错误
     */
    public Map<String, Object> previewExcel(MultipartFile file) throws IOException {
        // 1. 将文件保存到 temp 目录
        // 使用原始文件名，并确保路径安全
        String originalFilename = file.getOriginalFilename();
        if (originalFilename == null || originalFilename.contains("..")) {
            throw new IOException("不合法的原始文件名。");
        }
        Path targetPath = tempDirPath.resolve(originalFilename);
        file.transferTo(targetPath.toFile());

        // 2. 使用 EasyExcel 读取前 20 行数据
        ExcelPreviewListener listener = new ExcelPreviewListener();
        EasyExcel.read(targetPath.toFile(), listener)
                .headRowNumber(1)
                .sheet()
                .doRead();

        // 3. 返回预览和文件路径，供后续流程继续使用
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("status", "success");
        result.put("file_path", targetPath.toAbsolutePath().toString());
        result.put("columns", listener.getHeaders());
        result.put("total_rows", listener.getTotalRowCount());
        // 兼容旧前端字段（可逐步移除）
        result.put("preview", listener.getData());
        return result;
    }

    /**
     * EasyExcel 的自定义监听器，用于处理 Excel 读取事件。
     * <p>
     * 核心功能：
     * 1. 读取表头。
     * 2. 逐行读取数据，并限制最多读取 20 行。
     * 3. **【核心 Bug 修复】** 将所有单元格数据（无论原始类型是 Integer, Double 还是 String）统一转换为字符串，
     *    存入 `Map<String, String>`，以防止后续 JSON 转换时因类型不匹配而抛出异常。
     */
    private static class ExcelPreviewListener extends AnalysisEventListener<Map<Integer, Object>> {

        // 预览行数限制
        private static final int PREVIEW_ROW_LIMIT = 20;

        // 存储表头，key 是列索引，value 是表头名
        private final Map<Integer, String> headMap = new LinkedHashMap<>();
        // 存储最终处理后的数据列表
        private final List<Map<String, String>> dataList = new ArrayList<>();
        // 记录总数据行数（不含表头）
        private int totalRowCount = 0;

        /**
         * 当读取到表头时调用。
         *
         * @param headMap 原始的表头 Map，key 是列索引，value 是单元格对象
         * @param context 分析上下文
         */
        @Override
        public void invokeHeadMap(Map<Integer, String> headMap, AnalysisContext context) {
            // 修正：EasyExcel 传入的表头已经是 Map<Integer, String>，直接使用即可
            this.headMap.putAll(headMap);
        }

        /**
         * 每读取一行数据时调用。
         *
         * @param data    当前行的数据 Map，key 是列索引，value 是单元格对象
         * @param context 分析上下文
         */
        @Override
        public void invoke(Map<Integer, Object> data, AnalysisContext context) {
            totalRowCount++;

            // 如果已达到预览行数限制，则停止处理
            if (dataList.size() >= PREVIEW_ROW_LIMIT) {
                return;
            }

            Map<String, String> rowData = new LinkedHashMap<>();
            headMap.forEach((index, headName) -> {
                Object cellValue = data.get(index);
                // **【核心 Bug 修复】**
                // 无论单元格原始类型是什么（数字、文本、日期等），都通过 String.valueOf() 转换为字符串。
                // 如果单元格为空 (null)，则转换为空字符串 ""。
                rowData.put(headName, cellValue != null ? String.valueOf(cellValue) : "");
            });
            dataList.add(rowData);
        }

        /**
         * 所有数据解析完成后调用。
         *
         * @param context 分析上下文
         */
        @Override
        public void doAfterAllAnalysed(AnalysisContext context) {
            // 所有数据读取完毕，可以在这里进行一些收尾工作，但本场景不需要
        }

        /**
         * 返回最终处理好的数据。
         *
         * @return 包含预览数据的列表
         */
        public List<Map<String, String>> getData() {
            return dataList;
        }

        public int getTotalRowCount() {
            return totalRowCount;
        }

        public List<String> getHeaders() {
            return new ArrayList<>(headMap.values());
        }
    }
}
