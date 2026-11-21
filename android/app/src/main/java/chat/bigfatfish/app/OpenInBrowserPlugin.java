package chat.bigfatfish.app;

import android.content.Intent;
import android.net.Uri;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;

/**
 * 用系统浏览器打开一个本机 HTML 文件。
 *
 * 为什么需要这个插件，而不是直接用 Web 层的方案：
 * 三种 Web 层尝试都实测失败（见 docs/android-pending-issues.md）：
 *   window.open(blobUrl)             → 系统接管成内嵌窗口，按返回直接退出 App
 *   Browser.open('data:text/html')   → "Unable to display URL"（CustomTabs 拒绝 data:）
 *   location.href = blobUrl          → 不生成历史记录，返回仍退出
 *
 * 正确的做法是走 Android 原生意图：把文件经 FileProvider 转成 content:// URI，
 * 再 startActivity(ACTION_VIEW)。这样打开的是**独立浏览器进程**，
 * 用户按返回会回到大肥鱼Chat，而不是退出。
 */
@CapacitorPlugin(name = "OpenInBrowser")
public class OpenInBrowserPlugin extends Plugin {

    /** 与 AndroidManifest 里的 android:authorities 保持一致 */
    private static final String AUTHORITY_SUFFIX = ".fileprovider";

    @PluginMethod
    public void open(PluginCall call) {
        String path = call.getString("path");
        String mime = call.getString("mime", "text/html");
        if (path == null || path.isEmpty()) {
            call.reject("path is required");
            return;
        }

        try {
            // 文件写在 getCacheDir() 下，file_paths.xml 里的 cache-path 已覆盖
            File base = getContext().getCacheDir();
            File target = new File(base, path);
            if (!target.exists()) {
                call.reject("file not found: " + path);
                return;
            }

            String authority = getContext().getPackageName() + AUTHORITY_SUFFIX;
            Uri uri = FileProvider.getUriForFile(getContext(), authority, target);

            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, mime);
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

            getContext().startActivity(intent);

            JSObject ret = new JSObject();
            ret.put("uri", uri.toString());
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("open failed: " + e.getMessage(), e);
        }
    }
}
